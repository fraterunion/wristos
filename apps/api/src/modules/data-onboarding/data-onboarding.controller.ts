import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { DataOnboardingService } from './data-onboarding.service';
import { IMPORT_FILE_STORAGE } from './tokens';
import {
  CommitImportDto,
  CreateDataImportSessionDto,
  ListDataImportRecordsQueryDto,
  ReprocessDocumentDto,
  SaveMappingDto,
  UpdateExtractionDto,
} from './dto/data-onboarding.dto';
import type { InventoryInvoiceExtraction } from './inventory-import/inventory-invoice-extraction.types';
import { InventoryInvoiceExtractionSchema } from './inventory-import/inventory-invoice-extraction.types';
import { WatchImportService } from './inventory-import/watch-import.service';
import type { MappingEntry } from './inventory-import/watch-import.types';
import { PdfInvoiceImportService } from './pdf-invoice-import.service';
import type { ImportFileStorage } from './storage/import-file-storage.interface';
import type { MulterFile } from './types/multer-file.type';
import { maxImportFileSizeBytes } from './utils/file-validation.util';

@Controller('data-onboarding')
@UseGuards(JwtAuthGuard)
export class DataOnboardingController {
  constructor(
    private readonly dataOnboardingService: DataOnboardingService,
    private readonly watchImportService: WatchImportService,
    private readonly pdfInvoiceImportService: PdfInvoiceImportService,
    @Inject(IMPORT_FILE_STORAGE) private readonly storage: ImportFileStorage,
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

  // ─── PDF Invoice Import ───────────────────────────────────────────────────

  @Post('sessions/:sessionId/process-document')
  processDocument(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
  ) {
    return this.pdfInvoiceImportService.processDocument(user.tenantId, sessionId);
  }

  @Get('sessions/:sessionId/document-extraction')
  getDocumentExtraction(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
  ) {
    return this.pdfInvoiceImportService.getExtraction(user.tenantId, sessionId);
  }

  @Patch('sessions/:sessionId/document-extraction')
  updateDocumentExtraction(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateExtractionDto,
  ) {
    const validated = InventoryInvoiceExtractionSchema.safeParse(dto.extraction);
    if (!validated.success) {
      throw new BadRequestException('Datos de extracción inválidos. Verifique los campos y vuelva a intentarlo.');
    }
    return this.pdfInvoiceImportService.updateExtraction(
      user.tenantId,
      sessionId,
      validated.data as InventoryInvoiceExtraction,
    );
  }

  @Post('sessions/:sessionId/reprocess-document')
  reprocessDocument(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @Body() dto: ReprocessDocumentDto,
  ) {
    return this.pdfInvoiceImportService.reprocessDocument(user.tenantId, sessionId, {
      confirmDiscardEdits: dto.confirmDiscardEdits,
    });
  }

  /**
   * Streams the stored import file to the browser with authenticated access only.
   * The bearer token is provided in the Authorization header — never in the URL (M-05).
   */
  @Get('sessions/:sessionId/files/:fileId/content')
  async getFileContent(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    const file = await this.dataOnboardingService.getFileRecord(user.tenantId, sessionId, fileId);
    const safeName = encodeURIComponent(file.originalFilename);
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${safeName}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    this.storage.readStream(file.storageKey).pipe(res);
  }
}
