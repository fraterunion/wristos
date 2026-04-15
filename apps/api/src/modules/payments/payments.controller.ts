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
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { MarkPaymentPaidDto } from './dto/mark-payment-paid.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(user.tenantId, dto);
  }

  @Get()
  list(@CurrentUser() user: CurrentUserType, @Query() query: ListPaymentsDto) {
    return this.paymentsService.list(user.tenantId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.paymentsService.findOne(id, user.tenantId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.paymentsService.update(id, user.tenantId, dto);
  }

  @Patch(':id/mark-paid')
  markPaid(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: MarkPaymentPaidDto,
  ) {
    return this.paymentsService.markPaid(id, user.tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.paymentsService.remove(id, user.tenantId);
  }
}
