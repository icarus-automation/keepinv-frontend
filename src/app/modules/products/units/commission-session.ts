import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Observable, finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { Popover, PopoverModule } from 'primeng/popover';

import { LocationsService } from '../../locations/services/locations.service';
import { SuppliersService } from '../../suppliers/services/suppliers.service';
import { httpErrorMessage } from '../../../../common/http/http-error-message';
import { Product } from '../types/product.types';
import {
  RegisterMovementType,
  RegisterProductUnitsResult,
} from '../types/product-unit.types';
import { ProductUnitsService } from '../services/product-units.service';
import { StockMovementTypesService } from '../../stock-movement-types/services/stock-movement-types.service';
import { StockMovementType } from '../../stock-movement-types/types/stock-movement-type.types';

/**
 * One unit staged for registration. A unit is anchored by the RFID tag (EPC) the
 * sweep captured; serial number and asset tag are optional enrichments added via
 * the per-row editor. At least one identifier must remain to register.
 */
interface StagedUnit {
  /** Stable, generated list key, independent of which identifier anchors the unit. */
  readonly key: string;
  readonly rfidTag: string;
  serialNumber: string;
  assetTag: string;
}

/** A staged unit flattened for display: one anchor value plus any other identifiers. */
interface StagedRow {
  readonly key: string;
  readonly icon: string;
  readonly value: string;
  readonly meta: string | null;
}

interface NamedRecord {
  readonly id: string;
  readonly name: string;
}

interface ReasonChip {
  readonly value: RegisterMovementType;
  readonly label: string;
  readonly icon: string;
}

/** Hard cap from the backend: a single register accepts at most this many units. */
const MAX_UNITS = 500;

/**
 * The live RFID commissioning session for a serialized product. A focused takeover
 * of the detail pane: pick where the stock lands, then sweep tags. Unlike the audit
 * session, registration is one atomic commit, so scans stage *client-side* into a
 * roster the operator can prune and enrich before committing. The scan field owns
 * focus throughout, so an RFID sweep always lands here. On commit the whole batch
 * posts at once; the result echoes the product's refreshed on-hand.
 */
@Component({
  selector: 'app-commission-session',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    TextareaModule,
    PopoverModule,
  ],
  templateUrl: './commission-session.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommissionSession {
  private readonly service = inject(ProductUnitsService);
  private readonly locationsService = inject(LocationsService);
  private readonly suppliersService = inject(SuppliersService);
  private readonly stockMovementTypesService = inject(StockMovementTypesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly product = input.required<Product>();

  /** A register succeeded; the parent refreshes the roster and the product's on-hand. */
  readonly committed = output<void>();
  /** The operator left the session; the parent returns to the roster. */
  readonly exited = output<void>();

  private readonly captureInput = viewChild<ElementRef<HTMLInputElement>>('captureInput');

  protected readonly phase = signal<'setup' | 'capturing' | 'result'>('setup');

  // --- Setup ---
  protected readonly locationId = signal<string | null>(null);
  protected readonly supplierId = signal<string | null>(null);
  protected readonly reason = signal<RegisterMovementType>('INITIAL');
  /** Live system stock-movement types, used to resolve `reason` to a `stockMovementTypeId`. */
  private readonly stockMovementTypes = signal<StockMovementType[]>([]);
  protected readonly note = new FormControl('', { nonNullable: true });
  protected readonly locationOptions = signal<NamedRecord[]>([]);
  protected readonly supplierOptions = signal<NamedRecord[]>([]);
  protected readonly reasons: ReasonChip[] = [
    { value: 'INITIAL', label: 'Initial stock', icon: 'pi pi-box' },
    { value: 'PURCHASE', label: 'Purchase', icon: 'pi pi-shopping-cart' },
  ];

  // --- Inline master-data quick-create (location, supplier) for the setup step ---
  protected readonly quickLocationName = new FormControl('', { nonNullable: true });
  protected readonly quickSupplierName = new FormControl('', { nonNullable: true });
  protected readonly quickBusy = signal(false);
  protected readonly quickError = signal<string | null>(null);

  // --- Capture (RFID sweep only; serials are added per-row via the enrich editor) ---
  protected readonly staged = signal<StagedUnit[]>([]);
  protected readonly capture = new FormControl('', { nonNullable: true });
  protected readonly pasteControl = new FormControl('', { nonNullable: true });
  protected readonly committing = signal(false);
  protected readonly commitError = signal<string | null>(null);
  /** The most recent tag rejected as an in-session duplicate, for a brief notice. */
  protected readonly duplicateNotice = signal<string | null>(null);

  // --- Per-row enrich editor (shared popover) ---
  protected readonly editKey = signal<string | null>(null);
  protected readonly editSerial = new FormControl('', { nonNullable: true });
  protected readonly editAsset = new FormControl('', { nonNullable: true });
  protected readonly enrichError = signal<string | null>(null);

  // --- Result ---
  protected readonly result = signal<RegisterProductUnitsResult | null>(null);

  protected readonly count = computed(() => this.staged().length);
  protected readonly overLimit = computed(() => this.count() > MAX_UNITS);
  protected readonly maxUnits = MAX_UNITS;

  /** Flatten staged units for display: the anchor value, an icon, and any other identifiers. */
  protected readonly stagedRows = computed<StagedRow[]>(() =>
    this.staged().map((unit) => {
      const parts: string[] = [];
      if (unit.rfidTag) {
        parts.push(`EPC ${unit.rfidTag}`);
      }
      if (unit.serialNumber) {
        parts.push(`SN ${unit.serialNumber}`);
      }
      if (unit.assetTag) {
        parts.push(`Asset ${unit.assetTag}`);
      }
      return {
        key: unit.key,
        icon: 'pi pi-wifi',
        value: unit.rfidTag || unit.serialNumber || unit.assetTag,
        meta: parts.length > 1 ? parts.slice(1).join(' · ') : null,
      };
    }),
  );

  protected readonly listening = computed(
    () => this.phase() === 'capturing' && !this.committing(),
  );

  protected readonly locationName = computed(
    () => this.locationOptions().find((option) => option.id === this.locationId())?.name ?? null,
  );

  private duplicateTimer: ReturnType<typeof setTimeout> | null = null;
  /** Monotonic source for stable staged-row keys, independent of the anchor identifier. */
  private keySeq = 0;

  constructor() {
    this.loadOptions();

    // A new product resets the whole session to setup.
    effect(() => {
      this.product().id;
      this.resetSession();
    });

    // Keep the scan field focused whenever the session is listening for tags.
    effect(() => {
      const el = this.captureInput();
      if (el && this.listening()) {
        el.nativeElement.focus();
      }
    });
  }

  // --- Setup actions ---

  protected begin(): void {
    if (!this.locationId()) {
      return;
    }
    this.phase.set('capturing');
  }

  protected exitSetup(): void {
    this.exited.emit();
  }

  /** Reset a quick-create popover's transient state as it opens. */
  protected openQuick(control: FormControl<string>): void {
    this.quickError.set(null);
    control.reset('');
  }

  /** Create a location inline and drop it into the picker, already selected. */
  protected createLocation(popover: Popover): void {
    this.runQuickCreate(
      this.quickLocationName,
      (name) => this.locationsService.create({ name }),
      (created) => {
        this.locationOptions.update((list) => [{ id: created.id, name: created.name }, ...list]);
        this.locationId.set(created.id);
        popover.hide();
      },
    );
  }

  /** Create a supplier inline and drop it into the picker, already selected. */
  protected createSupplier(popover: Popover): void {
    this.runQuickCreate(
      this.quickSupplierName,
      (name) => this.suppliersService.create({ name }),
      (created) => {
        this.supplierOptions.update((list) => [{ id: created.id, name: created.name }, ...list]);
        this.supplierId.set(created.id);
        popover.hide();
      },
    );
  }

  private runQuickCreate<T extends NamedRecord>(
    control: FormControl<string>,
    create: (name: string) => Observable<T>,
    onCreated: (created: T) => void,
  ): void {
    const name = control.value.trim();
    this.quickError.set(null);
    if (!name) {
      this.quickError.set('Enter a name.');
      return;
    }
    if (this.quickBusy()) {
      return;
    }

    this.quickBusy.set(true);
    create(name)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.quickBusy.set(false)),
      )
      .subscribe({
        next: (created) => {
          onCreated(created);
          control.reset('');
        },
        error: (error: unknown) => this.quickError.set(httpErrorMessage(error, `"${name}"`)),
      });
  }

  // --- Capture actions ---

  protected onScan(event: Event): void {
    event.preventDefault();
    const value = this.capture.value.trim();
    this.capture.setValue('');
    if (value) {
      this.addToken(value);
    }
  }

  protected onCaptureBlur(): void {
    if (!this.listening()) {
      return;
    }
    // Reclaim focus only if it fell to nothing; never steal it from a real control.
    setTimeout(() => {
      const el = this.captureInput()?.nativeElement;
      const active = document.activeElement;
      if (el && this.listening() && (active === document.body || active === null)) {
        el.focus();
      }
    });
  }

  protected refocus(): void {
    if (this.listening()) {
      this.captureInput()?.nativeElement.focus();
    }
  }

  protected submitPaste(popover: Popover): void {
    const raw = this.pasteControl.value.trim();
    if (!raw) {
      return;
    }
    this.pasteControl.setValue('');
    popover.hide();
    for (const token of raw.split(/[\s,;]+/)) {
      this.addToken(token);
    }
    setTimeout(() => this.refocus());
  }

  protected removeStaged(key: string): void {
    this.staged.update((list) => list.filter((unit) => unit.key !== key));
    this.refocus();
  }

  protected clearStaged(popover: Popover): void {
    popover.hide();
    this.staged.set([]);
    this.commitError.set(null);
    this.refocus();
  }

  // --- Per-row enrich ---

  protected openEnrich(key: string, event: Event, popover: Popover): void {
    const unit = this.staged().find((staged) => staged.key === key);
    if (!unit) {
      return;
    }
    this.editKey.set(key);
    this.editSerial.setValue(unit.serialNumber);
    this.editAsset.setValue(unit.assetTag);
    this.enrichError.set(null);
    popover.toggle(event);
  }

  protected saveEnrich(popover: Popover): void {
    const key = this.editKey();
    if (!key) {
      return;
    }
    const unit = this.staged().find((staged) => staged.key === key);
    if (!unit) {
      return;
    }
    const serialNumber = this.editSerial.value.trim();
    const assetTag = this.editAsset.value.trim();
    // A unit must keep at least one identifier; the backend rejects an empty one.
    if (!unit.rfidTag && !serialNumber && !assetTag) {
      this.enrichError.set('Keep at least a serial or asset tag.');
      return;
    }
    this.staged.update((list) =>
      list.map((staged) => (staged.key === key ? { ...staged, serialNumber, assetTag } : staged)),
    );
    popover.hide();
    this.refocus();
  }

  // --- Commit ---

  protected register(): void {
    const locationId = this.locationId();
    if (!locationId || this.committing() || this.count() === 0 || this.overLimit()) {
      return;
    }
    // Resolve the chosen reason (Initial stock / Purchase) to the org's matching system movement
    // type. Fail loud rather than omit the field: omitting it would silently default to "Initial
    // Stock" server-side even when the user picked "Purchase", corrupting the audit trail.
    const stockMovementTypeId = this.stockMovementTypes().find(
      (type) => type.systemKey === this.reason(),
    )?.id;
    if (!stockMovementTypeId) {
      this.commitError.set('Could not resolve the selected reason to a movement type. Try again.');
      return;
    }
    this.committing.set(true);
    this.commitError.set(null);

    this.service
      .register({
        productId: this.product().id,
        locationId,
        stockMovementTypeId,
        supplierId: this.supplierId() ?? undefined,
        note: this.note.value.trim() || undefined,
        units: this.staged().map((unit) => ({
          rfidTag: unit.rfidTag || undefined,
          serialNumber: unit.serialNumber || undefined,
          assetTag: unit.assetTag || undefined,
        })),
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.committing.set(false)),
      )
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.phase.set('result');
          this.committed.emit();
        },
        error: (error: unknown) => this.commitError.set(httpErrorMessage(error)),
      });
  }

  // --- Result actions ---

  /** Keep the setup (location, reason, supplier) and sweep another batch. */
  protected registerMore(): void {
    this.staged.set([]);
    this.commitError.set(null);
    this.result.set(null);
    this.phase.set('capturing');
  }

  protected done(): void {
    this.exited.emit();
  }

  private addToken(raw: string): void {
    const value = raw.trim();
    if (!value) {
      return;
    }
    if (this.isStaged(value)) {
      this.flagDuplicate(value);
      return;
    }
    // Every captured token is an EPC: the sweep anchors units by RFID tag.
    this.staged.update((list) => [
      {
        key: `u${this.keySeq++}`,
        rfidTag: value,
        serialNumber: '',
        assetTag: '',
      },
      ...list,
    ]);
  }

  private isStaged(value: string): boolean {
    return this.staged().some(
      (unit) => unit.rfidTag === value || unit.serialNumber === value || unit.assetTag === value,
    );
  }

  private flagDuplicate(value: string): void {
    this.duplicateNotice.set(value);
    if (this.duplicateTimer) {
      clearTimeout(this.duplicateTimer);
    }
    this.duplicateTimer = setTimeout(() => this.duplicateNotice.set(null), 2000);
  }

  private resetSession(): void {
    this.phase.set('setup');
    this.staged.set([]);
    this.result.set(null);
    this.commitError.set(null);
    this.capture.setValue('', { emitEvent: false });
    // Re-seed the landing location for the (possibly new) product.
    this.locationId.set(null);
    this.seedLocationFromProduct();
  }

  /** Pre-select the product's home location so most sessions skip the picker. */
  private seedLocationFromProduct(): void {
    if (this.locationId()) {
      return;
    }
    const preferred = this.product().locationId;
    if (preferred && this.locationOptions().some((option) => option.id === preferred)) {
      this.locationId.set(preferred);
    }
  }

  private loadOptions(): void {
    this.locationsService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => {
        this.locationOptions.set(items.map(({ id, name }) => ({ id, name })));
        this.seedLocationFromProduct();
      });
    this.suppliersService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) =>
        this.supplierOptions.set(items.map(({ id, name }) => ({ id, name }))),
      );
    this.stockMovementTypesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => this.stockMovementTypes.set(items));
  }
}
