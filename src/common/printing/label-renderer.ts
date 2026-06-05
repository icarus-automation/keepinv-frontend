import JsBarcode from 'jsbarcode';

import { LabelBitmap } from './label-printer';
import { LabelData } from './label-data';
import { LabelSpec } from './label-spec';

const PAD = 10;
const NAME_FONT = '700 30px system-ui, sans-serif';
const NAME_LINE_HEIGHT = 32;
const NAME_MAX_LINES = 2;
const SECONDARY_FONT = '400 22px system-ui, sans-serif';
const SECONDARY_LINE_HEIGHT = 26;
const BARCODE_HEIGHT = 70;
/** Luminance below this prints as a dark dot. */
const DARK_THRESHOLD = 128;

/**
 * Rasterize label content into a 1-bit bitmap for the printer. Draws black content
 * on a white canvas (name, optional brand/price line, and a Code128 barcode pinned
 * to the bottom), then thresholds every pixel to a single printed/blank bit.
 */
export function renderLabel(data: LabelData, spec: LabelSpec): LabelBitmap {
  const canvas = document.createElement('canvas');
  canvas.width = spec.widthDots;
  canvas.height = spec.heightDots;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable.');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';

  const innerWidth = canvas.width - PAD * 2;

  ctx.font = NAME_FONT;
  let y = PAD;
  for (const line of wrapText(ctx, data.name, innerWidth, NAME_MAX_LINES)) {
    ctx.fillText(line, PAD, y);
    y += NAME_LINE_HEIGHT;
  }

  if (data.secondary) {
    ctx.font = SECONDARY_FONT;
    ctx.fillText(truncate(ctx, data.secondary, innerWidth), PAD, y);
    y += SECONDARY_LINE_HEIGHT;
  }

  const barcode = renderBarcode(data.barcodeValue, innerWidth);
  const drawWidth = Math.min(innerWidth, barcode.width);
  const drawX = PAD + (innerWidth - drawWidth) / 2;
  const drawY = canvas.height - PAD - barcode.height;
  // Nearest-neighbour keeps the bars crisp if we have to scale a wide barcode down.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(barcode, drawX, Math.max(y, drawY), drawWidth, barcode.height);

  return toBitmap(ctx, canvas.width, canvas.height);
}

/** Render a Code128 barcode to its own canvas, shrinking the module width to fit. */
function renderBarcode(value: string, maxWidth: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  for (const moduleWidth of [2, 1]) {
    JsBarcode(canvas, value, {
      format: 'CODE128',
      width: moduleWidth,
      height: BARCODE_HEIGHT,
      margin: 0,
      displayValue: true,
      fontSize: 18,
      textMargin: 2,
    });
    if (canvas.width <= maxWidth) {
      break;
    }
  }
  return canvas;
}

/** Threshold the canvas to packed 1-bpp rows (MSB first, 1 = dark = printed). */
function toBitmap(ctx: CanvasRenderingContext2D, width: number, height: number): LabelBitmap {
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const rowBytes = Math.ceil(width / 8);
  const data = new Uint8Array(rowBytes * height);

  for (let yy = 0; yy < height; yy++) {
    for (let xx = 0; xx < width; xx++) {
      const i = (yy * width + xx) * 4;
      const alpha = pixels[i + 3];
      const luminance =
        alpha === 0 ? 255 : pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
      if (luminance < DARK_THRESHOLD) {
        data[yy * rowBytes + (xx >> 3)] |= 0x80 >> (xx & 7);
      }
    }
  }

  return { widthDots: width, heightDots: height, data };
}

/** Greedy word wrap to at most `maxLines`, ellipsizing the last line on overflow. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) {
      break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  const last = lines.length - 1;
  if (last >= 0) {
    lines[last] = truncate(ctx, lines[last], maxWidth);
  }
  return lines.length ? lines : [''];
}

/** Trim text with an ellipsis until it fits `maxWidth`. */
function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}
