import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../../../../common/types/current-user.type';
import { JwtAuthGuard } from '../../../core/auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../guards/platform-admin.guard';
import { WristCaviarDryRunService } from '../services/wrist-caviar-dry-run.service';

@Controller('platform/migrations/wrist-caviar')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class WristCaviarDryRunController {
  constructor(private readonly dryRun: WristCaviarDryRunService) {}

  @Post('datasets/:datasetId/dry-runs')
  create(
    @CurrentUser() user: CurrentUserType,
    @Param('datasetId') datasetId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    const target = tenantId || user.tenantId;
    if (!target) throw new BadRequestException('tenantId is required');
    return this.dryRun.generate({
      tenantId: target,
      datasetId,
      userId: user.userId,
    });
  }

  @Get('dry-runs/:dryRunId')
  get(
    @CurrentUser() user: CurrentUserType,
    @Param('dryRunId') dryRunId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.dryRun.getDryRun(tenantId || user.tenantId, dryRunId);
  }

  @Get('dry-runs/:dryRunId/items')
  items(
    @CurrentUser() user: CurrentUserType,
    @Param('dryRunId') dryRunId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Query('entityGroup') entityGroup?: string,
    @Query('action') action?: string,
    @Query('conflictCode') conflictCode?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.dryRun.listItems(tenantId || user.tenantId, dryRunId, {
      entityGroup,
      action,
      conflictCode,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('dry-runs/:dryRunId/dependencies')
  dependencies(
    @CurrentUser() user: CurrentUserType,
    @Param('dryRunId') dryRunId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.dryRun.getDependencies(tenantId || user.tenantId, dryRunId);
  }

  @Get('dry-runs/:dryRunId/financial-summary')
  financial(
    @CurrentUser() user: CurrentUserType,
    @Param('dryRunId') dryRunId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.dryRun.getFinancialSummary(tenantId || user.tenantId, dryRunId);
  }

  @Get('dry-runs/:dryRunId/reconciliation')
  reconciliation(
    @CurrentUser() user: CurrentUserType,
    @Param('dryRunId') dryRunId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.dryRun.getReconciliation(tenantId || user.tenantId, dryRunId);
  }

  @Post('dry-runs/:dryRunId/validate-freshness')
  validateFreshness(
    @CurrentUser() user: CurrentUserType,
    @Param('dryRunId') dryRunId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.dryRun.validateFreshness(tenantId || user.tenantId, dryRunId);
  }

  @Post('dry-runs/:dryRunId/regenerate')
  regenerate(
    @CurrentUser() user: CurrentUserType,
    @Param('dryRunId') dryRunId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.dryRun.regenerate({
      tenantId: tenantId || user.tenantId,
      dryRunId,
      userId: user.userId,
    });
  }
}
