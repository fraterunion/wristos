import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { CryptoService } from './crypto.service';
import { CreateHoldingDto } from './dto/create-holding.dto';
import { CreatePriceSnapshotDto } from './dto/create-price-snapshot.dto';
import { PriceHistoryQueryDto } from './dto/price-history-query.dto';
import { UpdateHoldingDto } from './dto/update-holding.dto';

@Controller('crypto')
@UseGuards(JwtAuthGuard)
export class CryptoController {
  constructor(private readonly cryptoService: CryptoService) {}

  @Get('summary')
  summary(@CurrentUser() user: CurrentUserType) {
    return this.cryptoService.getSummary(user.tenantId);
  }

  @Get('holdings')
  listHoldings(@CurrentUser() user: CurrentUserType) {
    return this.cryptoService.listHoldings(user.tenantId);
  }

  @Post('holdings')
  createHolding(@CurrentUser() user: CurrentUserType, @Body() dto: CreateHoldingDto) {
    return this.cryptoService.createHolding(user.tenantId, dto);
  }

  @Patch('holdings/:id')
  updateHolding(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateHoldingDto,
  ) {
    return this.cryptoService.updateHolding(id, user.tenantId, dto);
  }

  @Delete('holdings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteHolding(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.cryptoService.softDeleteHolding(id, user.tenantId);
  }

  @Get('prices')
  listPrices(@CurrentUser() user: CurrentUserType) {
    return this.cryptoService.listLatestPrices(user.tenantId);
  }

  @Post('prices')
  createPrice(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreatePriceSnapshotDto,
  ) {
    return this.cryptoService.createPriceSnapshot(user.tenantId, dto, user.userId);
  }

  @Get('prices/:ticker/history')
  priceHistory(
    @CurrentUser() user: CurrentUserType,
    @Param('ticker') ticker: string,
    @Query() query: PriceHistoryQueryDto,
  ) {
    return this.cryptoService.getPriceHistory(
      user.tenantId,
      ticker,
      query.limit ?? 50,
    );
  }
}
