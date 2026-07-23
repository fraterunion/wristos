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
import { DataImportTarget } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
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
  SaveSalesMappingDto,
  UpdateExtractionDto,
} from './dto/data-onboarding.dto';
import type { InventoryInvoiceExtraction } from './inventory-import/inventory-invoice-extraction.types';
import { InventoryInvoiceExtractionSchema } from './inventory-import/inventory-invoice-extraction.types';
import { WatchImportService } from './inventory-import/watch-import.service';
import type { MappingEntry } from './inventory-import/watch-import.types';
import { PdfInvoiceImportService } from './pdf-invoice-import.service';
import { PdfSalesImportService } from './pdf-sales-import.service';
import type { HistoricalSalesExtractionDocument } from './sales-import/historical-sale-extraction.types';
import { HistoricalSalesExtractionSchema } from './sales-import/historical-sale-extraction.types';
import type { SalesMappingEntry } from './sales-import/historical-sale.types';
import { SalesImportService } from './sales-import/sales-import.service';
import type { ImportFileStorage } from './storage/import-file-storage.interface';
import type { MulterFile } from './types/multer-file.type';
import { maxImportFileSizeBytes } from './utils/file-validation.util';

@Controller('data-onboarding')
@UseGuards(JwtAuthGuard)
export class DataOnboardingController {
  constructor(
    private readonly dataOnboardingService: DataOnboardingService,
    private readonly watchImportService: WatchImportService,
    private readonly salesImportService: SalesImportService,
    private readonly pdfInvoiceImportService: PdfInvoiceImportService,
    private readonly pdfSalesImportService: PdfSalesImportService,
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

  // ─── Inventory / Sales Import ────────────────────────────────────────────

  @Get('sessions/:sessionId/files/:fileId/mapping')
  async getMapping(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @Param('fileId') fileId: string,
  ) {
    const session = await this.dataOnboardingService.getSession(user.tenantId, sessionId);
    if (session.importTarget === DataImportTarget.SALES) {
      return this.salesImportService.getSalesMapping(user.tenantId, sessionId, fileId);
    }
    return this.watchImportService.getMapping(user.tenantId, sessionId, fileId);
  }

  @Put('sessions/:sessionId/files/:fileId/mapping')
  async saveMapping(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @Param('fileId') fileId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const session = await this.dataOnboardingService.getSession(user.tenantId, sessionId);
    if (session.importTarget === DataImportTarget.SALES) {
      const dto = plainToInstance(SaveSalesMappingDto, body);
      const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
      if (errors.length > 0) {
        throw new BadRequestException('Mapeo de ventas inválido.');
      }
      return this.salesImportService.saveSalesMapping(
        user.tenantId,
        sessionId,
        fileId,
        dto.mapping as SalesMappingEntry[],
      );
    }

    const dto = plainToInstance(SaveMappingDto, body);
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      throw new BadRequestException('Mapeo de inventario inválido.');
    }
    return this.watchImportService.saveMapping(
      user.tenantId,
      sessionId,
      fileId,
      dto.mapping as MappingEntry[],
    );
  }

  @Post('sessions/:sessionId/dry-run')
  async runDryRun(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
  ) {
    const session = await this.dataOnboardingService.getSession(user.tenantId, sessionId);
    if (session.importTarget === DataImportTarget.SALES) {
      return this.salesImportService.runSalesDryRun(user.tenantId, sessionId);
    }
    return this.watchImportService.runDryRun(user.tenantId, sessionId);
  }

  @Post('sessions/:sessionId/commit')
  async commitImport(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @Body() dto: CommitImportDto,
  ) {
    const session = await this.dataOnboardingService.getSession(user.tenantId, sessionId);
    if (session.importTarget === DataImportTarget.SALES) {
      return this.salesImportService.commitSalesImport(user.tenantId, sessionId);
    }
    if (!dto.duplicatePolicy) {
      throw new BadRequestException('duplicatePolicy es requerido para importación de inventario.');
    }
    return this.watchImportService.commitImport(user.tenantId, sessionId, dto.duplicatePolicy);
  }

  @Get('sessions/:sessionId/error-report.csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="error-report.csv"')
  async getErrorReport(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
  ) {
    const session = await this.dataOnboardingService.getSession(user.tenantId, sessionId);
    if (session.importTarget === DataImportTarget.SALES) {
      return this.salesImportService.getErrorReport(user.tenantId, sessionId);
    }
    return this.watchImportService.getErrorReport(user.tenantId, sessionId);
  }

  // ─── PDF Document Import (inventory invoice / historical sales) ──────────

  @Post('sessions/:sessionId/process-document')
  async processDocument(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
  ) {
    const session = await this.dataOnboardingService.getSession(user.tenantId, sessionId);
    if (session.importTarget === DataImportTarget.SALES) {
      return this.pdfSalesImportService.processDocument(user.tenantId, sessionId);
    }
    return this.pdfInvoiceImportService.processDocument(user.tenantId, sessionId);
  }

  @Get('sessions/:sessionId/document-extraction')
  async getDocumentExtraction(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
  ) {
    const session = await this.dataOnboardingService.getSession(user.tenantId, sessionId);
    if (session.importTarget === DataImportTarget.SALES) {
      return this.pdfSalesImportService.getExtraction(user.tenantId, sessionId);
    }
    return this.pdfInvoiceImportService.getExtraction(user.tenantId, sessionId);
  }

  @Patch('sessions/:sessionId/document-extraction')
  async updateDocumentExtraction(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateExtractionDto,
  ) {
    const session = await this.dataOnboardingService.getSession(user.tenantId, sessionId);
    if (session.importTarget === DataImportTarget.SALES) {
      const validated = HistoricalSalesExtractionSchema.safeParse(dto.extraction);
      if (!validated.success) {
        throw new BadRequestException('Datos de extracción de ventas inválidos. Verifique los campos y vuelva a intentarlo.');
      }
      return this.pdfSalesImportService.updateExtraction(
        user.tenantId,
        sessionId,
        validated.data as HistoricalSalesExtractionDocument,
      );
    }

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
  async reprocessDocument(
    @CurrentUser() user: CurrentUserType,
    @Param('sessionId') sessionId: string,
    @Body() dto: ReprocessDocumentDto,
  ) {
    const session = await this.dataOnboardingService.getSession(user.tenantId, sessionId);
    if (session.importTarget === DataImportTarget.SALES) {
      return this.pdfSalesImportService.reprocessDocument(user.tenantId, sessionId, {
        confirmDiscardEdits: dto.confirmDiscardEdits,
      });
    }
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
