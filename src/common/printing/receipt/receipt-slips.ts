import { EscPosBuilder, RECEIPT_COLS, wrapText } from './escpos';

/**
 * What the printed slips need from a sale — deliberately decoupled from the POS receipt
 * snapshot so this stays a pure bytes module: the caller (the POS screen) maps its
 * `ReceiptData` here and pre-formats the date.
 */
export interface SlipItem {
  readonly name: string;
  /** The flavor ordered, printed under the drink so the kitchen scoops the right powder. */
  readonly flavor?: string;
  readonly quantity: number;
}

export interface SlipData {
  readonly shopName: string;
  /** The number the counter calls out, e.g. "#12" (or a receipt-no tail for old sales). */
  readonly orderLabel: string;
  /** Pre-formatted, e.g. "Jul 18, 1:45 PM". */
  readonly dateTime: string;
  readonly items: SlipItem[];
  /** Fixed-2 decimal string, e.g. "130.00". */
  readonly total: string;
  readonly note?: string;
}

/** Item lines print double-height, so the kitchen reads them at arm's length. */
const ITEM_HEIGHT = 2;
/**
 * The total prints double-height too — it's the line the customer checks and staff read back.
 * Height only, never width: at double width the head fits 16 columns, so a 32-column `row()`
 * would wrap the amount onto a second line. Same width, taller glyphs, one line, always.
 */
const TOTAL_HEIGHT = 2;
/** Blank lines that push a finished slip past the tear bar. */
const TEAR_FEED = 4;

function kitchenSlip(doc: EscPosBuilder, data: SlipData): void {
  doc
    .align('center')
    .bold(true)
    .line(data.shopName.toUpperCase())
    .bold(false)
    .line('KITCHEN SLIP')
    .rule();

  doc.size(2, 2).bold(true).line(data.orderLabel).bold(false).size(1, 1).line(data.dateTime).rule();

  doc.align('left');
  for (const item of data.items) {
    const prefix = `${item.quantity}x `;
    const indent = ' '.repeat(prefix.length);
    const lines = wrapText(item.name, RECEIPT_COLS - prefix.length);
    doc.size(1, ITEM_HEIGHT).bold(true);
    doc.line(`${prefix}${lines[0]}`);
    for (const continuation of lines.slice(1)) {
      doc.line(`${indent}${continuation}`);
    }
    // The flavor is the instruction the kitchen acts on, so it prints at the same arm's-length
    // size as the drink, indented under it rather than crammed onto the same line.
    if (item.flavor) {
      for (const line of wrapText(item.flavor, RECEIPT_COLS - prefix.length)) {
        doc.line(`${indent}${line}`);
      }
    }
    doc.bold(false).size(1, 1);
  }

  if (data.note) {
    doc.line();
    for (const line of wrapText(`NOTE: ${data.note}`, RECEIPT_COLS)) {
      doc.line(line);
    }
  }

  // Reset the size straight after: the builder's character size is sticky, and the tear feed
  // that follows would otherwise advance in double-height lines.
  doc
    .rule()
    .size(1, TOTAL_HEIGHT)
    .bold(true)
    .row('TOTAL', `P${data.total}`)
    .bold(false)
    .size(1, 1);
}

function queueStub(doc: EscPosBuilder, data: SlipData): void {
  doc
    .align('center')
    .line(data.shopName.toUpperCase())
    .line('YOUR ORDER NUMBER')
    .size(2, 2)
    .bold(true)
    .line(data.orderLabel)
    .bold(false)
    .size(1, 1)
    .line(data.dateTime)
    .line('Salamat po!');
}

/** The kitchen slip — the auto-print job so the kitchen never misses an order. */
export function renderKitchenSlip(data: SlipData): Uint8Array {
  const doc = new EscPosBuilder().reset();
  kitchenSlip(doc, data);
  doc.feed(TEAR_FEED);
  return doc.build();
}

/** Just the customer's number stub. */
export function renderQueueStub(data: SlipData): Uint8Array {
  const doc = new EscPosBuilder().reset();
  queueStub(doc, data);
  doc.feed(TEAR_FEED);
  return doc.build();
}

export interface SalesDayReportData {
  shopName: string;
  date: string;
  grossSales: string;
  discountTotal: string;
  netSales: string;
  salesCount: number;
  itemsSold: number;
  byPaymentMethod: { paymentMethod: string; amount: string; count: number }[];
  expensesToday: string;
  voidedCount: number;
  voidedAmount: string;
}

export interface InventoryReportItem {
  productId?: string;
  productName: string;
  sku: string;
  categoryName: string;
  openingStock: number;
  stockIn: number;
  stockOut: number;
  salesQty: number;
  closingStock: number;
}

export interface InventoryReportData {
  shopName: string;
  date: string;
  generatedAt: string;
  items: InventoryReportItem[];
}

export function renderSalesDayReport(data: SalesDayReportData): Uint8Array {
  const doc = new EscPosBuilder().reset();
  doc
    .align('center')
    .bold(true)
    .line(data.shopName.toUpperCase())
    .bold(false)
    .line('SALES DAY REPORT')
    .line(data.date)
    .rule();

  doc.align('left');
  doc.row('Gross Sales', `P${data.grossSales}`);
  doc.row('Discounts', `-P${data.discountTotal}`);
  doc.size(1, 2).bold(true).row('NET SALES', `P${data.netSales}`).bold(false).size(1, 1);
  doc.rule();

  doc.row('Transactions', `${data.salesCount}`);
  doc.row('Items Sold', `${data.itemsSold}`);
  doc.rule();

  doc.line('PAYMENT BREAKDOWN:');
  for (const m of data.byPaymentMethod) {
    doc.row(` ${m.paymentMethod} (${m.count})`, `P${m.amount}`);
  }
  doc.rule();

  doc.row('Expenses Today', `P${data.expensesToday}`);
  if (data.voidedCount > 0) {
    doc.row(`Voided (${data.voidedCount})`, `P${data.voidedAmount}`);
  }

  doc.feed(TEAR_FEED);
  return doc.build();
}

export function renderInventoryReport(data: InventoryReportData): Uint8Array {
  const doc = new EscPosBuilder().reset();
  doc
    .align('center')
    .bold(true)
    .line(data.shopName.toUpperCase())
    .bold(false)
    .line('INVENTORY CLOSE REPORT')
    .line(data.date)
    .rule();

  doc.align('left');
  for (const item of data.items) {
    doc.bold(true).line(item.productName).bold(false);
    doc.row('  Start -> Close', `${item.openingStock} -> ${item.closingStock}`);
    doc.row('  +In / -Out / Sold', `+${item.stockIn} / -${item.stockOut} / ${item.salesQty}`);
  }
  doc.rule();

  doc.feed(TEAR_FEED);
  return doc.build();
}

export function formatPlainSalesDayReport(data: SalesDayReportData): string {
  const lines = [
    `=== ${data.shopName.toUpperCase()} ===`,
    `SALES DAY REPORT (${data.date})`,
    `--------------------------------`,
    `Gross Sales: P${data.grossSales}`,
    `Discounts:   -P${data.discountTotal}`,
    `NET SALES:   P${data.netSales}`,
    `--------------------------------`,
    `Transactions: ${data.salesCount}`,
    `Items Sold:   ${data.itemsSold}`,
    `--------------------------------`,
    `PAYMENT METHODS:`,
    ...data.byPaymentMethod.map((m) => `  ${m.paymentMethod}: P${m.amount} (${m.count})`),
    `--------------------------------`,
    `Expenses Today: P${data.expensesToday}`,
  ];
  if (data.voidedCount > 0) {
    lines.push(`Voided (${data.voidedCount}): P${data.voidedAmount}`);
  }
  return lines.join('\n');
}

export function formatPlainInventoryReport(data: InventoryReportData): string {
  const lines = [
    `=== ${data.shopName.toUpperCase()} ===`,
    `INVENTORY CLOSE REPORT (${data.date})`,
    `--------------------------------`,
    ...data.items.map(
      (i) => `${i.productName} (${i.sku})\n  Start: ${i.openingStock} | In: +${i.stockIn} | Out: -${i.stockOut} | Sold: ${i.salesQty} | Close: ${i.closingStock}`,
    ),
  ];
  return lines.join('\n');
}
