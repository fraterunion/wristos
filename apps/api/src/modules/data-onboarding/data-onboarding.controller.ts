import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { DataOnboardingService } from './data-onboarding.service';
import { CommitImportDto, CreateDataImportSessionDto, ListDataImportRecordsQueryDto, SaveMappingDto } from './dto/data-onboarding.dto';
import { WatchImportService } from './inventory-import/watch-import.service';
import type { MappingEntry } from './inventory-import/watch-import.types';
import type { MulterFile } from './types/multer-file.type';
import { maxImportFileSizeBytes } from './utils/file-validation.util';

@Controller('data-onboarding')
@UseGuards(JwtAuthGuard)
export class DataOnboardingController {
  constructor(
    private readonly dataOnboardingService: DataOnboardingService,
    private readonly watchImportService: WatchImportService,
  ) {}

  @Post('sessions')
  createSession(@CurrentUser() user: CurrentUserType, @Body() dto: CreateDataImportSessionDto) {
    return this.dataOnboardingService.createSession(user.tenantId, user.userId, dto);
  }

  @Get('sessions')
  listSessions(@CurrentUser() user: CurrentUserType) {
    return this.dataOnboardingService.listSessions(user.tenantId);
  }

  @Get('sessions/:sessionId')
  getSession(@CurrentUser() user: CurrentUserType, @Param('sessionId') sessionId: string) {
    return this.dataOnboardingService.getSession(user.tenantId, sessionId);
  }

  @Get('sessions/:sessionId/files')
  listFiles(@CurrentUser() user: CurrentUserType, @Param('sessionId') sessionId: string) {
    return this.dataOnboardingService.listFiles(user.tenantId, sessionId);
  }

  @Post('sessions/:sessionId/files')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: maxImportFileSizeBytes() },
    }),
  )
  uploadFile(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @UploadedFile() file: MulterFile,
  ) {
    return this.dataOnboardingService.uploadFile(user.tenantId, sessionId, file);
  }

  @Get('sessions/:sessionId/records')
  listRecords(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @Query() query: ListDataImportRecordsQueryDto,
  ) {
    return this.dataOnboardingService.listRecords(user.tenantId, sessionId, query);
  }

  @Post('sessions/:sessionId/process')
  processSession(@CurrentUser() user: CurrentUserType, @Param('sessionId') sessionId: string) {
    return this.dataOnboardingService.processSession(user.tenantId, sessionId);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSession(@CurrentUser() user: CurrentUserType, @Param('sessionId') sessionId: string) {
    return this.dataOnboardingService.deleteSession(user.tenantId, sessionId);
  }

  // ─── Inventory Import V1 ─────────────────────────────────────────────────

  @Get('sessions/:sessionId/files/:fileId/mapping')
  getMapping(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.watchImportService.getMapping(user.tenantId, sessionId, fileId);
  }

  @Put('sessions/:sessionId/files/:fileId/mapping')
  saveMapping(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @Param('fileId') fileId: string,
    @Body() dto: SaveMappingDto,
  ) {
    // targetField is validated by @IsIn against WATCH_IMPORT_FIELDS + SKIP_FIELD.
    return this.watchImportService.saveMapping(user.tenantId, sessionId, fileId, dto.mapping as MappingEntry[]);
  }

  @Post('sessions/:sessionId/dry-run')
  runDryRun(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
  ) {
    return this.watchImportService.runDryRun(user.tenantId, sessionId);
  }

  @Post('sessions/:sessionId/commit')
  commitImport(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @Body() dto: CommitImportDto,
  ) {
    return this.watchImportService.commitImport(user.tenantId, sessionId, dto.duplicatePolicy);
  }

  @Get('sessions/:sessionId/error-report.csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="error-report.csv"')
  getErrorReport(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
  ) {
    return this.watchImportService.getErrorReport(user.tenantId, sessionId);
  }
}
