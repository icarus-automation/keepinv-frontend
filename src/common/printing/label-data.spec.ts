import { Product } from '../../app/modules/products/types/product.types';
import { productToLabelData } from './label-data';

function makeProduct(overrides: Partial<Product>): Product {
  return {
    id: 'p1',
    name: 'Widget',
    description: null,
    sku: 'SKU-001',
    barcode: null,
    brand: null,
    imageUrl: null,
    costPrice: '100',
    sellingPrice: '150',
    quantityOnHand: 0,
    reorderPoint: null,
    reorderUrl: null,
    reorderPlatform: null,
    isSerialized: false,
    isArchived: false,
    categoryId: 'c1',
    category: { id: 'c1', name: 'Cat' } as Product['category'],
    supplierId: null,
    supplier: null,
    locationId: null,
    location: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('productToLabelData', () => {
  it('encodes the barcode when present', () => {
    const data = productToLabelData(makeProduct({ barcode: '4801234567890' }));
    expect(data.barcodeValue).toBe('4801234567890');
  });

  it('falls back to the SKU when there is no barcode', () => {
    const data = productToLabelData(makeProduct({ barcode: null, sku: 'SKU-001' }));
    expect(data.barcodeValue).toBe('SKU-001');
  });

  it('treats a blank barcode as absent and uses the SKU', () => {
    const data = productToLabelData(makeProduct({ barcode: '   ', sku: 'SKU-001' }));
    expect(data.barcodeValue).toBe('SKU-001');
  });

  it('combines brand and price into the secondary line', () => {
    const data = productToLabelData(makeProduct({ brand: 'Acme', sellingPrice: '54990' }));
    expect(data.secondary).toContain('Acme');
    expect(data.secondary).toContain('54,990');
  });

  it('omits the secondary line when there is no brand or price', () => {
    const data = productToLabelData(makeProduct({ brand: null, sellingPrice: '' }));
    expect(data.secondary).toBe('');
  });
});
