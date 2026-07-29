import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../../../../common/types/current-user.type';
import { JwtAuthGuard } from '../../../core/auth/guards/jwt-auth.guard';
import type { MulterFile } from '../../../data-onboarding/types/multer-file.type';
import { PlatformAdminGuard } from '../../guards/platform-admin.guard';
import { maxFileBytes } from '../constants';
import { WristCaviarMigrationService } from '../services/wrist-caviar-migration.service';

@Controller('platform/migrations/wrist-caviar')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class WristCaviarMigrationController {
  constructor(private readonly service: WristCaviarMigrationService) {}

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
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.getIssues(tenantId || user.tenantId, analysisId, {
      severity,
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
}
