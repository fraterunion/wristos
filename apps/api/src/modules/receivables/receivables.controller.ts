import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { AddReceivablePaymentDto } from './dto/add-receivable-payment.dto';
import { ListReceivablesDto } from './dto/list-receivables.dto';
import { WriteOffReceivableDto } from './dto/write-off-receivable.dto';
import { ReceivablesService } from './receivables.service';

@Controller('receivables')
@UseGuards(JwtAuthGuard)
export class ReceivablesController {
  constructor(private readonly receivablesService: ReceivablesService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: CurrentUserType) {
    return this.receivablesService.dashboard(user.tenantId);
  }

  @Get()
  list(@CurrentUser() user: CurrentUserType, @Query() query: ListReceivablesDto) {
    return this.receivablesService.list(user.tenantId, query);
  }

  @Get('customers/:customerId/ledger')
  customerLedger(
    @CurrentUser() user: CurrentUserType,
    @Param('customerId') customerId: string,
  ) {
    return this.receivablesService.customerLedger(user.tenantId, customerId);
  }

  @Get(':id')
  getById(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.receivablesService.getById(user.tenantId, id);
  }

  @Post(':id/payments')
  addPayment(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: AddReceivablePaymentDto,
  ) {
    return this.receivablesService.addPayment(
      user.tenantId,
      id,
      dto,
      user.userId,
    );
  }

  @Delete(':id/payments/:paymentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  softDeletePayment(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.receivablesService.softDeletePayment(
      user.tenantId,
      id,
      paymentId,
      user.userId,
    );
  }

  @Post(':id/payments/:paymentId/reverse')
  reversePayment(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.receivablesService.reversePayment(
      user.tenantId,
      id,
      paymentId,
      user.userId,
    );
  }

  @Post(':id/write-off')
  writeOff(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: WriteOffReceivableDto,
  ) {
    return this.receivablesService.writeOff(
      user.tenantId,
      id,
      dto.reason,
      user.userId,
    );
  }
}
