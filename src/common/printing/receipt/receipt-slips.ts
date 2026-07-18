import { EscPosBuilder, RECEIPT_COLS, wrapText } from './escpos';

/**
 * What the printed slips need from a sale — deliberately decoupled from the POS receipt
 * snapshot so this stays a pure bytes module: the caller (the POS screen) maps its
 * `ReceiptData` here and pre-formats the date.
 */
export interface SlipItem {
  readonly name: string;
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
    const lines = wrapText(item.name, RECEIPT_COLS - prefix.length);
    doc.size(1, ITEM_HEIGHT).bold(true);
    doc.line(`${prefix}${lines[0]}`);
    for (const continuation of lines.slice(1)) {
      doc.line(`${' '.repeat(prefix.length)}${continuation}`);
    }
    doc.bold(false).size(1, 1);
  }

  if (data.note) {
    doc.line();
    for (const line of wrapText(`NOTE: ${data.note}`, RECEIPT_COLS)) {
      doc.line(line);
    }
  }

  doc.rule().bold(true).row('TOTAL', `P${data.total}`).bold(false);
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

/**
 * The auto-print job: the kitchen slip, a tear gap, then the customer's number-only stub. The
 * cashier tears once between them — the slip goes on the rail, the stub goes to the customer.
 */
export function renderKitchenSlipWithStub(data: SlipData): Uint8Array {
  const doc = new EscPosBuilder().reset();
  kitchenSlip(doc, data);
  doc.feed(TEAR_FEED);
  queueStub(doc, data);
  doc.feed(TEAR_FEED);
  return doc.build();
}

/** Just the kitchen slip (a reprint after a jam or a lost slip). */
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
