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
import { CapitalService } from './capital.service';
import { AnnualBreakdownQueryDto } from './dto/annual-breakdown-query.dto';
import { CreateContributionDto } from './dto/create-contribution.dto';
import { CreateDistributionDto } from './dto/create-distribution.dto';
import { CreateInvestorDto } from './dto/create-investor.dto';
import { UpdateContributionDto } from './dto/update-contribution.dto';
import { UpdateDistributionDto } from './dto/update-distribution.dto';
import { UpdateInvestorDto } from './dto/update-investor.dto';

@Controller('capital')
@UseGuards(JwtAuthGuard)
export class CapitalController {
  constructor(private readonly capitalService: CapitalService) {}

  @Get('summary')
  summary(@CurrentUser() user: CurrentUserType) {
    return this.capitalService.getSummary(user.tenantId);
  }

  @Get('annual-breakdown')
  annualBreakdown(
    @CurrentUser() user: CurrentUserType,
    @Query() query: AnnualBreakdownQueryDto,
  ) {
    return this.capitalService.getAnnualBreakdown(user.tenantId, query.year);
  }

  // ─── Investors ───────────────────────────────────────────────────────────────

  @Get('investors')
  listInvestors(@CurrentUser() user: CurrentUserType) {
    return this.capitalService.listInvestors(user.tenantId);
  }

  @Post('investors')
  createInvestor(@CurrentUser() user: CurrentUserType, @Body() dto: CreateInvestorDto) {
    return this.capitalService.createInvestor(user.tenantId, dto);
  }

  @Patch('investors/:id')
  updateInvestor(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateInvestorDto,
  ) {
    return this.capitalService.updateInvestor(id, user.tenantId, dto);
  }

  // ─── Contributions ───────────────────────────────────────────────────────────

  @Get('contributions')
  listContributions(
    @CurrentUser() user: CurrentUserType,
    @Query('investorId') investorId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.capitalService.listContributions(user.tenantId, investorId, startDate, endDate);
  }

  @Post('contributions')
  createContribution(@CurrentUser() user: CurrentUserType, @Body() dto: CreateContributionDto) {
    return this.capitalService.createContribution(user.tenantId, dto);
  }

  @Patch('contributions/:id')
  updateContribution(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateContributionDto,
  ) {
    return this.capitalService.updateContribution(id, user.tenantId, dto);
  }

  @Delete('contributions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeContribution(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.capitalService.removeContribution(id, user.tenantId);
  }

  // ─── Distributions ───────────────────────────────────────────────────────────

  @Get('distributions')
  listDistributions(
    @CurrentUser() user: CurrentUserType,
    @Query('investorId') investorId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.capitalService.listDistributions(user.tenantId, investorId, startDate, endDate);
  }

  @Post('distributions')
  createDistribution(@CurrentUser() user: CurrentUserType, @Body() dto: CreateDistributionDto) {
    return this.capitalService.createDistribution(user.tenantId, dto);
  }

  @Patch('distributions/:id')
  updateDistribution(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateDistributionDto,
  ) {
    return this.capitalService.updateDistribution(id, user.tenantId, dto);
  }

  @Delete('distributions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeDistribution(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.capitalService.removeDistribution(id, user.tenantId);
  }
}
