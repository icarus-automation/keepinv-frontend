import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PaymentMethod,
  Prisma,
  Product,
  ProductUnitStatus,
  SaleStatus,
  StockMovementType,
} from '@prisma/client';

import { PrismaService } from '../../core/database/prisma.service';
import { PaginatedResponse } from '../../common/responses/paginated-api.response';
import { CheckoutPosDTO, CheckoutPosItemDTO } from './dto/checkout-pos.dto';
import { FilterSalesDTO } from './dto/filter-sales.dto';
import { SearchPosItemsDTO } from './dto/search-pos-items.dto';
import { VoidSaleDTO } from './dto/void-sale.dto';
import {
  POS_SALE_INCLUDE,
  POS_SALE_LIST_INCLUDE,
  POS_USER_SELECT,
  PosSaleListItem,
  PosSaleResult,
  PosSaleWithRelations,
  PosSearchItem,
  PosUser,
  ReceiptData,
  ReceiptItemData,
} from './types/pos.types';

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

type ProductUnitWithProduct = Prisma.ProductUnitGetPayload<{
  include: { product: true };
}>;

interface NormalizedCheckoutItem {
  productId: string;
  productUnitId?: string;
  quantity: number;
}

interface PreparedSaleLine {
  product: Product;
  productUnit?: ProductUnitWithProduct;
  quantity: number;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  unitIdentifier?: string;
  locationId: string | null;
}

interface SaleTotals {
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
  amountTendered: Prisma.Decimal;
  changeDue: Prisma.Decimal;
}

const SELLABLE_UNIT_STATUSES = new Set<ProductUnitStatus>([
  ProductUnitStatus.IN_STOCK,
  ProductUnitStatus.RESERVED,
  ProductUnitStatus.RETURNED,
]);

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService) {}

  async searchItems(query: SearchPosItemsDTO): Promise<PosSearchItem[]> {
    const where: Prisma.ProductWhereInput = {
      isArchived: false,
      OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
        { barcode: { contains: query.search, mode: 'insensitive' } },
      ],
    };

    const unitWhere: Prisma.ProductUnitWhereInput = {
      product: { isArchived: false },
      OR: [
        { assetTag: { contains: query.search, mode: 'insensitive' } },
        { serialNumber: { contains: query.search, mode: 'insensitive' } },
        { rfidTag: { contains: query.search, mode: 'insensitive' } },
      ],
    };

    const [products, units] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        take: query.limit,
      }),
      this.prisma.productUnit.findMany({
        where: unitWhere,
        include: { product: true },
        orderBy: [
          { product: { name: 'asc' } },
          { assetTag: 'asc' },
          { serialNumber: 'asc' },
          { rfidTag: 'asc' },
        ],
        take: query.limit,
      }),
    ]);

    return [
      ...products.map((product) => this.toProductSearchItem(product)),
      ...units.map((unit) => this.toProductUnitSearchItem(unit)),
    ].slice(0, query.limit);
  }

  async checkout(userId: string, body: CheckoutPosDTO): Promise<PosSaleResult> {
    const normalizedItems = this.normalizeCheckoutItems(body.items);

    return this.prisma.$transaction(async (tx) => {
      const cashier = await this.getCashier(userId, tx);
      const lines = await this.prepareSaleLines(normalizedItems, tx);
      const totals = this.calculateTotals(lines, body.amountTendered);
      const completedAt = new Date();
      const receiptNo = this.generateReceiptNo(completedAt);
      const saleId = randomUUID();
      const receiptData = this.buildReceiptData({
        saleId,
        receiptNo,
        status: SaleStatus.COMPLETED,
        completedAt,
        cashier,
        lines,
        totals,
        paymentMethod: body.paymentMethod,
        note: body.note,
      });

      await tx.sale.create({
        data: {
          id: saleId,
          receiptNo,
          status: SaleStatus.COMPLETED,
          subtotal: totals.subtotal,
          total: totals.total,
          amountTendered: totals.amountTendered,
          changeDue: totals.changeDue,
          paymentMethod: body.paymentMethod,
          note: body.note,
          receiptSnapshot: receiptData as unknown as Prisma.InputJsonValue,
          paidAt: completedAt,
          completedAt,
          cashierId: userId,
        },
      });

      for (const line of lines) {
        await this.createSaleItemAndMovement(tx, {
          saleId,
          userId,
          receiptNo,
          note: body.note,
          line,
        });
      }

      const sale = await this.findSaleOrThrow(saleId, tx);
      return this.toSaleResult(sale);
    });
  }

  async getAllSales(filter: FilterSalesDTO): Promise<PaginatedResponse<PosSaleListItem>> {
    const { page, limit } = filter;
    const where = this.buildSaleWhere(filter);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        include: POS_SALE_LIST_INCLUDE,
        orderBy: { completedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sale.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, lastPage: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async getSale(id: string): Promise<PosSaleResult> {
    const sale = await this.findSaleOrThrow(id, this.prisma);
    return this.toSaleResult(sale);
  }

  async voidSale(userId: string, id: string, body: VoidSaleDTO): Promise<PosSaleResult> {
    return this.prisma.$transaction(async (tx) => {
      const sale = await this.findSaleOrThrow(id, tx);
      if (sale.status === SaleStatus.VOIDED) {
        throw new BadRequestException('Sale has already been voided');
      }

      await this.getCashier(userId, tx);

      for (const item of sale.items) {
        const originalMovement = sale.stockMovements.find(
          (movement) => movement.saleItemId === item.id && movement.type === StockMovementType.SALE,
        );
        const locationId = originalMovement?.locationId ?? item.product.locationId;

        if (item.productUnitId) {
          await this.restoreSerializedItem(tx, {
            sale,
            saleItemId: item.id,
            productId: item.productId,
            productUnitId: item.productUnitId,
            locationId,
            userId,
            reason: body.reason,
          });
          continue;
        }

        await this.restoreProductQuantity(tx, {
          sale,
          saleItemId: item.id,
          productId: item.productId,
          quantity: item.quantity,
          locationId,
          userId,
          reason: body.reason,
        });
      }

      await tx.sale.update({
        where: { id: sale.id },
        data: {
          status: SaleStatus.VOIDED,
          voidedAt: new Date(),
          voidReason: body.reason,
          voidedById: userId,
        },
      });

      return this.toSaleResult(await this.findSaleOrThrow(id, tx));
    });
  }

  private normalizeCheckoutItems(items: CheckoutPosItemDTO[]): NormalizedCheckoutItem[] {
    const normalized: NormalizedCheckoutItem[] = [];
    const productLineIndex = new Map<string, number>();
    const seenUnitIds = new Set<string>();

    for (const item of items) {
      if (item.productUnitId) {
        if (item.quantity !== 1) {
          throw new BadRequestException('Serialized sale items must have quantity 1');
        }
        if (seenUnitIds.has(item.productUnitId)) {
          throw new BadRequestException('Duplicate serialized unit in checkout');
        }

        seenUnitIds.add(item.productUnitId);
        normalized.push(item);
        continue;
      }

      const existingIndex = productLineIndex.get(item.productId);
      if (existingIndex === undefined) {
        productLineIndex.set(item.productId, normalized.length);
        normalized.push({ productId: item.productId, quantity: item.quantity });
        continue;
      }

      normalized[existingIndex].quantity += item.quantity;
    }

    return normalized;
  }

  private async prepareSaleLines(
    items: NormalizedCheckoutItem[],
    tx: Prisma.TransactionClient,
  ): Promise<PreparedSaleLine[]> {
    const lines: PreparedSaleLine[] = [];

    for (const item of items) {
      if (item.productUnitId) {
        lines.push(await this.prepareSerializedSaleLine(item, tx));
        continue;
      }

      lines.push(await this.prepareProductSaleLine(item, tx));
    }

    return lines;
  }

  private async prepareProductSaleLine(
    item: NormalizedCheckoutItem,
    tx: Prisma.TransactionClient,
  ): Promise<PreparedSaleLine> {
    const product = await tx.product.findFirst({
      where: { id: item.productId, isArchived: false },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.isSerialized) {
      throw new BadRequestException('Serialized products require a product unit scan');
    }

    return {
      product,
      quantity: item.quantity,
      unitPrice: product.sellingPrice,
      lineTotal: product.sellingPrice.mul(item.quantity),
      locationId: product.locationId,
    };
  }

  private async prepareSerializedSaleLine(
    item: NormalizedCheckoutItem,
    tx: Prisma.TransactionClient,
  ): Promise<PreparedSaleLine> {
    const productUnit = await tx.productUnit.findFirst({
      where: {
        id: item.productUnitId,
        productId: item.productId,
        product: { isArchived: false },
      },
      include: { product: true },
    });
    if (!productUnit) throw new NotFoundException('Product unit not found');
    if (!productUnit.product.isSerialized) {
      throw new BadRequestException('Product units can only be sold for serialized products');
    }
    if (!SELLABLE_UNIT_STATUSES.has(productUnit.status)) {
      throw new BadRequestException('Product unit is not available for sale');
    }

    return {
      product: productUnit.product,
      productUnit,
      quantity: 1,
      unitPrice: productUnit.product.sellingPrice,
      lineTotal: productUnit.product.sellingPrice,
      unitIdentifier: this.resolveUnitIdentifier(productUnit),
      locationId: productUnit.locationId,
    };
  }

  private calculateTotals(lines: PreparedSaleLine[], amountTendered: number): SaleTotals {
    const subtotal = lines.reduce(
      (sum, line) => sum.add(line.lineTotal),
      new Prisma.Decimal(0),
    );
    const tendered = new Prisma.Decimal(amountTendered);
    if (tendered.lt(subtotal)) {
      throw new BadRequestException('Amount tendered is less than the sale total');
    }

    return {
      subtotal,
      total: subtotal,
      amountTendered: tendered,
      changeDue: tendered.sub(subtotal),
    };
  }

  private async createSaleItemAndMovement(
    tx: Prisma.TransactionClient,
    input: {
      saleId: string;
      userId: string;
      receiptNo: string;
      note?: string;
      line: PreparedSaleLine;
    },
  ): Promise<void> {
    const { line } = input;
    const saleItem = await tx.saleItem.create({
      data: {
        saleId: input.saleId,
        productId: line.product.id,
        productUnitId: line.productUnit?.id,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        productName: line.product.name,
        productSku: line.product.sku,
        productBarcode: line.product.barcode,
        unitIdentifier: line.unitIdentifier,
      },
    });

    if (line.productUnit) {
      await this.completeSerializedSale(tx, {
        saleId: input.saleId,
        saleItemId: saleItem.id,
        userId: input.userId,
        receiptNo: input.receiptNo,
        note: input.note,
        line,
      });
      return;
    }

    await this.completeProductSale(tx, {
      saleId: input.saleId,
      saleItemId: saleItem.id,
      userId: input.userId,
      receiptNo: input.receiptNo,
      note: input.note,
      line,
    });
  }

  private async completeProductSale(
    tx: Prisma.TransactionClient,
    input: {
      saleId: string;
      saleItemId: string;
      userId: string;
      receiptNo: string;
      note?: string;
      line: PreparedSaleLine;
    },
  ): Promise<void> {
    const updatedProduct = await tx.product.update({
      where: { id: input.line.product.id },
      data: { quantityOnHand: { increment: -input.line.quantity } },
    });

    if (updatedProduct.quantityOnHand < 0) {
      throw new BadRequestException('Sale would drive stock below zero');
    }

    await tx.stockMovement.create({
      data: {
        type: StockMovementType.SALE,
        quantityChange: -input.line.quantity,
        quantityAfter: updatedProduct.quantityOnHand,
        note: input.note ?? `POS sale ${input.receiptNo}`,
        productId: input.line.product.id,
        locationId: input.line.locationId,
        userId: input.userId,
        saleId: input.saleId,
        saleItemId: input.saleItemId,
      },
    });
  }

  private async completeSerializedSale(
    tx: Prisma.TransactionClient,
    input: {
      saleId: string;
      saleItemId: string;
      userId: string;
      receiptNo: string;
      note?: string;
      line: PreparedSaleLine;
    },
  ): Promise<void> {
    const updatedProduct = await tx.product.update({
      where: { id: input.line.product.id },
      data: { quantityOnHand: { increment: -1 } },
    });

    if (updatedProduct.quantityOnHand < 0) {
      throw new BadRequestException('Sale would drive stock below zero');
    }

    const updatedUnit = await tx.productUnit.updateMany({
      where: {
        id: input.line.productUnit?.id,
        status: { in: Array.from(SELLABLE_UNIT_STATUSES) },
      },
      data: {
        status: ProductUnitStatus.SOLD,
        locationId: null,
      },
    });
    if (updatedUnit.count !== 1) {
      throw new BadRequestException('Product unit is no longer available for sale');
    }

    await tx.stockMovement.create({
      data: {
        type: StockMovementType.SALE,
        quantityChange: -1,
        quantityAfter: updatedProduct.quantityOnHand,
        note: input.note ?? `POS sale ${input.receiptNo}`,
        productId: input.line.product.id,
        productUnitId: input.line.productUnit?.id,
        locationId: input.line.locationId,
        userId: input.userId,
        saleId: input.saleId,
        saleItemId: input.saleItemId,
      },
    });
  }

  private async restoreProductQuantity(
    tx: Prisma.TransactionClient,
    input: {
      sale: PosSaleWithRelations;
      saleItemId: string;
      productId: string;
      quantity: number;
      locationId: string | null;
      userId: string;
      reason?: string;
    },
  ): Promise<void> {
    const updatedProduct = await tx.product.update({
      where: { id: input.productId },
      data: { quantityOnHand: { increment: input.quantity } },
    });

    await tx.stockMovement.create({
      data: {
        type: StockMovementType.RETURN,
        quantityChange: input.quantity,
        quantityAfter: updatedProduct.quantityOnHand,
        note: input.reason ?? `Voided POS sale ${input.sale.receiptNo}`,
        productId: input.productId,
        locationId: input.locationId,
        userId: input.userId,
        saleId: input.sale.id,
        saleItemId: input.saleItemId,
      },
    });
  }

  private async restoreSerializedItem(
    tx: Prisma.TransactionClient,
    input: {
      sale: PosSaleWithRelations;
      saleItemId: string;
      productId: string;
      productUnitId: string;
      locationId: string | null;
      userId: string;
      reason?: string;
    },
  ): Promise<void> {
    const updatedProduct = await tx.product.update({
      where: { id: input.productId },
      data: { quantityOnHand: { increment: 1 } },
    });

    await tx.productUnit.update({
      where: { id: input.productUnitId },
      data: {
        status: ProductUnitStatus.RETURNED,
        locationId: input.locationId,
      },
    });

    await tx.stockMovement.create({
      data: {
        type: StockMovementType.RETURN,
        quantityChange: 1,
        quantityAfter: updatedProduct.quantityOnHand,
        note: input.reason ?? `Voided POS sale ${input.sale.receiptNo}`,
        productId: input.productId,
        productUnitId: input.productUnitId,
        locationId: input.locationId,
        userId: input.userId,
        saleId: input.sale.id,
        saleItemId: input.saleItemId,
      },
    });
  }

  private buildSaleWhere(filter: FilterSalesDTO): Prisma.SaleWhereInput {
    const { search, status, paymentMethod, cashierId, dateFrom, dateTo } = filter;
    const where: Prisma.SaleWhereInput = {};

    if (status) where.status = status;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (cashierId) where.cashierId = cashierId;

    if (dateFrom || dateTo) {
      where.completedAt = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    if (search) {
      where.OR = [
        { receiptNo: { contains: search, mode: 'insensitive' } },
        { items: { some: { productName: { contains: search, mode: 'insensitive' } } } },
        { items: { some: { productSku: { contains: search, mode: 'insensitive' } } } },
        { items: { some: { productBarcode: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    return where;
  }

  private async getCashier(userId: string, client: PrismaClientLike): Promise<PosUser> {
    const cashier = await client.user.findFirst({
      where: { id: userId, isArchived: false },
      select: POS_USER_SELECT,
    });
    if (!cashier) throw new NotFoundException('Cashier not found');
    return cashier;
  }

  private async findSaleOrThrow(
    id: string,
    client: PrismaClientLike,
  ): Promise<PosSaleWithRelations> {
    const sale = await client.sale.findUnique({
      where: { id },
      include: POS_SALE_INCLUDE,
    });
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }

  private buildReceiptData(input: {
    saleId: string;
    receiptNo: string;
    status: SaleStatus;
    completedAt: Date;
    cashier: PosUser;
    lines: PreparedSaleLine[];
    totals: SaleTotals;
    paymentMethod: PaymentMethod;
    note?: string;
  }): ReceiptData {
    return {
      saleId: input.saleId,
      receiptNo: input.receiptNo,
      status: input.status,
      completedAt: input.completedAt.toISOString(),
      cashier: {
        id: input.cashier.id,
        name: this.formatUserName(input.cashier),
        email: input.cashier.email,
      },
      items: input.lines.map((line) => this.toReceiptItem(line)),
      totals: {
        subtotal: this.moneyString(input.totals.subtotal),
        total: this.moneyString(input.totals.total),
      },
      payment: {
        method: input.paymentMethod,
        amountTendered: this.moneyString(input.totals.amountTendered),
        changeDue: this.moneyString(input.totals.changeDue),
      },
      ...(input.note ? { note: input.note } : {}),
    };
  }

  private toReceiptItem(line: PreparedSaleLine): ReceiptItemData {
    return {
      productId: line.product.id,
      ...(line.productUnit ? { productUnitId: line.productUnit.id } : {}),
      name: line.product.name,
      sku: line.product.sku,
      barcode: line.product.barcode,
      ...(line.unitIdentifier ? { unitIdentifier: line.unitIdentifier } : {}),
      quantity: line.quantity,
      unitPrice: this.moneyString(line.unitPrice),
      lineTotal: this.moneyString(line.lineTotal),
    };
  }

  private toSaleResult(sale: PosSaleWithRelations): PosSaleResult {
    return {
      sale,
      receiptData: sale.receiptSnapshot as unknown as ReceiptData,
    };
  }

  private toProductSearchItem(product: Product): PosSearchItem {
    return {
      kind: 'PRODUCT',
      productId: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      brand: product.brand,
      sellingPrice: this.moneyString(product.sellingPrice),
      quantityOnHand: product.quantityOnHand,
      isSerialized: product.isSerialized,
      isSellable: !product.isSerialized && product.quantityOnHand > 0,
    };
  }

  private toProductUnitSearchItem(unit: ProductUnitWithProduct): PosSearchItem {
    return {
      kind: 'PRODUCT_UNIT',
      productId: unit.productId,
      productUnitId: unit.id,
      name: unit.product.name,
      sku: unit.product.sku,
      barcode: unit.product.barcode,
      brand: unit.product.brand,
      sellingPrice: this.moneyString(unit.product.sellingPrice),
      quantityOnHand: unit.product.quantityOnHand,
      isSerialized: unit.product.isSerialized,
      unitIdentifier: this.resolveUnitIdentifier(unit),
      unitStatus: unit.status,
      isSellable: SELLABLE_UNIT_STATUSES.has(unit.status),
    };
  }

  private resolveUnitIdentifier(unit: Pick<ProductUnitWithProduct, 'assetTag' | 'serialNumber' | 'rfidTag'>): string {
    return unit.assetTag ?? unit.serialNumber ?? unit.rfidTag ?? '';
  }

  private formatUserName(user: PosUser): string {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return name || user.email;
  }

  private moneyString(value: Prisma.Decimal): string {
    return value.toFixed(2);
  }

  private generateReceiptNo(date: Date): string {
    const stamp = date.toISOString().replace(/\D/g, '').slice(0, 14);
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `POS-${stamp}-${suffix}`;
  }
}
