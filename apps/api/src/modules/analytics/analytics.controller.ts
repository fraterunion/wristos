import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { AnalyticsPeriodDto } from './dto/analytics-period.dto';
import { SalesTimelineQueryDto } from './dto/sales-timeline.dto';
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

  @Get('sales-timeline')
  salesTimeline(
    @CurrentUser() user: CurrentUserType,
    @Query() query: SalesTimelineQueryDto,
  ) {
    return this.analyticsService.getSalesTimeline(
      user.tenantId,
      query.granularity,
      query.from,
      query.to,
    );
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

  @Get('cash-flow')
  cashFlow(
    @CurrentUser() user: CurrentUserType,
    @Query() query: AnalyticsPeriodDto,
  ) {
    return this.analyticsService.getCashFlow(user.tenantId, query.period);
  }

  @Get('inventory-by-brand')
  inventoryByBrand(@CurrentUser() user: CurrentUserType) {
    return this.analyticsService.getInventoryByBrand(user.tenantId);
  }

  @Get('sales-by-brand')
  salesByBrand(@CurrentUser() user: CurrentUserType) {
    return this.analyticsService.getSalesByBrand(user.tenantId);
  }

  @Get('top-models')
  topModels(@CurrentUser() user: CurrentUserType) {
    return this.analyticsService.getTopModels(user.tenantId);
  }
}
