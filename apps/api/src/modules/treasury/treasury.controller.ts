import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { RecordPhysicalCashBalanceDto } from './dto/record-physical-cash-balance.dto';
import { RegisterTreasuryTransferDto } from './dto/register-treasury-transfer.dto';
import { TreasuryTransferService } from './treasury-transfer.service';
import { TreasuryService } from './treasury.service';

@Controller('treasury')
@UseGuards(JwtAuthGuard)
export class TreasuryController {
  constructor(
    private readonly treasuryService: TreasuryService,
    private readonly treasuryTransferService: TreasuryTransferService,
  ) {}

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

  /**
   * Canonical internal liquidity transfer (Commit 22A).
   * Atomic OUTFLOW + INFLOW; total liquidity Δ0; not income/expense/capital.
   */
  @Post('transfers')
  async registerTransfer(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: RegisterTreasuryTransferDto,
  ) {
    const result = await this.treasuryTransferService.register(user.tenantId, {
      sourceAccount: dto.sourceAccount,
      destinationAccount: dto.destinationAccount,
      amount: dto.amount,
      transferDate: dto.transferDate ? new Date(dto.transferDate) : undefined,
      notes: dto.notes,
      registerIdempotencyKey: dto.registerIdempotencyKey,
      actorUserId: user.userId,
    });

    return {
      transferId: result.transferId,
      sourceAccount: result.sourceAccount,
      destinationAccount: result.destinationAccount,
      amount: result.amount.toFixed(2),
      currency: result.currency,
      replayed: result.replayed,
      outflowEntry: {
        id: result.outflowEntry.id,
        account: result.outflowEntry.account,
        direction: result.outflowEntry.direction,
        amountMxn: result.outflowEntry.amountMxn.toFixed(2),
        transactionDate: result.outflowEntry.transactionDate.toISOString(),
        provenanceKey: result.outflowEntry.provenanceKey,
        deletedAt: result.outflowEntry.deletedAt,
      },
      inflowEntry: {
        id: result.inflowEntry.id,
        account: result.inflowEntry.account,
        direction: result.inflowEntry.direction,
        amountMxn: result.inflowEntry.amountMxn.toFixed(2),
        transactionDate: result.inflowEntry.transactionDate.toISOString(),
        provenanceKey: result.inflowEntry.provenanceKey,
        deletedAt: result.inflowEntry.deletedAt,
      },
    };
  }

  @Get('transfers/:transferId')
  async getTransfer(
    @CurrentUser() user: CurrentUserType,
    @Param('transferId') transferId: string,
  ) {
    const found = await this.treasuryTransferService.findByTransferId(
      user.tenantId,
      transferId,
    );
    if (!found) {
      return { transferId, found: false, outflow: null, inflow: null };
    }
    return {
      transferId: found.transferId,
      found: true,
      outflow: found.outflow
        ? {
            id: found.outflow.id,
            account: found.outflow.account,
            direction: found.outflow.direction,
            amountMxn: found.outflow.amountMxn.toFixed(2),
            deletedAt: found.outflow.deletedAt,
            provenanceKey: found.outflow.provenanceKey,
          }
        : null,
      inflow: found.inflow
        ? {
            id: found.inflow.id,
            account: found.inflow.account,
            direction: found.inflow.direction,
            amountMxn: found.inflow.amountMxn.toFixed(2),
            deletedAt: found.inflow.deletedAt,
            provenanceKey: found.inflow.provenanceKey,
          }
        : null,
    };
  }

  @Post('transfers/:transferId/reverse')
  async reverseTransfer(
    @CurrentUser() user: CurrentUserType,
    @Param('transferId') transferId: string,
  ) {
    const result = await this.treasuryTransferService.reverse(
      user.tenantId,
      transferId,
    );
    return {
      transferId: result.transferId,
      reversed: result.reversed,
      alreadyReversed: result.alreadyReversed,
      outflowEntryId: result.outflowEntry?.id ?? null,
      inflowEntryId: result.inflowEntry?.id ?? null,
    };
  }
}
