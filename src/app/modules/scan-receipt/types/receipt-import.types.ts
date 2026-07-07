/**
 * Contract types for the receipt-imports API, mirrored from the backend
 * (`receipt-imports.service.ts` / `receipt-import.dto.ts`).
 * Flow: POST /receipt-imports/scan (multipart) → user reviews → POST /receipt-imports/commit.
 */

/** Per-line product match outcome from the scan preview. */
export type ScanMatchStatus = 'MATCHED' | 'NEW' | 'NEEDS_REVIEW' | 'REJECTED';

/** The slice of a catalog product the scan preview returns for matches/suggestions. */
export interface MatchedProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  quantityOnHand: number;
  isSerialized: boolean;
}

/** A near-name (pg_trgm) match the user can accept by setting `productId` on the commit line. */
export interface FuzzySuggestion {
  product: MatchedProduct;
  similarity: number;
}

/** OCR per-field confidence for one receipt line (0..1). */
export interface ScanLineConfidence {
  productName: number;
  quantity: number;
  unitCost: number;
}

export interface ReceiptScanItem {
  line: number;
  rawName: string;
  normalizedName: string;
  quantity: number;
  unitCost: number;
  lineTotal: number | null;
  productCode: string | null;
  /** Human-readable SKU candidate for a line that will create a new product; null when matched. */
  suggestedSku: string | null;
  confidence: ScanLineConfidence;
  match: {
    status: ScanMatchStatus;
    matchedProduct: MatchedProduct | null;
    suggestions: FuzzySuggestion[];
    reason: string;
  };
}

export interface ScanSupplier {
  id: string;
  name: string;
}

export interface ReceiptScanResult {
  /** Server-issued; echoed as `source.idempotencyKey` on commit so retries can't double-stock. */
  idempotencyKey: string;
  receipt: {
    merchantName: string | null;
    date: string | null;
    currency: string | null;
    subtotal: number | null;
    tax: number | null;
    total: number | null;
    confidence: {
      merchantName: number;
      date: number;
      total: number;
    };
  };
  supplier: {
    action: 'MATCH_SUPPLIER' | 'CREATE_SUPPLIER';
    matchedSupplier: ScanSupplier | null;
  };
  items: ReceiptScanItem[];
  overallConfidence: number;
  canCommit: boolean;
}

/** One line of the commit payload. `confidence` omitted = user-reviewed (skips the OCR gate). */
export interface ReceiptImportItemRequest {
  rawName: string;
  /** Set when the user accepted a suggestion or picked a product manually. */
  productId?: string;
  normalizedName?: string;
  sku?: string;
  barcode?: string;
  brand?: string;
  categoryId?: string;
  /** Only sent for lines creating a NEW product; matched products keep their own flag. */
  isSerialized?: boolean;
  quantity: number;
  unitCost: number;
  lineTotal?: number;
  sellingPrice?: number;
  confidence?: ScanLineConfidence;
}

export interface ReceiptImportRequest {
  supplier: {
    name: string;
    address?: string;
    phone?: string;
  };
  receipt: {
    receiptNumber?: string;
    date?: string;
    currency?: string;
    subtotal?: number;
    tax?: number;
    total?: number;
  };
  defaults: {
    categoryId?: string;
    locationId?: string;
    reorderPoint?: number;
    sellingPriceMarkupPercent?: number;
  };
  items: ReceiptImportItemRequest[];
  source: {
    channel?: string;
    processedBy?: string;
    idempotencyKey: string;
  };
  metadata?: Record<string, unknown>;
}

export interface ReceiptImportCommit {
  supplier: {
    action: 'MATCH_SUPPLIER' | 'CREATE_SUPPLIER';
    matchedSupplier: ScanSupplier | null;
  };
  items: {
    line: number;
    rawName: string;
    normalizedName: string;
    quantity: number;
    unitCost: number;
    action: string;
    matchedProduct: MatchedProduct | null;
    reason: string;
  }[];
  canCommit: boolean;
  createdProducts: number;
  matchedProducts: number;
  stockMovementsCreated: number;
  /** Blank (untagged) units auto-created for serialized lines; tagged later via the RFID write flow. */
  unitsCreated: number;
}

/** Receipt uploads Azure accepts. Notably NOT webp; the backend rejects it with a clear 400. */
export const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/bmp,image/tiff,image/heic,image/heif,application/pdf';
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
