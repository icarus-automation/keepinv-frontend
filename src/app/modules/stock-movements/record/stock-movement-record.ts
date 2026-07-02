import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, Subject, catchError, finalize, map, of, switchMap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { AutoCompleteModule, AutoCompleteCompleteEvent } from 'primeng/autocomplete';
import { Popover, PopoverModule } from 'primeng/popover';

import { httpErrorMessage } from '../../../../common/http/http-error-message';
import { SuppliersService } from '../../suppliers/services/suppliers.service';
import { LocationsService } from '../../locations/services/locations.service';
import { ProductsService } from '../../products/services/products.service';
import { Product } from '../../products/types/product.types';
import { StockMovementsService } from '../services/stock-movements.service';
import { StockMovement } from '../types/stock-movement.types';
import { StockMovementTypesService } from '../../stock-movement-types/services/stock-movement-types.service';
import {
  StockMovementType,
  isRecordableType,
  typeIcon,
} from '../../stock-movement-types/types/stock-movement-type.types';

/** A record with the minimum a `p-select` option needs: an id and a name. */
interface NamedRecord {
  id: string;
  name: string;
}

/**
 * Records a new stock movement. Product is found by typing or scanning (querying
 * the catalog), the movement type sets the direction, and the quantity is always
 * a positive count. Supplier appears only for incoming types. On success it emits
 * the recorded movement and resets for the next entry, so receiving a delivery is
 * a fast, repeatable loop.
 */
@Component({
  selector: 'app-stock-movement-record',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    TextareaModule,
    SelectModule,
    AutoCompleteModule,
    PopoverModule,
  ],
  templateUrl: './stock-movement-record.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StockMovementRecord implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly movements = inject(StockMovementsService);
  private readonly movementTypes = inject(StockMovementTypesService);
  private readonly products = inject(ProductsService);
  private readonly suppliers = inject(SuppliersService);
  private readonly locations = inject(LocationsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly recorded = output<StockMovement>();

  /** Recordable types the operator can pick (live from the catalog, Transfer excluded). */
  protected readonly types = signal<StockMovementType[]>([]);

  protected readonly productSuggestions = signal<Product[]>([]);
  private readonly productQuery = new Subject<string>();
  protected readonly supplierOptions = signal<NamedRecord[]>([]);
  protected readonly locationOptions = signal<NamedRecord[]>([]);

  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    product: this.formBuilder.control<Product | null>(null, [Validators.required]),
    stockMovementTypeId: this.formBuilder.control<string | null>(null, [Validators.required]),
    quantity: this.formBuilder.control<number | null>(null, [
      Validators.required,
      Validators.min(1),
    ]),
    note: ['', [Validators.maxLength(500)]],
    supplierId: this.formBuilder.control<string | null>(null),
    locationId: this.formBuilder.control<string | null>(null),
  });

  private readonly selectedTypeId = toSignal(this.form.controls.stockMovementTypeId.valueChanges, {
    initialValue: this.form.controls.stockMovementTypeId.value,
  });
  /** The chosen type's full record, resolved from the loaded list. */
  protected readonly selectedType = computed(() =>
    this.types().find((type) => type.id === this.selectedTypeId()),
  );
  /** Supplier is only meaningful for incoming stock (types whose effect adds on-hand). */
  protected readonly needsSupplier = computed(() => this.selectedType()?.effect === 'INCREASE');

  protected readonly quickSupplierName = new FormControl('', { nonNullable: true });
  protected readonly quickLocationName = new FormControl('', { nonNullable: true });
  protected readonly quickBusy = signal(false);
  protected readonly quickError = signal<string | null>(null);

  ngOnInit(): void {
    this.loadOptions();

    // Resolve product search through switchMap so a newer query cancels the
    // in-flight one; out-of-order responses can't clobber fresher suggestions.
    this.productQuery
      .pipe(
        switchMap((query) =>
          this.products.list({ page: 1, limit: 10, search: query }).pipe(
            map(({ items }) => items),
            catchError(() => of<Product[]>([])),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((items) => this.productSuggestions.set(items));

    // Clear a stale supplier when switching to a type that doesn't take one.
    this.form.controls.stockMovementTypeId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((id) => {
        const type = this.types().find((option) => option.id === id);
        if (!type || type.effect !== 'INCREASE') {
          this.form.controls.supplierId.setValue(null);
        }
      });
  }

  protected searchProducts(event: AutoCompleteCompleteEvent): void {
    this.productQuery.next(event.query);
  }

  protected record(): void {
    if (this.saving()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set(this.validationMessage());
      return;
    }

    const raw = this.form.getRawValue();
    const product = raw.product;
    const stockMovementTypeId = raw.stockMovementTypeId;
    const quantity = raw.quantity;
    if (!product || !stockMovementTypeId || quantity == null) {
      return;
    }

    const note = raw.note.trim();
    this.saving.set(true);
    this.formError.set(null);
    this.movements
      .record({
        productId: product.id,
        stockMovementTypeId,
        quantity,
        note: note.length ? note : undefined,
        supplierId: this.needsSupplier() ? raw.supplierId : undefined,
        locationId: raw.locationId,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (movement) => {
          this.recorded.emit(movement);
          this.resetForNextEntry();
        },
        error: (error: unknown) => this.formError.set(httpErrorMessage(error)),
      });
  }

  /** Keep the chosen type so consecutive entries of the same kind stay fast. */
  private resetForNextEntry(): void {
    const stockMovementTypeId = this.form.controls.stockMovementTypeId.value;
    this.form.reset({
      product: null,
      stockMovementTypeId,
      quantity: null,
      note: '',
      supplierId: null,
      locationId: null,
    });
    this.formError.set(null);
    this.productSuggestions.set([]);
  }

  protected createSupplier(popover: Popover): void {
    this.runQuickCreate(
      this.quickSupplierName,
      (name) => this.suppliers.create({ name }),
      (created) => {
        this.supplierOptions.update((list) => [{ id: created.id, name: created.name }, ...list]);
        this.form.controls.supplierId.setValue(created.id);
        popover.hide();
      },
    );
  }

  protected createLocation(popover: Popover): void {
    this.runQuickCreate(
      this.quickLocationName,
      (name) => this.locations.create({ name }),
      (created) => {
        this.locationOptions.update((list) => [{ id: created.id, name: created.name }, ...list]);
        this.form.controls.locationId.setValue(created.id);
        popover.hide();
      },
    );
  }

  protected openQuick(control: FormControl<string>): void {
    this.quickError.set(null);
    control.reset('');
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

  /** PrimeIcons class for a type, for the type picker's option rows. */
  protected iconFor(type: StockMovementType): string {
    return typeIcon(type);
  }

  private loadOptions(): void {
    this.movementTypes
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => this.types.set(items.filter(isRecordableType)));
    this.suppliers
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => this.supplierOptions.set(items.map(({ id, name }) => ({ id, name }))));
    this.locations
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => this.locationOptions.set(items.map(({ id, name }) => ({ id, name }))));
  }

  private validationMessage(): string {
    const controls = this.form.controls;
    if (controls.product.invalid) {
      return 'Choose the product this movement applies to.';
    }
    if (controls.stockMovementTypeId.invalid) {
      return 'Choose a movement type.';
    }
    if (controls.quantity.invalid) {
      return 'Enter a quantity of at least 1.';
    }
    return 'Check the highlighted fields and try again.';
  }
}
