import { Product } from '../../app/modules/products/types/product.types';
import { formatPeso } from '../../app/modules/products/utils/money.pipe';

/** The presentation-ready content printed on a product label. */
export interface LabelData {
  /** Product name (the largest line). */
  readonly name: string;
  /** Secondary line: brand and/or price. Empty when neither applies. */
  readonly secondary: string;
  /** Value encoded in the Code128 barcode: the product barcode, or SKU as fallback. */
  readonly barcodeValue: string;
}

/** Map a saved product to its label content. Pure. */
export function productToLabelData(product: Product): LabelData {
  const parts: string[] = [];
  if (product.brand) {
    parts.push(product.brand);
  }
  const price = formatPeso(product.sellingPrice);
  if (price) {
    parts.push(price);
  }
  return {
    name: product.name,
    secondary: parts.join('  ·  '),
    barcodeValue: (product.barcode?.trim() || product.sku).trim(),
  };
}
