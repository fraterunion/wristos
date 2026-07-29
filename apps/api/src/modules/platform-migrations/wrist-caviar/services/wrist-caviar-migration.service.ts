import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  WristCaviarMigrationAnalysisStatus,
  WristCaviarMigrationReadiness,
} from '@prisma/client';

import { PrismaService } from '../../../../prisma/prisma.service';
import type { MulterFile } from '../../../data-onboarding/types/multer-file.type';
import { maxFileBytes } from '../constants';
import {
  analyzeWristCaviarWorkbook,
  toAnalysisSummary,
} from './analyze-workbook';
import type { WorkbookAnalysis } from '../types/migration.types';

const PREVIEW_ENTITIES = [
  'customers',
  'inventory',
  'sales',
  'receivables',
  'payables',
  'expenses',
  'cash',
  'bank',
  'partner-ledger',
  'profit-distributions',
  'deferred',
] as const;

export type PreviewEntity = (typeof PREVIEW_ENTITIES)[number];

@Injectable()
export class WristCaviarMigrationService {
  private readonly logger = new Logger(WristCaviarMigrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async analyze(params: {
    actingTenantId: string;
    targetTenantId: string;
    userId: string;
    file: MulterFile;
  }) {
    if (!params.targetTenantId) {
      throw new ForbiddenException('Explicit tenant target is required');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: params.targetTenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Target tenant not found');

    if (!params.file?.buffer?.length) {
      throw new ForbiddenException('Workbook file required');
    }
    if (params.file.size > maxFileBytes()) {
      throw new ForbiddenException('File too large');
    }

    // Never log workbook bytes or row-level financials
    this.logger.log(
      JSON.stringify({
        event: 'WRIST_CAVIAR_MIGRATION_ANALYZE_START',
        targetTenantId: params.targetTenantId,
        actorUserId: params.userId,
        fileName: params.file.originalname?.replace(/[^\w.\- ]/g, '_') ?? 'workbook.xlsx',
        fileSizeBytes: params.file.size,
      }),
    );

    const analysis = await analyzeWristCaviarWorkbook(
      params.file.buffer,
      params.file.originalname || 'workbook.xlsx',
    );

    const privateSnapshot = this.buildPrivateSnapshot(analysis);
    const summary = toAnalysisSummary(analysis);

    const created = await this.prisma.wristCaviarMigrationAnalysis.create({
      data: {
        tenantId: params.targetTenantId,
        createdByUserId: params.userId,
        status: WristCaviarMigrationAnalysisStatus.COMPLETED,
        readiness: analysis.readiness as WristCaviarMigrationReadiness,
        parserVersion: analysis.parserVersion,
        fingerprint: analysis.fingerprint,
        fingerprintPrefix: analysis.fingerprintPrefix,
        fileName: analysis.fileName,
        fileSizeBytes: analysis.fileSizeBytes,
        durationMs: analysis.durationMs,
        sheetSummaries: analysis.sheets as object[],
        normalizedCounts: analysis.counts as object,
        issueSummary: analysis.issueSummary as object,
        reconciliationSummary: summary.reconciliationSummary as object,
        privateSnapshot: privateSnapshot as object,
        sheets: {
          create: analysis.sheets.map((s) => ({
            tenantId: params.targetTenantId,
            sheetName: s.sheetName,
            classification: s.classification,
            status: s.status,
            detectedRecords: s.detectedRecords,
            warningCount: s.warningCount,
            errorCount: s.errorCount,
            manualReviewCount: s.manualReviewCount,
            notes: s.notes,
          })),
        },
        issues: {
          create: analysis.issues.slice(0, 2000).map((issue) => ({
            tenantId: params.targetTenantId,
            code: issue.code,
            severity: issue.severity,
            category: issue.category ?? null,
            message: issue.message,
            sourceSheet: issue.source?.sourceSheet ?? null,
            sourceRow: issue.source?.sourceRow ?? null,
            sourceBlockId: issue.source?.sourceBlockId ?? null,
          })),
        },
      },
    });

    this.logger.log(
      JSON.stringify({
        event: 'WRIST_CAVIAR_MIGRATION_ANALYZE_COMPLETE',
        analysisId: created.id,
        targetTenantId: params.targetTenantId,
        actorUserId: params.userId,
        fingerprintPrefix: analysis.fingerprintPrefix,
        parserVersion: analysis.parserVersion,
        readiness: analysis.readiness,
        counts: analysis.counts,
        issueSummary: analysis.issueSummary,
        durationMs: analysis.durationMs,
        operationalWrites: 0,
      }),
    );

    return {
      ...summary,
      analysisId: created.id,
    };
  }

  async getAnalysis(tenantId: string, analysisId: string) {
    const row = await this.requireAnalysis(tenantId, analysisId);
    return {
      analysisId: row.id,
      parserVersion: row.parserVersion,
      fingerprintPrefix: row.fingerprintPrefix,
      readiness: row.readiness,
      fileName: row.fileName,
      fileSizeBytes: row.fileSizeBytes,
      durationMs: row.durationMs,
      status: row.status,
      sheets: row.sheetSummaries,
      counts: row.normalizedCounts,
      issueSummary: row.issueSummary,
      reconciliationSummary: row.reconciliationSummary,
      operationalWrites: 0,
      createdAt: row.createdAt,
    };
  }

  async getSheets(tenantId: string, analysisId: string) {
    await this.requireAnalysis(tenantId, analysisId);
    return this.prisma.wristCaviarMigrationSheet.findMany({
      where: { tenantId, analysisId },
      orderBy: { sheetName: 'asc' },
    });
  }

  async getSheet(tenantId: string, analysisId: string, sheet: string) {
    await this.requireAnalysis(tenantId, analysisId);
    const row = await this.prisma.wristCaviarMigrationSheet.findFirst({
      where: { tenantId, analysisId, sheetName: sheet },
    });
    if (!row) throw new NotFoundException('Sheet summary not found');
    return row;
  }

  async getIssues(
    tenantId: string,
    analysisId: string,
    query: { severity?: string; page?: number; pageSize?: number },
  ) {
    await this.requireAnalysis(tenantId, analysisId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 50));
    const where = {
      tenantId,
      analysisId,
      ...(query.severity ? { severity: query.severity } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.wristCaviarMigrationIssue.count({ where }),
      this.prisma.wristCaviarMigrationIssue.findMany({
        where,
        orderBy: [{ severity: 'asc' }, { code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { page, pageSize, total, items };
  }

  async getReconciliation(tenantId: string, analysisId: string) {
    const row = await this.requireAnalysis(tenantId, analysisId);
    const snap = row.privateSnapshot as { reconciliation?: unknown } | null;
    return {
      summary: row.reconciliationSummary,
      items: snap?.reconciliation ?? [],
    };
  }

  async getPreview(
    tenantId: string,
    analysisId: string,
    entity: string,
    query: { page?: number; pageSize?: number },
  ) {
    if (!(PREVIEW_ENTITIES as readonly string[]).includes(entity)) {
      throw new NotFoundException('Unknown preview entity');
    }
    const row = await this.requireAnalysis(tenantId, analysisId);
    const snap = (row.privateSnapshot ?? {}) as Record<string, unknown[]>;
    const key = this.previewKey(entity as PreviewEntity);
    const all = Array.isArray(snap[key]) ? snap[key] : [];
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const start = (page - 1) * pageSize;
    return {
      entity,
      page,
      pageSize,
      total: all.length,
      items: all.slice(start, start + pageSize),
    };
  }

  private previewKey(entity: PreviewEntity): string {
    switch (entity) {
      case 'partner-ledger':
        return 'partnerLedger';
      case 'profit-distributions':
        return 'profitDistributions';
      case 'deferred':
        return 'deferred';
      default:
        return entity;
    }
  }

  private buildPrivateSnapshot(analysis: WorkbookAnalysis) {
    return {
      reconciliation: analysis.reconciliation,
      customers: analysis.customers,
      inventory: analysis.inventory,
      sales: analysis.sales,
      receivables: analysis.receivables,
      payables: analysis.payables,
      expenses: analysis.expenses,
      cash: analysis.cash,
      bank: analysis.bank,
      partnerLedger: analysis.partnerLedger,
      profitDistributions: analysis.profitDistributions,
      deferred: [
        ...analysis.crypto.map((c) => ({ kind: 'CRYPTO', ...c })),
        ...analysis.externalFloat.map((e) => ({ kind: 'EXTERNAL_FLOAT', ...e })),
      ],
    };
  }

  private async requireAnalysis(tenantId: string, analysisId: string) {
    const row = await this.prisma.wristCaviarMigrationAnalysis.findFirst({
      where: { id: analysisId, tenantId },
    });
    if (!row) throw new NotFoundException('Analysis not found');
    return row;
  }
}
