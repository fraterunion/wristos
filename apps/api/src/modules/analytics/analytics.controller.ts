import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { AnalyticsPeriodDto } from './dto/analytics-period.dto';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  summary(@CurrentUser() user: CurrentUserType) {
    return this.analyticsService.getSummary(user.tenantId);
  }

  @Get('inventory-aging')
  inventoryAging(@CurrentUser() user: CurrentUserType) {
    return this.analyticsService.getInventoryAging(user.tenantId);
  }

  @Get('pipeline')
  pipeline(@CurrentUser() user: CurrentUserType) {
    return this.analyticsService.getPipeline(user.tenantId);
  }

  @Get('revenue-over-time')
  revenueOverTime(
    @CurrentUser() user: CurrentUserType,
    @Query() query: AnalyticsPeriodDto,
  ) {
    return this.analyticsService.getRevenueOverTime(user.tenantId, query.period);
  }

  @Get('sales-over-time')
  salesOverTime(
    @CurrentUser() user: CurrentUserType,
    @Query() query: AnalyticsPeriodDto,
  ) {
    return this.analyticsService.getSalesOverTime(user.tenantId, query.period);
  }
}
