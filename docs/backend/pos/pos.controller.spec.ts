import { Test, TestingModule } from '@nestjs/testing';
import { PaymentMethod, RoleEnum } from '@prisma/client';

import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { CheckoutPosDTO } from './dto/checkout-pos.dto';
import { FilterSalesDTO } from './dto/filter-sales.dto';
import { SearchPosItemsDTO } from './dto/search-pos-items.dto';
import type { AuthenticatedUser } from '../auth/types/auth.types';

type PosServiceMock = Record<
  'searchItems' | 'checkout' | 'getAllSales' | 'getSale' | 'voidSale',
  jest.Mock
>;

describe('PosController', () => {
  let controller: PosController;
  let service: PosServiceMock;

  beforeEach(async () => {
    service = {
      searchItems: jest.fn(),
      checkout: jest.fn(),
      getAllSales: jest.fn(),
      getSale: jest.fn(),
      voidSale: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PosController],
      providers: [{ provide: PosService, useValue: service }],
    }).compile();

    controller = module.get<PosController>(PosController);
  });

  it('delegates item search with the query object', async () => {
    const query: SearchPosItemsDTO = { search: 'USB', limit: 20 };
    await controller.searchItems(query);
    expect(service.searchItems).toHaveBeenCalledWith(query);
  });

  it('delegates checkout with the authenticated cashier id', async () => {
    const user: AuthenticatedUser = {
      id: 'user-1',
      email: 'cashier@example.test',
      role: RoleEnum.USER,
    };
    const body: CheckoutPosDTO = {
      items: [{ productId: 'product-1', quantity: 1 }],
      paymentMethod: PaymentMethod.CASH,
      amountTendered: 100,
    };

    await controller.checkout(user, body);

    expect(service.checkout).toHaveBeenCalledWith(user.id, body);
  });

  it('delegates sale list and detail reads', async () => {
    const filter: FilterSalesDTO = { page: 1, limit: 10 };
    await controller.getAllSales(filter);
    await controller.getSale('sale-1');

    expect(service.getAllSales).toHaveBeenCalledWith(filter);
    expect(service.getSale).toHaveBeenCalledWith('sale-1');
  });

  it('delegates voiding with the authenticated cashier id', async () => {
    const user: AuthenticatedUser = {
      id: 'user-1',
      email: 'cashier@example.test',
      role: RoleEnum.USER,
    };
    const body = { reason: 'Cashier mistake' };

    await controller.voidSale(user, 'sale-1', body);

    expect(service.voidSale).toHaveBeenCalledWith(user.id, 'sale-1', body);
  });
});
