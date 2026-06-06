import type { PaymentMethod, Prisma, SaleStatus } from '@prisma/client';

export const POS_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

export const POS_SALE_LIST_INCLUDE = {
  cashier: { select: POS_USER_SELECT },
  voidedBy: { select: POS_USER_SELECT },
  _count: { select: { items: true } },
} satisfies Prisma.SaleInclude;

export const POS_SALE_INCLUDE = {
  cashier: { select: POS_USER_SELECT },
  voidedBy: { select: POS_USER_SELECT },
  items: {
    include: {
      product: true,
      productUnit: true,
    },
    orderBy: { createdAt: 'asc' },
  },
  stockMovements: {
    include: {
      product: true,
      productUnit: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.SaleInclude;

export type PosUser = Prisma.UserGetPayload<{ select: typeof POS_USER_SELECT }>;

export type PosSaleListItem = Prisma.SaleGetPayload<{
  include: typeof POS_SALE_LIST_INCLUDE;
}>;

export type PosSaleWithRelations = Prisma.SaleGetPayload<{
  include: typeof POS_SALE_INCLUDE;
}>;

export interface PosSearchItem {
  kind: 'PRODUCT' | 'PRODUCT_UNIT';
  productId: string;
  productUnitId?: string;
  name: string;
  sku: string;
  barcode: string | null;
  brand: string | null;
  sellingPrice: string;
  quantityOnHand: number;
  isSerialized: boolean;
  unitIdentifier?: string;
  unitStatus?: string;
  isSellable: boolean;
}

export interface ReceiptItemData {
  productId: string;
  productUnitId?: string;
  name: string;
  sku: string;
  barcode: string | null;
  unitIdentifier?: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface ReceiptData {
  saleId: string;
  receiptNo: string;
  status: SaleStatus;
  completedAt: string;
  cashier: {
    id: string;
    name: string;
    email: string;
  };
  items: ReceiptItemData[];
  totals: {
    subtotal: string;
    total: string;
  };
  payment: {
    method: PaymentMethod;
    amountTendered: string;
    changeDue: string;
  };
  note?: string;
}

export interface PosSaleResult {
  sale: PosSaleWithRelations;
  receiptData: ReceiptData;
}
