import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';

import { httpErrorMessage } from '../../../common/http/http-error-message';
import { MoneyPipe } from '../products/utils/money.pipe';
import { ProductUnitStatusBadge } from '../products/units/product-unit-status-badge';
import { DashboardService } from './services/dashboard.service';
import { AttentionBucket, InventoryDashboardReport } from './types/dashboard.types';

interface AttentionTile {
  readonly label: string;
  readonly count: number;
  /** Full colour class, e.g. `text-danger`. Never amber (that stays the one signal). */
  readonly tone: string;
  readonly icon: string;
}

interface AttentionList {
  readonly key: string;
  readonly label: string;
  readonly emptyHint: string;
  readonly bucket: AttentionBucket;
}

/** A labelled quantity row for the by-category / by-location bar lists. */
interface DistributionRow {
  readonly label: string;
  readonly quantity: number;
  readonly sublabel?: string;
}

/**
 * The inventory dashboard: the operator's first read on whether stock is honest and what needs
 * chasing. Stock KPIs up top, a "needs attention" strip (missing / misplaced / untagged / disposed),
 * assets broken down by category and location, and short preview lists of the units to go find. All
 * of it comes from one server snapshot; this component only renders and picks bar heights.
 */
@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, RouterLink, ButtonModule, MoneyPipe, ProductUnitStatusBadge],
  templateUrl: './dashboard.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  private readonly dashboardService = inject(DashboardService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly report = signal<InventoryDashboardReport | null>(null);

  /** No products at all: a first-run shop, not a load failure — teach instead of showing zeros. */
  protected readonly isEmpty = computed(() => {
    const report = this.report();
    return !this.loading() && !this.loadError() && report !== null && report.totals.productCount === 0;
  });

  protected readonly attentionTiles = computed<AttentionTile[]>(() => {
    const attention = this.report()?.attention;
    if (!attention) return [];
    return [
      { label: 'Missing', count: attention.missing.count, tone: 'text-danger', icon: 'pi pi-question-circle' },
      { label: 'Misplaced', count: attention.misplaced.count, tone: 'text-info', icon: 'pi pi-map-marker' },
      { label: 'Without RFID', count: attention.untagged.count, tone: 'text-muted', icon: 'pi pi-tag' },
      { label: 'Disposed', count: attention.disposedCount, tone: 'text-muted', icon: 'pi pi-trash' },
    ];
  });

  /** Only the preview lists that actually have units to show. */
  protected readonly attentionLists = computed<AttentionList[]>(() => {
    const attention = this.report()?.attention;
    if (!attention) return [];
    const lists: AttentionList[] = [
      { key: 'missing', label: 'Missing', emptyHint: '', bucket: attention.missing },
      { key: 'misplaced', label: 'Misplaced', emptyHint: '', bucket: attention.misplaced },
      { key: 'untagged', label: 'Without RFID tag', emptyHint: '', bucket: attention.untagged },
    ];
    return lists.filter((list) => list.bucket.count > 0);
  });

  /** True once everything the count tracks is accounted for — nothing missing, misplaced, or untagged. */
  protected readonly allClear = computed(() => {
    const attention = this.report()?.attention;
    return (
      attention !== undefined &&
      attention.missing.count === 0 &&
      attention.misplaced.count === 0 &&
      attention.untagged.count === 0
    );
  });

  protected readonly categoryRows = computed<DistributionRow[]>(() =>
    (this.report()?.byCategory ?? []).map((row) => ({
      label: row.categoryName,
      quantity: row.quantity,
      sublabel: `${row.productCount} product${row.productCount === 1 ? '' : 's'}`,
    })),
  );

  protected readonly locationRows = computed<DistributionRow[]>(() =>
    (this.report()?.byLocation ?? []).map((row) => ({
      label: row.locationName,
      quantity: row.quantity,
    })),
  );

  private readonly maxCategoryQuantity = computed(() =>
    Math.max(0, ...this.categoryRows().map((row) => row.quantity)),
  );
  private readonly maxLocationQuantity = computed(() =>
    Math.max(0, ...this.locationRows().map((row) => row.quantity)),
  );

  constructor() {
    this.load();
  }

  protected refresh(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.dashboardService
      .getInventoryDashboard()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (report) => this.report.set(report),
        error: (error: unknown) => this.loadError.set(httpErrorMessage(error)),
      });
  }

  protected categoryBarWidth(quantity: number): number {
    return this.barWidth(quantity, this.maxCategoryQuantity());
  }

  protected locationBarWidth(quantity: number): number {
    return this.barWidth(quantity, this.maxLocationQuantity());
  }

  /** Bar width as a percentage of the largest row, with a visible floor for any non-zero value. */
  private barWidth(quantity: number, max: number): number {
    if (quantity <= 0 || max <= 0) return 0;
    return Math.max(4, (quantity / max) * 100);
  }
}
