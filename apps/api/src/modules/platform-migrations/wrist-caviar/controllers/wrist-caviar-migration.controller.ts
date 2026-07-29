import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  WristCaviarMigrationEntityGroup,
} from '@prisma/client';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../../../../common/types/current-user.type';
import { JwtAuthGuard } from '../../../core/auth/guards/jwt-auth.guard';
import type { MulterFile } from '../../../data-onboarding/types/multer-file.type';
import { PlatformAdminGuard } from '../../guards/platform-admin.guard';
import { maxFileBytes } from '../constants';
import type { ResolutionType } from '../review/issue-taxonomy';
import { WristCaviarMigrationService } from '../services/wrist-caviar-migration.service';
import { WristCaviarReviewService } from '../services/wrist-caviar-review.service';

class CreateResolutionDto {
  @IsInt()
  @Min(0)
  expectedReviewVersion!: number;

  @IsOptional()
  @IsString()
  issueId?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  candidateId?: string;

  @IsString()
  resolutionType!: ResolutionType;

  @IsOptional()
  @IsObject()
  originalValue?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  resolvedValue?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

class EntityApprovalDto {
  @IsInt()
  @Min(0)
  expectedReviewVersion!: number;

  @IsEnum(['APPROVED', 'DEFERRED', 'IN_REVIEW', 'BLOCKED'])
  status!: 'APPROVED' | 'DEFERRED' | 'IN_REVIEW' | 'BLOCKED';

  @IsOptional()
  @IsString()
  reason?: string;
}

class FreezeDto {
  @IsInt()
  @Min(0)
  expectedReviewVersion!: number;
}

@Controller('platform/migrations/wrist-caviar')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class WristCaviarMigrationController {
  constructor(
    private readonly service: WristCaviarMigrationService,
    private readonly review: WristCaviarReviewService,
  ) {}

  @Post('analyze')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: maxFileBytes() },
    }),
  )
  analyze(
    @CurrentUser() user: CurrentUserType,
    @UploadedFile() file: MulterFile,
    @Query('tenantId') tenantId?: string,
  ) {
    const targetTenantId = tenantId || user.tenantId;
    if (!targetTenantId) {
      throw new BadRequestException('tenantId query param is required as explicit tenant target');
    }
    if (!file) {
      throw new BadRequestException('multipart file field "file" is required');
    }
    return this.service.analyze({
      actingTenantId: user.tenantId,
      targetTenantId,
      userId: user.userId,
      file,
    });
  }

  @Get(':analysisId')
  getAnalysis(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.getAnalysis(tenantId || user.tenantId, analysisId);
  }

  @Get(':analysisId/sheets')
  getSheets(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.getSheets(tenantId || user.tenantId, analysisId);
  }

  @Get(':analysisId/sheets/:sheet')
  getSheet(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Param('sheet') sheet: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.getSheet(tenantId || user.tenantId, analysisId, sheet);
  }

  @Get(':analysisId/issues')
  getIssues(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Query('tenantId') tenantId?: string,
    @Query('severity') severity?: string,
    @Query('code') code?: string,
    @Query('sheet') sheet?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.review.listIssues(tenantId || user.tenantId, analysisId, {
      severity,
      code,
      sheet,
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':analysisId/reconciliation')
  getReconciliation(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.getReconciliation(tenantId || user.tenantId, analysisId);
  }

  @Get(':analysisId/preview/:entity')
  getPreview(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Param('entity') entity: string,
    @Query('tenantId') tenantId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.getPreview(tenantId || user.tenantId, analysisId, entity, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':analysisId/review-summary')
  reviewSummary(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.review.getReviewSummary(tenantId || user.tenantId, analysisId);
  }

  @Get(':analysisId/review/cxc')
  reviewCxc(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Query('tenantId') tenantId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.review.getCxcReview(
      tenantId || user.tenantId,
      analysisId,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 25,
    );
  }

  @Get(':analysisId/review/cxp')
  reviewCxp(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Query('tenantId') tenantId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.review.getCxpReview(
      tenantId || user.tenantId,
      analysisId,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 25,
    );
  }

  @Get(':analysisId/review/customers')
  reviewCustomers(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Query('tenantId') tenantId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.review.getCustomerReview(
      tenantId || user.tenantId,
      analysisId,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 50,
    );
  }

  @Get(':analysisId/review/serials')
  reviewSerials(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.review.getSerialReview(tenantId || user.tenantId, analysisId);
  }

  @Get(':analysisId/review/financial')
  reviewFinancial(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.review.getFinancialReview(tenantId || user.tenantId, analysisId);
  }

  @Post(':analysisId/resolutions')
  createResolution(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: CreateResolutionDto,
  ) {
    return this.review.createResolution({
      tenantId: tenantId || user.tenantId,
      analysisId,
      userId: user.userId,
      expectedReviewVersion: body.expectedReviewVersion,
      issueId: body.issueId,
      entityType: body.entityType,
      candidateId: body.candidateId,
      resolutionType: body.resolutionType,
      originalValue: body.originalValue,
      resolvedValue: body.resolvedValue,
      reason: body.reason,
      notes: body.notes,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Put(':analysisId/resolutions/:resolutionId')
  supersedeResolution(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Param('resolutionId') resolutionId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: CreateResolutionDto,
  ) {
    // Append-only: create a new active resolution (prior auto-superseded by issueId)
    return this.review.createResolution({
      tenantId: tenantId || user.tenantId,
      analysisId,
      userId: user.userId,
      expectedReviewVersion: body.expectedReviewVersion,
      issueId: body.issueId,
      entityType: body.entityType,
      candidateId: body.candidateId,
      resolutionType: body.resolutionType,
      originalValue: body.originalValue,
      resolvedValue: { ...(body.resolvedValue ?? {}), supersedes: resolutionId },
      reason: body.reason,
      notes: body.notes,
      idempotencyKey: body.idempotencyKey ?? `supersede:${resolutionId}:${body.expectedReviewVersion}`,
    });
  }

  @Post(':analysisId/entity-approvals/:entity')
  approveEntity(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Param('entity') entity: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: EntityApprovalDto,
  ) {
    const entityGroup = entity.toUpperCase().replace(/-/g, '_') as WristCaviarMigrationEntityGroup;
    if (!Object.values(WristCaviarMigrationEntityGroup).includes(entityGroup)) {
      throw new BadRequestException(`Unknown entity group: ${entity}`);
    }
    return this.review.upsertEntityApproval({
      tenantId: tenantId || user.tenantId,
      analysisId,
      userId: user.userId,
      entityGroup,
      status: body.status,
      reason: body.reason,
      expectedReviewVersion: body.expectedReviewVersion,
    });
  }

  @Post(':analysisId/freeze')
  freeze(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: FreezeDto,
  ) {
    return this.review.freezeDataset({
      tenantId: tenantId || user.tenantId,
      analysisId,
      userId: user.userId,
      expectedReviewVersion: body.expectedReviewVersion,
    });
  }

  @Get(':analysisId/datasets')
  listDatasets(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.review.listDatasets(tenantId || user.tenantId, analysisId);
  }

  @Get(':analysisId/datasets/:datasetId')
  getDataset(
    @CurrentUser() user: CurrentUserType,
    @Param('analysisId') analysisId: string,
    @Param('datasetId') datasetId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.review.getDataset(tenantId || user.tenantId, analysisId, datasetId);
  }
}

// silence unused validators imported for future ValidationPipe wiring
void Type;
void ValidateNested;
