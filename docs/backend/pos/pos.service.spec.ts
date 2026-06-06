import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  PaymentMethod,
  Prisma,
  Product,
  ProductUnitStatus,
  SaleStatus,
  StockMovementType,
} from '@prisma/client';

import { PrismaService } from '../../core/database/prisma.service';
import { PosService } from './pos.service';

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';
const SERIALIZED_PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const PRODUCT_UNIT_ID = '33333333-3333-3333-3333-333333333333';
const LOCATION_ID = '44444444-4444-4444-4444-444444444444';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SALE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SALE_ITEM_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

interface CreatedSaleData {
  id?: string;
  receiptNo?: string;
  subtotal?: Prisma.Decimal;
  total?: Prisma.Decimal;
  amountTendered?: Prisma.Decimal;
  changeDue?: Prisma.Decimal;
  paymentMethod?: PaymentMethod;
  note?: string | null;
  receiptSnapshot?: unknown;
  cashierId?: string;
}

interface PosTxMock {
  user: { findFirst: jest.Mock };
  product: { findFirst: jest.Mock; update: jest.Mock; findMany: jest.Mock };
  productUnit: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  sale: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  saleItem: { create: jest.Mock };
  stockMovement: { create: jest.Mock };
}

type TransactionArg = ((client: PosTxMock) => unknown) | Promise<unknown>[];

const firstCallArg = <T>(mock: jest.Mock): T => {
  const calls = mock.mock.calls as unknown[][];
  return calls[0][0] as T;
};

const cashier = {
  id: USER_ID,
  email: 'cashier@example.test',
  firstName: 'Store',
  lastName: 'Cashier',
  role: 'USER',
};

const buildProduct = (overrides: Partial<Product> = {}): Product => ({
  id: PRODUCT_ID,
  name: 'USB Cable',
  description: null,
  sku: 'USB-CABLE',
  barcode: '480000000001',
  brand: null,
  costPrice: new Prisma.Decimal('50.00'),
  sellingPrice: new Prisma.Decimal('100.00'),
  quantityOnHand: 10,
  reorderPoint: null,
  isSerialized: false,
  isArchived: false,
  categoryId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  supplierId: null,
  locationId: LOCATION_ID,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const buildUnit = (overrides: Record<string, unknown> = {}) => ({
  id: PRODUCT_UNIT_ID,
  assetTag: 'ASSET-001',
  serialNumber: 'SN-001',
  rfidTag: 'EPC-001',
  status: ProductUnitStatus.IN_STOCK,
  productId: SERIALIZED_PRODUCT_ID,
  locationId: LOCATION_ID,
  createdAt: new Date(),
  updatedAt: new Date(),
  product: buildProduct({
    id: SERIALIZED_PRODUCT_ID,
    name: 'Router',
    sku: 'RTR-001',
    barcode: '480000000002',
    sellingPrice: new Prisma.Decimal('2500.00'),
    quantityOnHand: 1,
    isSerialized: true,
  }),
  ...overrides,
});

const buildSale = (overrides: Record<string, unknown> = {}) => ({
  id: SALE_ID,
  receiptNo: 'POS-20260606010101-ABC123',
  status: SaleStatus.COMPLETED,
  subtotal: new Prisma.Decimal('200.00'),
  total: new Prisma.Decimal('200.00'),
  amountTendered: new Prisma.Decimal('500.00'),
  changeDue: new Prisma.Decimal('300.00'),
  paymentMethod: PaymentMethod.CASH,
  note: null,
  receiptSnapshot: {
    saleId: SALE_ID,
    receiptNo: 'POS-20260606010101-ABC123',
    status: SaleStatus.COMPLETED,
    completedAt: new Date('2026-06-06T01:01:01.000Z').toISOString(),
    cashier: { id: USER_ID, name: 'Store Cashier', email: 'cashier@example.test' },
    items: [],
    totals: { subtotal: '200.00', total: '200.00' },
    payment: { method: PaymentMethod.CASH, amountTendered: '500.00', changeDue: '300.00' },
  },
  paidAt: new Date(),
  completedAt: new Date(),
  voidedAt: null,
  voidReason: null,
  cashierId: USER_ID,
  voidedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  cashier,
  voidedBy: null,
  items: [],
  stockMovements: [],
  ...overrides,
});

describe('PosService', () => {
  let service: PosService;
  let createdSaleData: CreatedSaleData;
  let tx: PosTxMock;
  let prisma: typeof tx & { $transaction: jest.Mock };

  beforeEach(async () => {
    createdSaleData = {};
    tx = {
      user: { findFirst: jest.fn().mockResolvedValue(cashier) },
      product: {
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      productUnit: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      sale: {
        create: jest.fn().mockImplementation(({ data }: { data: CreatedSaleData }) => {
          createdSaleData = data;
          return Promise.resolve(data);
        }),
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve(
            buildSale({
              id: createdSaleData.id ?? SALE_ID,
              receiptNo: createdSaleData.receiptNo ?? 'POS-20260606010101-ABC123',
              subtotal: createdSaleData.subtotal ?? new Prisma.Decimal('200.00'),
              total: createdSaleData.total ?? new Prisma.Decimal('200.00'),
              amountTendered: createdSaleData.amountTendered ?? new Prisma.Decimal('500.00'),
              changeDue: createdSaleData.changeDue ?? new Prisma.Decimal('300.00'),
              paymentMethod: createdSaleData.paymentMethod ?? PaymentMethod.CASH,
              note: createdSaleData.note ?? null,
              receiptSnapshot: createdSaleData.receiptSnapshot ?? buildSale().receiptSnapshot,
            }),
          ),
        ),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      saleItem: { create: jest.fn().mockResolvedValue({ id: SALE_ITEM_ID }) },
      stockMovement: { create: jest.fn().mockResolvedValue({ id: 'movement-1' }) },
    };

    prisma = {
      ...tx,
      $transaction: jest.fn().mockImplementation((arg: TransactionArg) =>
        typeof arg === 'function' ? arg(tx) : Promise.all(arg),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PosService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<PosService>(PosService);
  });

  it('completes a non-serialized checkout and writes linked stock movement rows', async () => {
    tx.product.findFirst.mockResolvedValue(buildProduct());
    tx.product.update.mockResolvedValue(buildProduct({ quantityOnHand: 8 }));

    const result = await service.checkout(USER_ID, {
      items: [{ productId: PRODUCT_ID, quantity: 2 }],
      paymentMethod: PaymentMethod.CASH,
      amountTendered: 500,
    });

    expect(result.receiptData.totals).toEqual({ subtotal: '200.00', total: '200.00' });
    expect(result.receiptData.payment.changeDue).toBe('300.00');
    const saleCreateArg = firstCallArg<{ data: CreatedSaleData }>(tx.sale.create);
    expect(saleCreateArg.data.receiptNo).toMatch(/^POS-\d{14}-[A-Z0-9]{6}$/);
    expect(saleCreateArg.data).toMatchObject({
      subtotal: new Prisma.Decimal('200.00'),
      total: new Prisma.Decimal('200.00'),
      paymentMethod: PaymentMethod.CASH,
      cashierId: USER_ID,
    });
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { quantityOnHand: { increment: -2 } },
    });
    const movementCreateArg = firstCallArg<{ data: Record<string, unknown> }>(
      tx.stockMovement.create,
    );
    expect(movementCreateArg.data).toMatchObject({
      type: StockMovementType.SALE,
      quantityChange: -2,
      quantityAfter: 8,
      productId: PRODUCT_ID,
      saleId: createdSaleData.id,
      saleItemId: SALE_ITEM_ID,
      userId: USER_ID,
    });
  });

  it('sells a specific serialized unit and marks the exact unit sold', async () => {
    tx.productUnit.findFirst.mockResolvedValue(buildUnit());
    tx.product.update.mockResolvedValue(
      buildProduct({ id: SERIALIZED_PRODUCT_ID, quantityOnHand: 0 }),
    );
    tx.productUnit.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.checkout(USER_ID, {
      items: [{ productId: SERIALIZED_PRODUCT_ID, productUnitId: PRODUCT_UNIT_ID, quantity: 1 }],
      paymentMethod: PaymentMethod.CARD,
      amountTendered: 2500,
    });

    expect(result.receiptData.items[0]).toMatchObject({
      productId: SERIALIZED_PRODUCT_ID,
      productUnitId: PRODUCT_UNIT_ID,
      unitIdentifier: 'ASSET-001',
      quantity: 1,
      unitPrice: '2500.00',
    });
    expect(tx.productUnit.updateMany).toHaveBeenCalledWith({
      where: {
        id: PRODUCT_UNIT_ID,
        status: {
          in: [
            ProductUnitStatus.IN_STOCK,
            ProductUnitStatus.RESERVED,
            ProductUnitStatus.RETURNED,
          ],
        },
      },
      data: { status: ProductUnitStatus.SOLD, locationId: null },
    });
    const movementCreateArg = firstCallArg<{ data: Record<string, unknown> }>(
      tx.stockMovement.create,
    );
    expect(movementCreateArg.data).toMatchObject({
      type: StockMovementType.SALE,
      quantityChange: -1,
      productUnitId: PRODUCT_UNIT_ID,
      locationId: LOCATION_ID,
    });
  });

  it('rejects a sale that would drive stock below zero', async () => {
    tx.product.findFirst.mockResolvedValue(buildProduct({ quantityOnHand: 1 }));
    tx.product.update.mockResolvedValue(buildProduct({ quantityOnHand: -1 }));

    await expect(
      service.checkout(USER_ID, {
        items: [{ productId: PRODUCT_ID, quantity: 2 }],
        paymentMethod: PaymentMethod.CASH,
        amountTendered: 500,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('requires serialized products to be sold by product unit', async () => {
    tx.product.findFirst.mockResolvedValue(buildProduct({ isSerialized: true }));

    await expect(
      service.checkout(USER_ID, {
        items: [{ productId: PRODUCT_ID, quantity: 1 }],
        paymentMethod: PaymentMethod.CASH,
        amountTendered: 500,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  it('voids a sale by returning inventory and writing RETURN movements', async () => {
    const completedSale = buildSale({
      items: [
        {
          id: SALE_ITEM_ID,
          quantity: 2,
          productId: PRODUCT_ID,
          productUnitId: null,
          product: buildProduct({ quantityOnHand: 8 }),
        },
      ],
      stockMovements: [
        {
          id: 'movement-sale',
          type: StockMovementType.SALE,
          saleItemId: SALE_ITEM_ID,
          locationId: LOCATION_ID,
        },
      ],
    });
    tx.sale.findUnique
      .mockResolvedValueOnce(completedSale)
      .mockResolvedValueOnce(buildSale({ status: SaleStatus.VOIDED }));
    tx.product.update.mockResolvedValue(buildProduct({ quantityOnHand: 10 }));

    await service.voidSale(USER_ID, SALE_ID, { reason: 'Cashier mistake' });

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { quantityOnHand: { increment: 2 } },
    });
    const movementCreateArg = firstCallArg<{ data: Record<string, unknown> }>(
      tx.stockMovement.create,
    );
    expect(movementCreateArg.data).toMatchObject({
      type: StockMovementType.RETURN,
      quantityChange: 2,
      quantityAfter: 10,
      note: 'Cashier mistake',
      saleId: SALE_ID,
      saleItemId: SALE_ITEM_ID,
    });
    const saleUpdateArg = firstCallArg<{ data: Record<string, unknown>; where: { id: string } }>(
      tx.sale.update,
    );
    expect(saleUpdateArg.where).toEqual({ id: SALE_ID });
    expect(saleUpdateArg.data).toMatchObject({
      status: SaleStatus.VOIDED,
      voidReason: 'Cashier mistake',
      voidedById: USER_ID,
    });
  });
});
