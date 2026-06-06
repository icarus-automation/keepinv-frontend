import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { PaginatedResponse } from '../../common/responses/paginated-api.response';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PassportJwtGuard } from '../auth/guards/passport-jwt.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { CheckoutPosDTO } from './dto/checkout-pos.dto';
import { FilterSalesDTO } from './dto/filter-sales.dto';
import { SearchPosItemsDTO } from './dto/search-pos-items.dto';
import { VoidSaleDTO } from './dto/void-sale.dto';
import { PosService } from './pos.service';
import { PosSaleListItem, PosSaleResult, PosSearchItem } from './types/pos.types';

@Controller('pos')
@UseGuards(PassportJwtGuard)
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Get('search-items')
  async searchItems(@Query() query: SearchPosItemsDTO): Promise<PosSearchItem[]> {
    return this.posService.searchItems(query);
  }

  @Post('checkout')
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CheckoutPosDTO,
  ): Promise<PosSaleResult> {
    return this.posService.checkout(user.id, body);
  }

  @Get('sales')
  async getAllSales(
    @Query() filter: FilterSalesDTO,
  ): Promise<PaginatedResponse<PosSaleListItem>> {
    return this.posService.getAllSales(filter);
  }

  @Get('sales/:id')
  async getSale(@Param('id', ParseUUIDPipe) id: string): Promise<PosSaleResult> {
    return this.posService.getSale(id);
  }

  @Post('sales/:id/void')
  async voidSale(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoidSaleDTO,
  ): Promise<PosSaleResult> {
    return this.posService.voidSale(user.id, id, body);
  }
}
