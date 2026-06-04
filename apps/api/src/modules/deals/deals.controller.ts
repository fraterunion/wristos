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
import { PaymentsService } from '../payments/payments.service';
import { AddPaymentDto } from './dto/add-payment.dto';
import { CreateDealDto } from './dto/create-deal.dto';
import { ListDealsDto } from './dto/list-deals.dto';
import { RegisterSaleDto } from './dto/register-sale.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { UpdateDealStageDto } from './dto/update-deal-stage.dto';
import { DealsService } from './deals.service';

@Controller('deals')
@UseGuards(JwtAuthGuard)
export class DealsController {
  constructor(
    private readonly dealsService: DealsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Post()
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateDealDto) {
    return this.dealsService.create(user.tenantId, dto);
  }

  @Post('register-sale')
  registerSale(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: RegisterSaleDto,
  ) {
    return this.dealsService.registerSale(user.tenantId, dto);
  }

  @Get()
  list(@CurrentUser() user: CurrentUserType, @Query() query: ListDealsDto) {
    return this.dealsService.list(user.tenantId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.dealsService.findOne(id, user.tenantId);
  }

  @Get(':id/payment-summary')
  paymentSummary(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.paymentsService.getDealPaymentSummary(id, user.tenantId);
  }

  @Post(':id/payments')
  addPayment(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: AddPaymentDto,
  ) {
    return this.dealsService.addPayment(id, user.tenantId, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateDealDto,
  ) {
    return this.dealsService.update(id, user.tenantId, dto);
  }

  @Patch(':id/stage')
  updateStage(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateDealStageDto,
  ) {
    return this.dealsService.updateStage(id, user.tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.dealsService.remove(id, user.tenantId);
  }
}
