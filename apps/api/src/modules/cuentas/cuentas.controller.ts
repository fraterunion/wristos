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
import { CuentasService } from './cuentas.service';
import { CreateAccountEntryDto } from './dto/create-account-entry.dto';
import { CreateAccountPaymentDto } from './dto/create-account-payment.dto';
import { ListAccountEntriesQueryDto } from './dto/list-account-entries-query.dto';
import { UpdateAccountEntryDto } from './dto/update-account-entry.dto';
import { UpdateAccountPaymentDto } from './dto/update-account-payment.dto';

@Controller('cuentas')
@UseGuards(JwtAuthGuard)
export class CuentasController {
  constructor(private readonly cuentasService: CuentasService) {}

  @Get('summary')
  summary(@CurrentUser() user: CurrentUserType) {
    return this.cuentasService.getSummary(user.tenantId);
  }

  @Get('entries')
  listEntries(
    @CurrentUser() user: CurrentUserType,
    @Query() query: ListAccountEntriesQueryDto,
  ) {
    return this.cuentasService.listEntries(user.tenantId, query);
  }

  @Post('entries')
  createEntry(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateAccountEntryDto,
  ) {
    return this.cuentasService.createEntry(user.tenantId, dto);
  }

  @Get('entries/:id')
  findEntry(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.cuentasService.findEntry(id, user.tenantId);
  }

  @Patch('entries/:id')
  updateEntry(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateAccountEntryDto,
  ) {
    return this.cuentasService.updateEntry(id, user.tenantId, dto);
  }

  @Delete('entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeEntry(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.cuentasService.removeEntry(id, user.tenantId);
  }

  @Post('entries/:id/payments')
  createPayment(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: CreateAccountPaymentDto,
  ) {
    return this.cuentasService.createPayment(id, user.tenantId, dto);
  }

  @Patch('entries/:id/payments/:paymentId')
  updatePayment(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: UpdateAccountPaymentDto,
  ) {
    return this.cuentasService.updatePayment(id, paymentId, user.tenantId, dto);
  }

  @Delete('entries/:id/payments/:paymentId')
  removePayment(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.cuentasService.removePayment(id, paymentId, user.tenantId);
  }
}
