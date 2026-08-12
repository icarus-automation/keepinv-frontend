import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UpperCasePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';

import { httpErrorMessage } from '../../../common/http/http-error-message';
import { MoneyPipe } from '../products/utils/money.pipe';
import { ReceiptPrintService } from '../pos/services/receipt-print.service';
import { OrganizationService } from '../organization/services/organization.service';
import { EndOfDayService } from './end-of-day.service';
import {
  InventoryReportData,
  SalesDayReportData,
  formatPlainInventoryReport,
  formatPlainSalesDayReport,
  renderInventoryReport,
  renderSalesDayReport,
} from '../../../common/printing/receipt/receipt-slips';

type ReportTab = 'sales' | 'inventory';

function manilaDateKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

@Component({
  selector: 'app-end-of-day',
  imports: [
    ReactiveFormsModule,
    UpperCasePipe,
    MoneyPipe,
    ButtonModule,
    DatePickerModule,
  ],
  templateUrl: './end-of-day.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EndOfDay {
  private readonly service = inject(EndOfDayService);
  private readonly printService = inject(ReceiptPrintService);
  private readonly orgService = inject(OrganizationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly activeTab = signal<ReportTab>('sales');
  protected readonly dateControl = new FormControl<Date>(new Date(), { nonNullable: true });
  protected readonly isOwnerOrAdmin = computed(() => {
    const role = this.orgService.myRole();
    return role === 'owner' || role === 'admin';
  });

  protected readonly salesReport = signal<SalesDayReportData | null>(null);
  protected readonly inventoryReport = signal<InventoryReportData | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly copySuccess = signal(false);
  protected readonly printBusy = signal(false);

  constructor() {
    this.dateControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load());

    this.load();
  }

  protected setTab(tab: ReportTab): void {
    this.activeTab.set(tab);
    if (tab === 'inventory' && !this.inventoryReport() && this.isOwnerOrAdmin()) {
      this.load();
    }
  }

  protected load(): void {
    const d = this.dateControl.value;
    const dateStr = manilaDateKey(d);
    this.loading.set(true);
    this.error.set(null);

    if (this.activeTab() === 'sales' || !this.isOwnerOrAdmin()) {
      this.service
        .getSalesDayReport(dateStr)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (data) => {
            const orgName = this.orgService.organization()?.name ?? 'keep inv';
            this.salesReport.set({ ...data, shopName: orgName });
            this.loading.set(false);
          },
          error: (err: unknown) => {
            this.error.set(httpErrorMessage(err));
            this.loading.set(false);
          },
        });
    } else {
      this.service
        .getInventoryCloseReport(dateStr)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (data) => {
            const orgName = this.orgService.organization()?.name ?? 'keep inv';
            this.inventoryReport.set({ ...data, shopName: orgName });
            this.loading.set(false);
          },
          error: (err: unknown) => {
            this.error.set(httpErrorMessage(err));
            this.loading.set(false);
          },
        });
    }
  }

  protected copySummary(): void {
    let text = '';
    if (this.activeTab() === 'sales' && this.salesReport()) {
      text = formatPlainSalesDayReport(this.salesReport()!);
    } else if (this.inventoryReport()) {
      text = formatPlainInventoryReport(this.inventoryReport()!);
    }

    if (text && navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => {
        this.copySuccess.set(true);
        setTimeout(() => this.copySuccess.set(false), 2000);
      });
    }
  }

  protected printThermal(): void {
    if (!this.printService.supported) return;
    this.printBusy.set(true);

    let bytes: Uint8Array | null = null;
    if (this.activeTab() === 'sales' && this.salesReport()) {
      bytes = renderSalesDayReport(this.salesReport()!);
    } else if (this.inventoryReport()) {
      bytes = renderInventoryReport(this.inventoryReport()!);
    }

    if (bytes) {
      void this.printService.printBytesInteractive(bytes).finally(() => this.printBusy.set(false));
    } else {
      this.printBusy.set(false);
    }
  }
}
