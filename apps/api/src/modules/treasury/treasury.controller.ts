import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { RecordPhysicalCashBalanceDto } from './dto/record-physical-cash-balance.dto';
import { TreasuryService } from './treasury.service';

@Controller('treasury')
@UseGuards(JwtAuthGuard)
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  @Get('balances')
  getBalances(@CurrentUser() user: CurrentUserType) {
    return this.treasuryService.getAccountBalances(user.tenantId);
  }

  /**
   * Record a physical MXN cash count / manual balance set (César-style correction).
   * Does not rewrite historical CASH movements. USD stays separate.
   */
  @Post('cash/physical-balance')
  recordPhysicalCashBalance(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: RecordPhysicalCashBalanceDto,
  ) {
    return this.treasuryService.recordPhysicalCashBalanceAdjustment({
      tenantId: user.tenantId,
      resultingBalance: dto.resultingBalance,
      reason: dto.reason,
      source: dto.source ?? 'wristos-ui',
      actor: user.email || user.userId,
      effectiveDate: new Date(dto.effectiveDate),
      previousBalance: dto.previousBalance,
    });
  }
}
