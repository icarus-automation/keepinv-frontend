/**
 * The seam between the app and a physical label printer. Everything above this
 * line deals in a finished 1-bit raster and an abstract `LabelPrinter`; everything
 * below it (the Niimbot/Web Bluetooth specifics) is swappable without touching
 * callers.
 */

/** A 1-bit-per-pixel label raster ready to transmit. */
export interface LabelBitmap {
  /** Dots across the print head; a multiple of 8. */
  readonly widthDots: number;
  /** Printed lines along the paper feed. */
  readonly heightDots: number;
  /** Packed rows, `(widthDots / 8) * heightDots` bytes, MSB first, 1 = printed. */
  readonly data: Uint8Array;
}

/** A label printer transport. The one interface the rest of the app depends on. */
export interface LabelPrinter {
  /** True while a live connection to a printer is held. */
  readonly connected: boolean;
  /**
   * Prompt for (or reuse) a connection. Must be called from a user gesture: it
   * opens the browser's device chooser on first use. Resolves with the device
   * name. `onDisconnect` fires if the link drops later.
   */
  connect(onDisconnect?: () => void): Promise<string>;
  disconnect(): Promise<void>;
  print(bitmap: LabelBitmap): Promise<void>;
}

/**
 * A printer failure that distinguishes a user cancelling the device chooser (not a
 * real error — stay quiet) from an actual fault the UI should surface.
 */
export class PrinterError extends Error {
  constructor(
    message: string,
    readonly cancelled = false,
  ) {
    super(message);
    this.name = 'PrinterError';
  }
}
