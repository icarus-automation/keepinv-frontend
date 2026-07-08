import { MatchedProduct, ReceiptScanItem } from '../types/receipt-import.types';

/**
 * How a reviewed line will commit:
 * - `matched`: the scan matched an existing product (barcode / SKU / exact name).
 * - `linked`: the user accepted a fuzzy suggestion or picked a product manually.
 * - `new`: a product will be created, then stocked.
 * - `unresolved`: still needs the user's decision; blocks commit while included.
 */
export type LineResolution = 'matched' | 'linked' | 'new' | 'unresolved';

/** Editable working state for one scanned receipt line. The page owns the array. */
export interface ReviewLine {
  /** Stable identity within this scan (the backend's 1-based line number). */
  key: number;
  /** The untouched scan payload; source for rawName, confidence, and match reason. */
  scan: ReceiptScanItem;
  /** False = excluded from the commit (skipped by the user, or rejected by the scan). */
  included: boolean;
  /** True for lines the scanner rejected outright; they can never be re-included. */
  rejected: boolean;
  name: string;
  quantity: number;
  unitCost: number;
  /** SKU for a line that will create a new product. Editable; ignored once matched/linked. */
  sku: string;
  resolution: LineResolution;
  linkedProduct: MatchedProduct | null;
  /**
   * Serial (RFID) tracking for a line that will create a NEW product. Defaults on — RFID is the
   * system default. Ignored for matched/linked lines, which keep the existing product's flag.
   */
  trackSerials: boolean;
  /** Any user edit drops the OCR confidence on commit (= reviewed, skips the backend gate). */
  edited: boolean;
  /** Resolution panel visibility. */
  expanded: boolean;
}

/** Builds the initial working state from a scan line. */
export function toReviewLine(scan: ReceiptScanItem): ReviewLine {
  const rejected = scan.match.status === 'REJECTED';
  const resolution: LineResolution =
    scan.match.status === 'MATCHED' ? 'matched' : scan.match.status === 'NEW' ? 'new' : 'unresolved';
  return {
    key: scan.line,
    scan,
    included: !rejected,
    rejected,
    name: scan.normalizedName || scan.rawName,
    quantity: scan.quantity,
    unitCost: scan.unitCost,
    sku: scan.productCode || scan.suggestedSku || '',
    resolution: rejected ? 'unresolved' : resolution,
    linkedProduct: scan.match.matchedProduct,
    trackSerials: true,
    edited: false,
    expanded: !rejected && scan.match.status === 'NEEDS_REVIEW',
  };
}

/** A line blocks commit while it is included but still unresolved. */
export function isResolved(line: ReviewLine): boolean {
  return !line.included || line.resolution !== 'unresolved';
}
