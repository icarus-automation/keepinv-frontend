/**
 * Minimal ESC/POS byte builder for a 58mm thermal receipt printer (XP-58H class): 384-dot head,
 * 32 columns in Font A. Only the commands the slips need — init, alignment, emphasis, character
 * size, text, and paper feed. Text is force-sanitised to ASCII because the printer's default
 * code page has no peso sign or accents; `₱` becomes `P` and anything else non-ASCII prints as
 * itself minus diacritics, or `?`.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Printable columns across 58mm paper in Font A. */
export const RECEIPT_COLS = 32;

export type SlipAlignment = 'left' | 'center' | 'right';

const ALIGNMENT_CODES: Record<SlipAlignment, number> = { left: 0, center: 1, right: 2 };

/** Collapse to printable ASCII: peso → P, diacritics stripped, the rest → '?'. */
export function toPrintableAscii(value: string): string {
  return value
    .replace(/₱/g, 'P')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

/** Greedy word wrap into lines of at most `width` characters; hard-breaks oversized words. */
export function wrapText(value: string, width: number): string[] {
  const words = toPrintableAscii(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += width) {
        const piece = word.slice(i, i + width);
        if (piece.length === width) {
          lines.push(piece);
        } else {
          current = piece;
        }
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.length ? lines : [''];
}

export class EscPosBuilder {
  private readonly bytes: number[] = [];

  /** ESC @ — reset formatting to power-on defaults. Start every document with this. */
  reset(): this {
    this.bytes.push(ESC, 0x40);
    return this;
  }

  align(alignment: SlipAlignment): this {
    this.bytes.push(ESC, 0x61, ALIGNMENT_CODES[alignment]);
    return this;
  }

  bold(on: boolean): this {
    this.bytes.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  /** GS ! — character cell multiplier. The slips only ever need 1x or 2x. */
  size(width: 1 | 2, height: 1 | 2): this {
    this.bytes.push(GS, 0x21, ((width - 1) << 4) | (height - 1));
    return this;
  }

  text(value: string): this {
    for (const char of toPrintableAscii(value)) {
      this.bytes.push(char.charCodeAt(0));
    }
    return this;
  }

  line(value = ''): this {
    this.text(value);
    this.bytes.push(LF);
    return this;
  }

  rule(char = '-'): this {
    return this.line(char.repeat(RECEIPT_COLS));
  }

  /** One line with `left` and `right` pushed to the edges; the left side yields when tight. */
  row(left: string, right: string): this {
    const rightText = toPrintableAscii(right);
    const maxLeft = Math.max(0, RECEIPT_COLS - rightText.length - 1);
    const leftText = toPrintableAscii(left).slice(0, maxLeft);
    const padding = ' '.repeat(Math.max(1, RECEIPT_COLS - leftText.length - rightText.length));
    return this.line(`${leftText}${padding}${rightText}`);
  }

  /** ESC d — feed n blank lines (used to push the slip past the tear bar). */
  feed(lines: number): this {
    this.bytes.push(ESC, 0x64, Math.max(0, Math.min(255, lines)));
    return this;
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}
