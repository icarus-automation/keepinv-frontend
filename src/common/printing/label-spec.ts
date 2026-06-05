/** Physical and layout parameters for one label size on one printer. */
export interface LabelSpec {
  /** Dots across the print head; a multiple of 8. */
  readonly widthDots: number;
  /** Printed lines along the feed. */
  readonly heightDots: number;
  /** Print density, 1..5. */
  readonly density: number;
}

/**
 * Niimbot B21 on a 50 x 30 mm roll at 203 DPI (8 dots/mm). The B21 print head is
 * 384 dots wide (~48 mm of the 50 mm liner); 30 mm of feed is ~240 lines. Density
 * 3 is the B21 default. Confirm orientation and fit with a physical test print and
 * adjust here if the content lands rotated or clipped.
 */
export const B21_LABEL_50X30: LabelSpec = {
  widthDots: 384,
  heightDots: 240,
  density: 3,
};
