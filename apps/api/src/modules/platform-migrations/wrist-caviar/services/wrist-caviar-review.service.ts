import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  WristCaviarMigrationEntityApprovalStatus,
  WristCaviarMigrationEntityGroup,
  WristCaviarMigrationReadiness,
  WristCaviarMigrationResolutionStatus,
  WristCaviarMigrationResolutionType,
} from '@prisma/client';

import { PrismaService } from '../../../../prisma/prisma.service';
import {
  assertResolutionAllowed,
  ISSUE_TAXONOMY,
  mapLegacyIssueCode,
  reviewStatusForResolution,
  type ResolutionType,
  type TaxonomyCode,
} from '../review/issue-taxonomy';
import {
  applyResolutionOverlays,
  DATASET_VERSION_PREFIX,
  fingerprintReviewedDataset,
  type PrivateSnapshot,
} from '../review/overlay-engine';

const REQUIRED_APPROVAL_GROUPS: WristCaviarMigrationEntityGroup[] = [
  'CUSTOMERS',
  'INVENTORY',
  'SALES',
  'RECEIVABLES',
  'PAYABLES',
  'EXPENSES',
  'CASH_LEDGER',
  'BANK_LEDGER',
  'PARTNER_LEDGER',
  'PROFIT_DISTRIBUTIONS',
  'DEFERRED',
];

@Injectable()
export class WristCaviarReviewService {
  private readonly logger = new Logger(WristCaviarReviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getReviewSummary(tenantId: string, analysisId: string) {
    const analysis = await this.requireAnalysis(tenantId, analysisId);
    await this.ensureApprovals(tenantId, analysisId);
    await this.ensureTaxonomyCodes(tenantId, analysisId);
    const [issues, approvals, resolutions, datasets] = await Promise.all([
      this.prisma.wristCaviarMigrationIssue.findMany({ where: { tenantId, analysisId } }),
      this.prisma.wristCaviarMigrationEntityApproval.findMany({ where: { tenantId, analysisId } }),
      this.prisma.wristCaviarMigrationResolution.findMany({
        where: { tenantId, analysisId, status: 'ACTIVE' },
      }),
      this.prisma.wristCaviarMigrationReviewedDataset.findMany({
        where: { tenantId, analysisId },
        orderBy: { frozenAt: 'desc' },
        select: {
          id: true,
          datasetVersion: true,
          fingerprintPrefix: true,
          readiness: true,
          frozenAt: true,
          supersededByDatasetId: true,
        },
      }),
    ]);

    const unresolvedCritical = issues.filter(
      (i) => i.severity === 'CRITICAL' && i.reviewStatus === 'UNRESOLVED',
    ).length;
    const unresolvedBlocking = issues.filter((i) => {
      const tax = (i.taxonomyCode ?? mapLegacyIssueCode(i.code, i.sourceSheet)) as TaxonomyCode;
      return ISSUE_TAXONOMY[tax]?.blocksDryRun && i.reviewStatus === 'UNRESOLVED';
    }).length;
    const unresolvedManual = issues.filter(
      (i) => i.severity === 'MANUAL_REVIEW' && i.reviewStatus === 'UNRESOLVED',
    ).length;
    const acknowledgedWarnings = issues.filter(
      (i) => i.reviewStatus === 'ACKNOWLEDGED' || i.reviewStatus === 'RESOLVED',
    ).length;

    const readiness = this.computeReadiness({
      issues,
      approvals,
      hasFrozenDataset: datasets.some((d) => !d.supersededByDatasetId),
    });

    return {
      analysisId,
      reviewVersion: analysis.reviewVersion,
      readiness,
      originalReadiness: analysis.readiness,
      unresolvedCritical,
      unresolvedBlocking,
      unresolvedManual,
      acknowledgedWarnings,
      activeResolutionCount: resolutions.length,
      approvedEntityGroups: approvals.filter((a) => a.status === 'APPROVED').length,
      deferredEntityGroups: approvals.filter((a) => a.status === 'DEFERRED').length,
      approvals,
      latestDataset: datasets[0] ?? null,
      datasets,
      taxonomy: Object.values(ISSUE_TAXONOMY).map((t) => ({
        code: t.code,
        severity: t.severity,
        blocksDryRun: t.blocksDryRun,
        allowedResolutions: t.allowedResolutions,
        bulkAllowed: t.bulkAllowed,
        reasonRequired: t.reasonRequired,
      })),
      recommendations: {
        DEFERRED: ['CRIPTO CESAR', 'OSCAR PAPA CAMI'],
      },
      operationalWrites: 0,
    };
  }

  async listIssues(
    tenantId: string,
    analysisId: string,
    query: {
      severity?: string;
      code?: string;
      sheet?: string;
      status?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    await this.requireAnalysis(tenantId, analysisId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 50));
    const where = {
      tenantId,
      analysisId,
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.code
        ? { OR: [{ code: query.code }, { taxonomyCode: query.code }] }
        : {}),
      ...(query.sheet ? { sourceSheet: query.sheet } : {}),
      ...(query.status ? { reviewStatus: query.status } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.wristCaviarMigrationIssue.count({ where }),
      this.prisma.wristCaviarMigrationIssue.findMany({
        where,
        orderBy: [{ severity: 'asc' }, { taxonomyCode: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          resolutions: {
            where: { status: 'ACTIVE' },
            orderBy: { resolvedAt: 'desc' },
            take: 5,
          },
        },
      }),
    ]);
    return { page, pageSize, total, items };
  }

  async getCxcReview(tenantId: string, analysisId: string, page = 1, pageSize = 25) {
    const { snapshot, issues } = await this.loadReviewed(tenantId, analysisId);
    const cards = snapshot.receivables;
    const start = (Math.max(1, page) - 1) * pageSize;
    const items = cards.slice(start, start + pageSize).map((card) => ({
      ...this.sanitizeCard(card),
      sourceLabel: card.source.sourceBlockId
        ? `${card.source.sourceSheet} · bloque ${card.source.sourceBlockId}`
        : `${card.source.sourceSheet} · fila ${card.source.sourceRow}`,
      issues: issues.filter(
        (i) =>
          i.candidateId === card.id ||
          (i.sourceBlockId && i.sourceBlockId === card.source.sourceBlockId) ||
          (i.sourceSheet === 'CTAS X COBRAR' && i.sourceRow === card.source.sourceRow),
      ),
      labels: {
        excel: 'Dato del Excel',
        calculated: 'Calculado por WristOS',
        approved: 'Valor aprobado',
      },
    }));
    return { page, pageSize, total: cards.length, items };
  }

  async getCxpReview(tenantId: string, analysisId: string, page = 1, pageSize = 25) {
    const { snapshot, issues } = await this.loadReviewed(tenantId, analysisId);
    const cards = snapshot.payables;
    const start = (Math.max(1, page) - 1) * pageSize;
    const items = cards.slice(start, start + pageSize).map((card) => ({
      id: card.id,
      creditorLabelRaw: card.creditorLabelRaw,
      creditorName: card.creditorName,
      watchOrConcept: card.watchOrConcept,
      principal: card.principal,
      declaredRemaining: card.declaredRemaining,
      calculatedRemaining: card.calculatedRemaining,
      balanceMismatch: card.balanceMismatch,
      formulaErrors: card.formulaErrors,
      ambiguous: card.ambiguous,
      currency: card.currency,
      payments: card.payments.map((p) => ({
        id: p.id,
        label: p.label,
        amount: p.amount,
        paymentDate: p.paymentDate,
        note: p.note,
      })),
      sourceLabel: card.source.sourceBlockId
        ? `${card.source.sourceSheet} · bloque ${card.source.sourceBlockId}`
        : `${card.source.sourceSheet} · fila ${card.source.sourceRow}`,
      issues: issues.filter(
        (i) =>
          i.candidateId === card.id ||
          (i.sourceBlockId && i.sourceBlockId === card.source.sourceBlockId) ||
          (i.sourceSheet === 'CTAS X PAGAR' && i.sourceRow === card.source.sourceRow),
      ),
    }));
    return { page, pageSize, total: cards.length, items };
  }

  async getCustomerReview(tenantId: string, analysisId: string, page = 1, pageSize = 50) {
    const { snapshot } = await this.loadReviewed(tenantId, analysisId);
    const customers = snapshot.customers;
    const groups = {
      exact: customers.filter((c) => c.sources.length > 1),
      accent: customers.filter((c) =>
        c.duplicateSuggestions.some((d) => d.confidence === 'ACCENT_VARIANT'),
      ),
      abbreviation: customers.filter((c) =>
        c.duplicateSuggestions.some((d) => d.confidence === 'POSSIBLE_ABBREVIATION'),
      ),
      typo: customers.filter((c) =>
        c.duplicateSuggestions.some((d) => d.confidence === 'POSSIBLE_TYPO'),
      ),
    };
    const start = (Math.max(1, page) - 1) * pageSize;
    return {
      page,
      pageSize,
      total: customers.length,
      groupCounts: {
        exact: groups.exact.length,
        accent: groups.accent.length,
        abbreviation: groups.abbreviation.length,
        typo: groups.typo.length,
      },
      items: customers.slice(start, start + pageSize).map((c) => ({
        id: c.id,
        displayName: c.displayName,
        normalizedName: c.normalizedName,
        sourceCount: c.sources.length,
        provenance: c.sources.map(
          (s) => `${s.sourceSheet} · fila ${s.sourceRow}`,
        ),
        duplicateSuggestions: c.duplicateSuggestions,
      })),
    };
  }

  async getSerialReview(tenantId: string, analysisId: string) {
    const { snapshot, issues } = await this.loadReviewed(tenantId, analysisId);
    const serialIssues = issues.filter((i) => {
      const tax = (i.taxonomyCode ?? mapLegacyIssueCode(i.code, i.sourceSheet)) as TaxonomyCode;
      return [
        'DUPLICATE_INVENTORY_SERIAL',
        'DUPLICATE_SOLD_SERIAL',
        'SOLD_SERIAL_IN_CURRENT_INVENTORY',
        'SPARSE_OR_POLLUTED_SERIAL',
        'MISSING_SERIAL',
      ].includes(tax);
    });
    return {
      inventoryCount: snapshot.inventory.length,
      salesCount: snapshot.sales.length,
      issues: serialIssues.map((i) => ({
        id: i.id,
        taxonomyCode: i.taxonomyCode ?? mapLegacyIssueCode(i.code, i.sourceSheet),
        code: i.code,
        reviewStatus: i.reviewStatus,
        sourceSheet: i.sourceSheet,
        sourceRow: i.sourceRow,
        message: i.message,
        allowedResolutions:
          ISSUE_TAXONOMY[
            (i.taxonomyCode ?? mapLegacyIssueCode(i.code, i.sourceSheet)) as TaxonomyCode
          ]?.allowedResolutions ?? [],
      })),
    };
  }

  async getFinancialReview(tenantId: string, analysisId: string) {
    const { snapshot, issues, effects } = await this.loadReviewed(tenantId, analysisId);
    const financeCodes = new Set([
      'SALE_PROFIT_MISMATCH',
      'CXC_BALANCE_MISMATCH',
      'CXP_BALANCE_MISMATCH',
      'CASH_BALANCE_MISMATCH',
      'BANK_BALANCE_MISMATCH',
      'PARTNER_BALANCE_MISMATCH',
      'PROFIT_SPLIT_MISMATCH',
      'REPORT_RECONCILIATION_MISMATCH',
      'REPORT_SCOPE_REVIEW',
      'BANK_ONE_PERCENT_MISMATCH',
      'BANK_TOTAL_CELL_DRIFT',
      'CXP_FORMULA_ERROR',
    ]);
    return {
      reconciliation: snapshot.reconciliation.map((r) => ({
        concept: r.concept,
        currency: r.currency,
        status: r.status,
        // Mask exact amounts in list payloads for safer transport; detail endpoints can reveal to PLATFORM_ADMIN
        hasDeclared: r.declaredValue != null,
        hasCalculated: r.calculatedValue != null,
        hasDifference: r.difference != null && r.difference !== 0,
        notes: r.notes,
        labels: {
          excel: 'Dato del Excel',
          calculated: 'Calculado por WristOS',
          approved: 'Valor aprobado',
        },
      })),
      issues: issues
        .filter((i) =>
          financeCodes.has(
            (i.taxonomyCode ?? mapLegacyIssueCode(i.code, i.sourceSheet)) as string,
          ),
        )
        .map((i) => ({
          id: i.id,
          taxonomyCode: i.taxonomyCode ?? mapLegacyIssueCode(i.code, i.sourceSheet),
          reviewStatus: i.reviewStatus,
          severity: i.severity,
          message: i.message,
          sourceSheet: i.sourceSheet,
          sourceRow: i.sourceRow,
          allowedResolutions:
            ISSUE_TAXONOMY[
              (i.taxonomyCode ?? mapLegacyIssueCode(i.code, i.sourceSheet)) as TaxonomyCode
            ]?.allowedResolutions ?? [],
        })),
      overlayEffects: effects,
    };
  }

  async createResolution(params: {
    tenantId: string;
    analysisId: string;
    userId: string;
    expectedReviewVersion: number;
    issueId?: string;
    entityType?: string;
    candidateId?: string;
    resolutionType: ResolutionType;
    originalValue?: unknown;
    resolvedValue?: unknown;
    reason?: string;
    notes?: string;
    idempotencyKey?: string;
  }) {
    const analysis = await this.requireAnalysis(params.tenantId, params.analysisId);
    if (analysis.reviewVersion !== params.expectedReviewVersion) {
      throw new ConflictException({
        message: 'Review version conflict',
        currentVersion: analysis.reviewVersion,
      });
    }

    let taxonomyCode: TaxonomyCode = 'UNMAPPED_DESTINATION_FIELD';
    let issue = null as Awaited<
      ReturnType<typeof this.prisma.wristCaviarMigrationIssue.findFirst>
    >;
    if (params.issueId) {
      issue = await this.prisma.wristCaviarMigrationIssue.findFirst({
        where: {
          id: params.issueId,
          tenantId: params.tenantId,
          analysisId: params.analysisId,
        },
      });
      if (!issue) throw new NotFoundException('Issue not found');
      taxonomyCode = (issue.taxonomyCode ??
        mapLegacyIssueCode(issue.code, issue.sourceSheet)) as TaxonomyCode;
    } else if (params.entityType === 'reconciliation') {
      taxonomyCode = 'REPORT_RECONCILIATION_MISMATCH';
    } else if (params.entityType === 'customer') {
      taxonomyCode = 'CUSTOMER_POSSIBLE_DUPLICATE';
    } else if (params.entityType === 'receivable') {
      taxonomyCode = 'AMBIGUOUS_CXC_BLOCK';
    } else if (params.entityType === 'payable') {
      taxonomyCode = 'AMBIGUOUS_CXP_BLOCK';
    }

    try {
      assertResolutionAllowed(taxonomyCode, params.resolutionType, params.reason);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid resolution');
    }

    if (params.idempotencyKey) {
      const existing = await this.prisma.wristCaviarMigrationResolution.findFirst({
        where: {
          analysisId: params.analysisId,
          idempotencyKey: params.idempotencyKey,
          status: 'ACTIVE',
        },
      });
      if (existing) return existing;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (params.issueId) {
        await tx.wristCaviarMigrationResolution.updateMany({
          where: {
            analysisId: params.analysisId,
            issueId: params.issueId,
            status: 'ACTIVE',
          },
          data: { status: WristCaviarMigrationResolutionStatus.SUPERSEDED },
        });
      }

      const created = await tx.wristCaviarMigrationResolution.create({
        data: {
          tenantId: params.tenantId,
          analysisId: params.analysisId,
          issueId: params.issueId,
          entityType: params.entityType,
          candidateId: params.candidateId,
          resolutionType: params.resolutionType as WristCaviarMigrationResolutionType,
          status: WristCaviarMigrationResolutionStatus.ACTIVE,
          originalValue: (params.originalValue as object) ?? undefined,
          resolvedValue: (params.resolvedValue as object) ?? undefined,
          reason: params.reason,
          notes: params.notes,
          idempotencyKey: params.idempotencyKey,
          resolvedByUserId: params.userId,
        },
      });

      if (issue) {
        await tx.wristCaviarMigrationIssue.update({
          where: { id: issue.id },
          data: {
            reviewStatus: reviewStatusForResolution(params.resolutionType),
            candidateId: params.candidateId ?? issue.candidateId,
            entityType: params.entityType ?? issue.entityType,
            taxonomyCode,
          },
        });
      }

      // Invalidate approvals for affected groups
      const affected = this.affectedGroups(params.entityType, taxonomyCode);
      if (affected.length) {
        await tx.wristCaviarMigrationEntityApproval.updateMany({
          where: {
            analysisId: params.analysisId,
            entityGroup: { in: affected },
            status: { in: ['APPROVED', 'DEFERRED'] },
          },
          data: {
            status: WristCaviarMigrationEntityApprovalStatus.IN_REVIEW,
            invalidatedAt: new Date(),
            invalidationReason: `Superseded by resolution ${created.id}`,
          },
        });
      }

      const active = await tx.wristCaviarMigrationResolution.findMany({
        where: { analysisId: params.analysisId, status: 'ACTIVE' },
      });
      const original = analysis.privateSnapshot as unknown as PrivateSnapshot;
      const reviewed = applyResolutionOverlays(
        original,
        active.map((r) => ({
          id: r.id,
          issueId: r.issueId,
          entityType: r.entityType,
          candidateId: r.candidateId,
          resolutionType: r.resolutionType as ResolutionType,
          originalValue: r.originalValue,
          resolvedValue: r.resolvedValue,
          reason: r.reason,
        })),
      );

      const issues = await tx.wristCaviarMigrationIssue.findMany({
        where: { analysisId: params.analysisId },
      });
      const approvals = await tx.wristCaviarMigrationEntityApproval.findMany({
        where: { analysisId: params.analysisId },
      });
      const readiness = this.computeReadiness({
        issues,
        approvals,
        hasFrozenDataset: false,
      });

      await tx.wristCaviarMigrationAnalysis.update({
        where: { id: params.analysisId },
        data: {
          reviewVersion: { increment: 1 },
          reviewedSnapshot: reviewed.snapshot as object,
          readiness,
          reconciliationSummary: {
            matched: reviewed.reconciliation.filter((r) => r.status === 'MATCHED').length,
            withinTolerance: reviewed.reconciliation.filter((r) => r.status === 'WITHIN_TOLERANCE')
              .length,
            mismatch: reviewed.reconciliation.filter((r) => r.status === 'MISMATCH').length,
            scopeReview: reviewed.reconciliation.filter(
              (r) => r.status === 'SCOPE_REVIEW_REQUIRED',
            ).length,
            unavailable: reviewed.reconciliation.filter((r) => r.status === 'UNAVAILABLE').length,
            formulaError: reviewed.reconciliation.filter((r) => r.status === 'FORMULA_ERROR')
              .length,
          },
        },
      });

      return { created, readiness, effects: reviewed.effects };
    });

    this.logger.log(
      JSON.stringify({
        event: 'WRIST_CAVIAR_RESOLUTION_CREATED',
        analysisId: params.analysisId,
        tenantId: params.tenantId,
        actorUserId: params.userId,
        resolutionType: params.resolutionType,
        taxonomyCode,
        issueId: params.issueId ?? null,
        readiness: result.readiness,
        operationalWrites: 0,
      }),
    );

    return {
      resolution: result.created,
      readiness: result.readiness,
      effects: result.effects,
      operationalWrites: 0,
    };
  }

  async upsertEntityApproval(params: {
    tenantId: string;
    analysisId: string;
    userId: string;
    entityGroup: WristCaviarMigrationEntityGroup;
    status: 'APPROVED' | 'DEFERRED' | 'IN_REVIEW' | 'BLOCKED';
    reason?: string;
    expectedReviewVersion: number;
  }) {
    const analysis = await this.requireAnalysis(params.tenantId, params.analysisId);
    if (analysis.reviewVersion !== params.expectedReviewVersion) {
      throw new ConflictException({
        message: 'Review version conflict',
        currentVersion: analysis.reviewVersion,
      });
    }

    if (params.status === 'DEFERRED' && (!params.reason || !params.reason.trim())) {
      throw new BadRequestException('Reason is required to defer an entity group');
    }

    if (params.status === 'APPROVED') {
      const blockers = await this.blockingIssuesForGroup(
        params.tenantId,
        params.analysisId,
        params.entityGroup,
      );
      if (blockers.length) {
        throw new BadRequestException({
          message: 'Cannot approve group with unresolved blocking issues',
          blockerCount: blockers.length,
          blockerCodes: blockers.slice(0, 20).map((b) => b.taxonomyCode ?? b.code),
        });
      }
    }

    const approval = await this.prisma.wristCaviarMigrationEntityApproval.upsert({
      where: {
        analysisId_entityGroup: {
          analysisId: params.analysisId,
          entityGroup: params.entityGroup,
        },
      },
      create: {
        tenantId: params.tenantId,
        analysisId: params.analysisId,
        entityGroup: params.entityGroup,
        status: params.status as WristCaviarMigrationEntityApprovalStatus,
        reason: params.reason,
        approvedByUserId: params.userId,
        approvedAt: new Date(),
      },
      update: {
        status: params.status as WristCaviarMigrationEntityApprovalStatus,
        reason: params.reason,
        approvedByUserId: params.userId,
        approvedAt: new Date(),
        invalidatedAt: null,
        invalidationReason: null,
      },
    });

    await this.prisma.wristCaviarMigrationAnalysis.update({
      where: { id: params.analysisId },
      data: { reviewVersion: { increment: 1 } },
    });

    this.logger.log(
      JSON.stringify({
        event: 'WRIST_CAVIAR_ENTITY_APPROVAL',
        analysisId: params.analysisId,
        tenantId: params.tenantId,
        actorUserId: params.userId,
        entityGroup: params.entityGroup,
        status: params.status,
        operationalWrites: 0,
      }),
    );

    return { approval, operationalWrites: 0 };
  }

  async freezeDataset(params: {
    tenantId: string;
    analysisId: string;
    userId: string;
    expectedReviewVersion: number;
  }) {
    const analysis = await this.requireAnalysis(params.tenantId, params.analysisId);
    if (analysis.reviewVersion !== params.expectedReviewVersion) {
      throw new ConflictException({
        message: 'Review version conflict',
        currentVersion: analysis.reviewVersion,
      });
    }

    const [issues, approvals, resolutions] = await Promise.all([
      this.prisma.wristCaviarMigrationIssue.findMany({
        where: { tenantId: params.tenantId, analysisId: params.analysisId },
      }),
      this.prisma.wristCaviarMigrationEntityApproval.findMany({
        where: { tenantId: params.tenantId, analysisId: params.analysisId },
      }),
      this.prisma.wristCaviarMigrationResolution.findMany({
        where: {
          tenantId: params.tenantId,
          analysisId: params.analysisId,
          status: 'ACTIVE',
        },
      }),
    ]);

    const blocking = issues.filter((i) => {
      const tax = (i.taxonomyCode ?? mapLegacyIssueCode(i.code, i.sourceSheet)) as TaxonomyCode;
      return ISSUE_TAXONOMY[tax]?.blocksDryRun && i.reviewStatus === 'UNRESOLVED';
    });
    if (blocking.length) {
      throw new BadRequestException({
        message: 'Cannot freeze with unresolved blocking issues',
        blockerCount: blocking.length,
      });
    }

    for (const group of REQUIRED_APPROVAL_GROUPS) {
      const a = approvals.find((x) => x.entityGroup === group);
      if (!a || (a.status !== 'APPROVED' && a.status !== 'DEFERRED')) {
        throw new BadRequestException({
          message: `Entity group ${group} must be APPROVED or DEFERRED before freeze`,
          entityGroup: group,
          status: a?.status ?? 'NOT_REVIEWED',
        });
      }
      if (a.status === 'DEFERRED' && !a.reason) {
        throw new BadRequestException(`Deferred group ${group} requires a reason`);
      }
    }

    const original = analysis.privateSnapshot as unknown as PrivateSnapshot;
    if (!original) throw new BadRequestException('Original snapshot missing');
    const reviewed = applyResolutionOverlays(
      original,
      resolutions.map((r) => ({
        id: r.id,
        issueId: r.issueId,
        entityType: r.entityType,
        candidateId: r.candidateId,
        resolutionType: r.resolutionType as ResolutionType,
        originalValue: r.originalValue,
        resolvedValue: r.resolvedValue,
        reason: r.reason,
      })),
    );

    const priorCount = await this.prisma.wristCaviarMigrationReviewedDataset.count({
      where: { analysisId: params.analysisId },
    });
    const datasetVersion = `${DATASET_VERSION_PREFIX}${priorCount + 1}`;
    const activeResolutionIds = resolutions.map((r) => r.id);
    const approvalStates = Object.fromEntries(
      approvals.map((a) => [a.entityGroup, { status: a.status, reason: a.reason }]),
    );
    const entityCounts = {
      customers: reviewed.snapshot.customers.length,
      inventory: reviewed.snapshot.inventory.length,
      sales: reviewed.snapshot.sales.length,
      receivables: reviewed.snapshot.receivables.length,
      payables: reviewed.snapshot.payables.length,
      expenses: Array.isArray(reviewed.snapshot.expenses)
        ? reviewed.snapshot.expenses.length
        : 0,
      cash: reviewed.snapshot.cash.length,
      bank: Array.isArray(reviewed.snapshot.bank) ? reviewed.snapshot.bank.length : 0,
      deferred: reviewed.snapshot.deferred.length,
    };
    const reconciliationSummary = {
      matched: reviewed.reconciliation.filter((r) => r.status === 'MATCHED').length,
      withinTolerance: reviewed.reconciliation.filter((r) => r.status === 'WITHIN_TOLERANCE')
        .length,
      mismatch: reviewed.reconciliation.filter((r) => r.status === 'MISMATCH').length,
      scopeReview: reviewed.reconciliation.filter((r) => r.status === 'SCOPE_REVIEW_REQUIRED')
        .length,
      unavailable: reviewed.reconciliation.filter((r) => r.status === 'UNAVAILABLE').length,
      formulaError: reviewed.reconciliation.filter((r) => r.status === 'FORMULA_ERROR').length,
    };

    const fingerprintPayload = {
      datasetVersion,
      parserVersion: analysis.parserVersion,
      sourceWorkbookFingerprint: analysis.fingerprint,
      activeResolutionIds: [...activeResolutionIds].sort(),
      entityCounts,
      reconciliationSummary,
      approvalStates,
      snapshot: reviewed.snapshot,
    };
    const fingerprint = fingerprintReviewedDataset(fingerprintPayload);

    const dataset = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.wristCaviarMigrationReviewedDataset.findFirst({
        where: { analysisId: params.analysisId, supersededByDatasetId: null },
        orderBy: { frozenAt: 'desc' },
      });

      const created = await tx.wristCaviarMigrationReviewedDataset.create({
        data: {
          tenantId: params.tenantId,
          analysisId: params.analysisId,
          datasetVersion,
          fingerprint,
          fingerprintPrefix: fingerprint.slice(0, 12),
          parserVersion: analysis.parserVersion,
          sourceWorkbookFingerprint: analysis.fingerprint,
          activeResolutionIds,
          entityCounts,
          reconciliationSummary,
          approvalStates,
          readiness: WristCaviarMigrationReadiness.READY_FOR_DRY_RUN,
          snapshot: reviewed.snapshot as object,
          frozenByUserId: params.userId,
        },
      });

      if (latest) {
        await tx.wristCaviarMigrationReviewedDataset.update({
          where: { id: latest.id },
          data: { supersededByDatasetId: created.id },
        });
      }

      await tx.wristCaviarMigrationAnalysis.update({
        where: { id: params.analysisId },
        data: {
          readiness: WristCaviarMigrationReadiness.READY_FOR_DRY_RUN,
          reviewedSnapshot: reviewed.snapshot as object,
          reviewVersion: { increment: 1 },
        },
      });

      return created;
    });

    this.logger.log(
      JSON.stringify({
        event: 'WRIST_CAVIAR_DATASET_FROZEN',
        analysisId: params.analysisId,
        tenantId: params.tenantId,
        actorUserId: params.userId,
        datasetId: dataset.id,
        datasetVersion: dataset.datasetVersion,
        fingerprintPrefix: dataset.fingerprintPrefix,
        operationalWrites: 0,
      }),
    );

    return {
      dataset: {
        id: dataset.id,
        datasetVersion: dataset.datasetVersion,
        fingerprintPrefix: dataset.fingerprintPrefix,
        readiness: dataset.readiness,
        entityCounts,
        reconciliationSummary,
        approvalStates,
        frozenAt: dataset.frozenAt,
      },
      operationalWrites: 0,
    };
  }

  async listDatasets(tenantId: string, analysisId: string) {
    await this.requireAnalysis(tenantId, analysisId);
    return this.prisma.wristCaviarMigrationReviewedDataset.findMany({
      where: { tenantId, analysisId },
      orderBy: { frozenAt: 'desc' },
      select: {
        id: true,
        datasetVersion: true,
        fingerprintPrefix: true,
        readiness: true,
        entityCounts: true,
        reconciliationSummary: true,
        approvalStates: true,
        frozenAt: true,
        supersededByDatasetId: true,
      },
    });
  }

  async getDataset(tenantId: string, analysisId: string, datasetId: string) {
    await this.requireAnalysis(tenantId, analysisId);
    const row = await this.prisma.wristCaviarMigrationReviewedDataset.findFirst({
      where: { id: datasetId, tenantId, analysisId },
      select: {
        id: true,
        datasetVersion: true,
        fingerprintPrefix: true,
        parserVersion: true,
        readiness: true,
        entityCounts: true,
        reconciliationSummary: true,
        approvalStates: true,
        activeResolutionIds: true,
        frozenAt: true,
        supersededByDatasetId: true,
        // snapshot intentionally omitted from default get — use explicit preview if needed
      },
    });
    if (!row) throw new NotFoundException('Dataset not found');
    return row;
  }

  private sanitizeCard(card: PrivateSnapshot['receivables'][number]) {
    return {
      id: card.id,
      customerName: card.customerName,
      watchOrConcept: card.watchOrConcept,
      principal: card.principal,
      declaredOutstanding: card.declaredOutstanding,
      calculatedOutstanding: card.calculatedOutstanding,
      balanceMismatch: card.balanceMismatch,
      currency: card.currency,
      ambiguous: card.ambiguous,
      payments: card.payments.map((p) => ({
        id: p.id,
        label: p.label,
        amount: p.amount,
        paymentDate: p.paymentDate,
        note: p.note,
      })),
    };
  }

  private async loadReviewed(tenantId: string, analysisId: string) {
    const analysis = await this.requireAnalysis(tenantId, analysisId);
    const original = analysis.privateSnapshot as unknown as PrivateSnapshot;
    if (!original) throw new BadRequestException('Snapshot missing');
    const [resolutions, issues] = await Promise.all([
      this.prisma.wristCaviarMigrationResolution.findMany({
        where: { tenantId, analysisId, status: 'ACTIVE' },
      }),
      this.prisma.wristCaviarMigrationIssue.findMany({ where: { tenantId, analysisId } }),
    ]);
    const reviewed = applyResolutionOverlays(
      original,
      resolutions.map((r) => ({
        id: r.id,
        issueId: r.issueId,
        entityType: r.entityType,
        candidateId: r.candidateId,
        resolutionType: r.resolutionType as ResolutionType,
        originalValue: r.originalValue,
        resolvedValue: r.resolvedValue,
        reason: r.reason,
      })),
    );
    return { analysis, snapshot: reviewed.snapshot, issues, effects: reviewed.effects };
  }

  private computeReadiness(input: {
    issues: Array<{
      code: string;
      taxonomyCode: string | null;
      sourceSheet: string | null;
      severity: string;
      reviewStatus: string;
    }>;
    approvals: Array<{ entityGroup: string; status: string; reason: string | null }>;
    hasFrozenDataset: boolean;
  }): WristCaviarMigrationReadiness {
    const blockingUnresolved = input.issues.filter((i) => {
      const tax = (i.taxonomyCode ?? mapLegacyIssueCode(i.code, i.sourceSheet)) as TaxonomyCode;
      return ISSUE_TAXONOMY[tax]?.blocksDryRun && i.reviewStatus === 'UNRESOLVED';
    });
    if (blockingUnresolved.length) return WristCaviarMigrationReadiness.BLOCKED;

    const requiredOk = REQUIRED_APPROVAL_GROUPS.every((g) => {
      const a = input.approvals.find((x) => x.entityGroup === g);
      return a && (a.status === 'APPROVED' || a.status === 'DEFERRED');
    });
    if (!requiredOk || !input.hasFrozenDataset) {
      return WristCaviarMigrationReadiness.NEEDS_REVIEW;
    }
    return WristCaviarMigrationReadiness.READY_FOR_DRY_RUN;
  }

  private affectedGroups(
    entityType: string | undefined,
    taxonomy: TaxonomyCode,
  ): WristCaviarMigrationEntityGroup[] {
    if (entityType === 'receivable') return ['RECEIVABLES'];
    if (entityType === 'payable') return ['PAYABLES'];
    if (entityType === 'sale') return ['SALES'];
    if (entityType === 'inventory') return ['INVENTORY'];
    if (entityType === 'customer') return ['CUSTOMERS'];
    if (taxonomy.startsWith('CASH')) return ['CASH_LEDGER'];
    if (taxonomy.startsWith('BANK')) return ['BANK_LEDGER'];
    if (taxonomy === 'DEFERRED_DESTINATION') return ['DEFERRED'];
    if (taxonomy.includes('PROFIT') || taxonomy.includes('PARTNER')) {
      return ['PARTNER_LEDGER', 'PROFIT_DISTRIBUTIONS'];
    }
    return [];
  }

  private async blockingIssuesForGroup(
    tenantId: string,
    analysisId: string,
    group: WristCaviarMigrationEntityGroup,
  ) {
    const issues = await this.prisma.wristCaviarMigrationIssue.findMany({
      where: { tenantId, analysisId, reviewStatus: 'UNRESOLVED' },
    });
    return issues.filter((i) => {
      const tax = (i.taxonomyCode ?? mapLegacyIssueCode(i.code, i.sourceSheet)) as TaxonomyCode;
      if (!ISSUE_TAXONOMY[tax]?.blocksDryRun) return false;
      const affected = this.affectedGroups(i.entityType ?? undefined, tax);
      if (affected.includes(group)) return true;
      // Sheet-based fallback
      if (group === 'RECEIVABLES' && i.sourceSheet === 'CTAS X COBRAR') return true;
      if (group === 'PAYABLES' && i.sourceSheet === 'CTAS X PAGAR') return true;
      if (group === 'SALES' && i.sourceSheet === 'VENTAS') return tax === 'INVALID_AMOUNT' || tax === 'INVALID_DATE';
      if (group === 'INVENTORY' && i.sourceSheet === 'INVENTARIO') {
        return tax === 'DUPLICATE_INVENTORY_SERIAL';
      }
      if (group === 'DEFERRED' && tax === 'DEFERRED_DESTINATION') return false; // defer is the resolution
      return false;
    });
  }

  private async ensureApprovals(tenantId: string, analysisId: string) {
    const existing = await this.prisma.wristCaviarMigrationEntityApproval.findMany({
      where: { analysisId },
    });
    const have = new Set(existing.map((e) => e.entityGroup));
    const missing = REQUIRED_APPROVAL_GROUPS.filter((g) => !have.has(g));
    if (!missing.length) return;
    await this.prisma.wristCaviarMigrationEntityApproval.createMany({
      data: missing.map((entityGroup) => ({
        tenantId,
        analysisId,
        entityGroup,
        status: WristCaviarMigrationEntityApprovalStatus.NOT_REVIEWED,
      })),
      skipDuplicates: true,
    });
  }

  private async ensureTaxonomyCodes(tenantId: string, analysisId: string) {
    const issues = await this.prisma.wristCaviarMigrationIssue.findMany({
      where: { tenantId, analysisId, taxonomyCode: null },
    });
    for (const issue of issues) {
      await this.prisma.wristCaviarMigrationIssue.update({
        where: { id: issue.id },
        data: {
          taxonomyCode: mapLegacyIssueCode(issue.code, issue.sourceSheet),
        },
      });
    }
  }

  private async requireAnalysis(tenantId: string, analysisId: string) {
    const row = await this.prisma.wristCaviarMigrationAnalysis.findFirst({
      where: { id: analysisId, tenantId },
    });
    if (!row) throw new NotFoundException('Analysis not found');
    return row;
  }
}
