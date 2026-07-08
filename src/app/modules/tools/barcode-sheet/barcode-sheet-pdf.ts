import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';

import { Product, PRODUCT_IMAGE_PLACEHOLDER } from '../../products/types/product.types';
import { formatPeso } from '../../products/utils/money.pipe';

/** Result of building a sheet: the PDF blob, an object URL for preview/print, and its page count. */
export interface GeneratedSheet {
  blob: Blob;
  url: string;
  pages: number;
}

export interface BarcodeSheetOptions {
  /** Banner title printed at the top of every page. */
  title: string;
  /** Optional line under the title (e.g. an instruction to the cashier). */
  subtitle?: string;
}

// A4 portrait, millimetres. A roomy 2x3 grid = 6 cards per page: each card is a clean, centered
// tile with a large framed photo and a big, easy-to-scan barcode.
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 10;
const HEADER_H = 15;
const FOOTER_H = 7;
const COLS = 2;
const ROWS = 3;
const PER_PAGE = COLS * ROWS;
const COL_GAP = 8;
const ROW_GAP = 8;
const TILE_PAD = 6;

const CONTENT_W = PAGE_W - MARGIN * 2;
const CELL_W = (CONTENT_W - (COLS - 1) * COL_GAP) / COLS;
const CONTENT_TOP = MARGIN + HEADER_H;
const CONTENT_BOTTOM = PAGE_H - MARGIN - FOOTER_H;
const CELL_H = (CONTENT_BOTTOM - CONTENT_TOP - (ROWS - 1) * ROW_GAP) / ROWS;

// Vertical bands inside a card: a large photo plate up top, the barcode pinned to the bottom, and
// the name/brand/price block centered in whatever space is left between them.
const IMAGE_BAND = 36;
const BARCODE_BAND = 15;

const INK: [number, number, number] = [24, 27, 31];
const MUTED: [number, number, number] = [122, 130, 140];
const LINE: [number, number, number] = [223, 226, 230];
const PLATE: [number, number, number] = [248, 249, 251];

/** Rasterised at this many px per side, on white, for a crisp tile photo. */
const IMAGE_RASTER_PX = 440;

/**
 * Build the printable barcode catalog sheet. Photos are fetched and re-rasterised onto a white
 * square (so any source format and any leftover transparency render consistently), and each
 * barcode is drawn with JsBarcode. Returns a PDF blob plus an object URL the caller owns and must
 * revoke when done.
 */
export async function buildBarcodeSheet(
  products: Product[],
  options: BarcodeSheetOptions,
): Promise<GeneratedSheet> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const images = await loadImages(products);
  const pages = Math.max(1, Math.ceil(products.length / PER_PAGE));

  products.forEach((product, index) => {
    const positionOnPage = index % PER_PAGE;
    if (index > 0 && positionOnPage === 0) {
      doc.addPage();
    }
    if (positionOnPage === 0) {
      drawHeader(doc, options, Math.floor(index / PER_PAGE) + 1, pages);
    }

    const col = positionOnPage % COLS;
    const row = Math.floor(positionOnPage / COLS);
    const x = MARGIN + col * (CELL_W + COL_GAP);
    const y = CONTENT_TOP + row * (CELL_H + ROW_GAP);

    drawTile(doc, x, y, product, index + 1, images.get(product.id) ?? null);
  });

  const blob = doc.output('blob');
  return { blob, url: URL.createObjectURL(blob), pages };
}

function drawHeader(
  doc: jsPDF,
  options: BarcodeSheetOptions,
  page: number,
  pages: number,
): void {
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(options.title, PAGE_W / 2, MARGIN + 6, { align: 'center' });

  if (options.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(options.subtitle, PAGE_W / 2, MARGIN + 11, { align: 'center' });
  }

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, CONTENT_TOP - 2, PAGE_W - MARGIN, CONTENT_TOP - 2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`Page ${page} of ${pages}`, PAGE_W / 2, PAGE_H - MARGIN + 1, { align: 'center' });
}

function drawTile(
  doc: jsPDF,
  x: number,
  y: number,
  product: Product,
  number: number,
  image: string | null,
): void {
  // Card outline.
  doc.setDrawColor(...LINE);
  doc.setFillColor(255, 255, 255);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, CELL_W, CELL_H, 3, 3, 'FD');

  const centerX = x + CELL_W / 2;
  const innerW = CELL_W - TILE_PAD * 2;

  // Photo plate: a centered, framed square that keeps every photo the same size.
  const plate = IMAGE_BAND;
  const plateX = centerX - plate / 2;
  const plateY = y + TILE_PAD;
  doc.setFillColor(...PLATE);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(plateX, plateY, plate, plate, 2.5, 2.5, 'FD');
  if (image) {
    const inset = 1.6;
    doc.addImage(image, 'JPEG', plateX + inset, plateY + inset, plate - inset * 2, plate - inset * 2);
  }

  // Number badge in the top-left corner.
  const badge = 7;
  doc.setFillColor(...INK);
  doc.roundedRect(x + TILE_PAD, y + TILE_PAD, badge, badge, 1.6, 1.6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(String(number), x + TILE_PAD + badge / 2, y + TILE_PAD + badge / 2, {
    align: 'center',
    baseline: 'middle',
  });

  // Barcode pinned to the bottom band; text block centered in the gap above it.
  const barcodeTop = y + CELL_H - TILE_PAD - BARCODE_BAND;
  drawInfo(doc, centerX, innerW, plateY + plate, barcodeTop, product);
  if (product.barcode) {
    drawBarcode(doc, product.barcode, x, barcodeTop, innerW);
  }
}

/** Name (1–2 lines) + optional brand + price, vertically centered between the photo and barcode. */
function drawInfo(
  doc: jsPDF,
  centerX: number,
  innerW: number,
  top: number,
  bottom: number,
  product: Product,
): void {
  interface Row {
    text: string;
    weight: 'bold' | 'normal';
    size: number;
    color: [number, number, number];
    height: number;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const nameLines = (doc.splitTextToSize(product.name, innerW) as string[]).slice(0, 2);

  const rows: Row[] = nameLines.map((text) => ({
    text,
    weight: 'bold',
    size: 11,
    color: INK,
    height: 4.6,
  }));
  // Brand only earns its own line when the name is short enough to leave room.
  if (product.brand && nameLines.length === 1) {
    rows.push({
      text: truncate(doc, product.brand, innerW),
      weight: 'normal',
      size: 8,
      color: MUTED,
      height: 4.2,
    });
  }
  // jsPDF's standard fonts can't render the peso glyph; use a plain "P" prefix instead.
  rows.push({
    text: formatPeso(product.sellingPrice).replace('₱', 'P'),
    weight: 'bold',
    size: 11,
    color: INK,
    height: 5.2,
  });

  const totalH = rows.reduce((sum, row) => sum + row.height, 0);
  let cursor = top + Math.max(1.5, (bottom - top - totalH) / 2);
  for (const row of rows) {
    doc.setFont('helvetica', row.weight);
    doc.setFontSize(row.size);
    doc.setTextColor(...row.color);
    doc.text(row.text, centerX, cursor + row.height / 2, { align: 'center', baseline: 'middle' });
    cursor += row.height;
  }
}

/** Centered barcode that fills the card width while preserving its natural aspect ratio. */
function drawBarcode(doc: jsPDF, value: string, x: number, top: number, innerW: number): void {
  const canvas = barcodeCanvas(value);
  if (!canvas) {
    return;
  }
  const ratio = canvas.height / canvas.width;
  let bw = innerW;
  let bh = bw * ratio;
  if (bh > BARCODE_BAND) {
    bh = BARCODE_BAND;
    bw = bh / ratio;
  }
  const bx = x + (CELL_W - bw) / 2;
  const by = top + (BARCODE_BAND - bh) / 2;
  doc.addImage(canvas.toDataURL('image/png'), 'PNG', bx, by, bw, bh);
}

const barcodeCache = new Map<string, HTMLCanvasElement | null>();

function barcodeCanvas(value: string): HTMLCanvasElement | null {
  const cached = barcodeCache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  let canvas: HTMLCanvasElement | null = document.createElement('canvas');
  try {
    JsBarcode(canvas, value, {
      format: 'CODE128',
      width: 2,
      height: 60,
      margin: 0,
      displayValue: true,
      fontSize: 18,
      textMargin: 2,
    });
  } catch {
    // An unencodable value should skip the barcode rather than fail the whole sheet.
    canvas = null;
  }
  barcodeCache.set(value, canvas);
  return canvas;
}

/** Fetch and rasterise every product photo (deduped by URL) into a white-square JPEG data URL. */
async function loadImages(products: Product[]): Promise<Map<string, string>> {
  const byProduct = new Map<string, string>();
  const byUrl = new Map<string, Promise<string | null>>();

  await Promise.all(
    products.map(async (product) => {
      const source = product.imageUrl ?? PRODUCT_IMAGE_PLACEHOLDER;
      if (!byUrl.has(source)) {
        byUrl.set(source, rasterizeSquare(source));
      }
      const data = await byUrl.get(source)!;
      const resolved = data ?? (await placeholderData());
      if (resolved) {
        byProduct.set(product.id, resolved);
      }
    }),
  );

  return byProduct;
}

let placeholderPromise: Promise<string | null> | null = null;

/** The bundled placeholder, rasterised once and reused for every photo-less product. */
function placeholderData(): Promise<string | null> {
  placeholderPromise ??= rasterizeSquare(PRODUCT_IMAGE_PLACEHOLDER);
  return placeholderPromise;
}

/**
 * Fetch an image and draw it centered (object-contain) on a white square canvas, returning a JPEG
 * data URL. Normalises any source format and guarantees a white background for the PDF. Resolves
 * to null on any failure so one bad photo never breaks the sheet.
 */
async function rasterizeSquare(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) {
      return null;
    }
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = IMAGE_RASTER_PX;
    canvas.height = IMAGE_RASTER_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, IMAGE_RASTER_PX, IMAGE_RASTER_PX);
    const scale = Math.min(IMAGE_RASTER_PX / bitmap.width, IMAGE_RASTER_PX / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (IMAGE_RASTER_PX - w) / 2, (IMAGE_RASTER_PX - h) / 2, w, h);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return null;
  }
}

/** Trim text with an ellipsis until it fits `maxWidth` (mm) at the doc's current font. */
function truncate(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) {
    return text;
  }
  let trimmed = text;
  while (trimmed.length > 1 && doc.getTextWidth(`${trimmed}…`) > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}
