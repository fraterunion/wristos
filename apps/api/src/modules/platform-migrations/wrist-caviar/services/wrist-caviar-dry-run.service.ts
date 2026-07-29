import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  WristCaviarDryRunAction,
  WristCaviarDryRunPlanReadiness,
  WristCaviarDryRunStatus,
  WristCaviarMigrationEntityApprovalStatus,
  WristCaviarMigrationReadiness,
} from '@prisma/client';

import { PrismaService } from '../../../../prisma/prisma.service';
import { fingerprintReviewedDataset } from '../review/overlay-engine';
import type { PrivateSnapshot } from '../review/overlay-engine';
import type { ActiveResolution } from '../review/overlay-engine';
import { ISSUE_TAXONOMY, mapLegacyIssueCode, type TaxonomyCode } from '../review/issue-taxonomy';
import { loadDestinationState } from '../dry-run/destination-state';
import { fingerprintPrefix } from '../dry-run/hash';
import {
  dryRunBatchSize,
  PLANNER_VERSION,
  SUPPORTED_DATASET_VERSION_PREFIX,
  SUPPORTED_PARSER_VERSIONS,
} from '../dry-run/planner.constants';
import { buildDryRunPlan, planFingerprintPrefix } from '../dry-run/planner';

const REQUIRED_APPROVAL_GROUPS = [
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
] as const;

@Injectable()
export class WristCaviarDryRunService {
  private readonly logger = new Logger(WristCaviarDryRunService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generate(params: {
    tenantId: string;
    datasetId: string;
    userId: string;
  }) {
    const started = Date.now();
    const dataset = await this.requireReadyDataset(params.tenantId, params.datasetId);

    const dryRun = await this.prisma.wristCaviarMigrationDryRun.create({
      data: {
        tenantId: params.tenantId,
        analysisId: dataset.analysisId,
        datasetId: dataset.id,
        datasetVersion: dataset.datasetVersion,
        datasetFingerprint: dataset.fingerprint,
        status: WristCaviarDryRunStatus.GENERATING,
        plannerVersion: PLANNER_VERSION,
        sourceCounts: {},
        actionCounts: {},
        conflictCounts: {},
        progressPhase: 'Validando dataset',
        createdByUserId: params.userId,
      },
    });

    this.logger.log(
      JSON.stringify({
        event: 'wrist_caviar_dry_run_start',
        tenantId: params.tenantId,
        datasetId: params.datasetId,
        dryRunId: dryRun.id,
        plannerVersion: PLANNER_VERSION,
      }),
    );

    try {
      await this.setPhase(dryRun.id, 'Comparando clientes');
      const destination = await loadDestinationState(
        this.prisma,
        params.tenantId,
        dataset.id,
      );

      const approvals = await this.prisma.wristCaviarMigrationEntityApproval.findMany({
        where: { tenantId: params.tenantId, analysisId: dataset.analysisId },
      });
      const deferredGroups = approvals
        .filter((a) => a.status === WristCaviarMigrationEntityApprovalStatus.DEFERRED)
        .map((a) => a.entityGroup);

      const resolutions = await this.prisma.wristCaviarMigrationResolution.findMany({
        where: {
          tenantId: params.tenantId,
          analysisId: dataset.analysisId,
          status: 'ACTIVE',
        },
        orderBy: { resolvedAt: 'asc' },
      });

      const activeResolutions: ActiveResolution[] = resolutions.map((r) => ({
        id: r.id,
        issueId: r.issueId,
        entityType: r.entityType,
        candidateId: r.candidateId,
        resolutionType: r.resolutionType as ActiveResolution['resolutionType'],
        originalValue: r.originalValue,
        resolvedValue: r.resolvedValue,
        reason: r.reason,
      }));

      await this.setPhase(dryRun.id, 'Comparando inventario');
      await this.setPhase(dryRun.id, 'Preparando ventas históricas');
      await this.setPhase(dryRun.id, 'Simulando cuentas');

      const snapshot = dataset.snapshot as unknown as PrivateSnapshot;
      const plan = buildDryRunPlan({
        tenantId: params.tenantId,
        datasetId: dataset.id,
        datasetFingerprint: dataset.fingerprint,
        snapshot,
        destination,
        resolutions: activeResolutions,
        deferredGroups,
      });

      await this.setPhase(dryRun.id, 'Calculando impacto financiero');
      await this.setPhase(dryRun.id, 'Conciliando contra REPORTE');

      const batchSize = dryRunBatchSize();
      for (let i = 0; i < plan.items.length; i += batchSize) {
        const chunk = plan.items.slice(i, i + batchSize);
        await this.prisma.wristCaviarMigrationDryRunItem.createMany({
          data: chunk.map((item) => ({
            dryRunId: dryRun.id,
            tenantId: params.tenantId,
            entityGroup: item.entityGroup,
            entityType: item.entityType,
            sourceCandidateId: item.sourceCandidateId,
            sourceFingerprint: item.sourceFingerprint,
            action: item.action,
            confidence: item.confidence ?? null,
            destinationId: item.destinationId ?? null,
            dependencyKeys: (item.dependencyKeys ?? undefined) as object | undefined,
            plannedPayload: (item.plannedPayload ?? undefined) as object | undefined,
            comparisonSnapshot: (item.comparisonSnapshot ?? undefined) as object | undefined,
            conflictCode: item.conflictCode ?? null,
            conflictDetails: (item.conflictDetails ?? undefined) as object | undefined,
            provenance: item.provenance as object,
            sequence: item.sequence,
          })),
        });
      }

      const status =
        plan.blockingConflictCount > 0
          ? WristCaviarDryRunStatus.COMPLETED_WITH_CONFLICTS
          : WristCaviarDryRunStatus.COMPLETED;
      const planReadiness =
        plan.planReadiness === 'READY_FOR_APPROVAL'
          ? WristCaviarDryRunPlanReadiness.READY_FOR_APPROVAL
          : WristCaviarDryRunPlanReadiness.NEEDS_CONFLICT_RESOLUTION;

      const durationMs = Date.now() - started;
      const updated = await this.prisma.wristCaviarMigrationDryRun.update({
        where: { id: dryRun.id },
        data: {
          status,
          planReadiness,
          planFingerprint: plan.planFingerprint,
          planFingerprintPrefix: planFingerprintPrefix(plan.planFingerprint),
          destinationStateFingerprint: destination.overallFingerprint,
          destinationStateByGroup: destination.fingerprintsByGroup,
          sourceCounts: plan.sourceCounts,
          actionCounts: plan.actionCounts,
          conflictCounts: plan.conflictCounts,
          financialSummary: plan.financialSummary as object,
          reconciliationSummary: plan.reconciliationSummary as object,
          dependencySummary: plan.dependencySummary as object,
          progressPhase: null,
          completedAt: new Date(),
          durationMs,
        },
      });

      this.logger.log(
        JSON.stringify({
          event: 'wrist_caviar_dry_run_complete',
          tenantId: params.tenantId,
          datasetId: params.datasetId,
          dryRunId: dryRun.id,
          plannerVersion: PLANNER_VERSION,
          actionCounts: plan.actionCounts,
          conflictCounts: plan.conflictCounts,
          durationMs,
          planFingerprintPrefix: updated.planFingerprintPrefix,
          status,
        }),
      );

      return this.sanitizeDryRun(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'planner_failed';
      await this.prisma.wristCaviarMigrationDryRun.update({
        where: { id: dryRun.id },
        data: {
          status: WristCaviarDryRunStatus.FAILED,
          planReadiness: WristCaviarDryRunPlanReadiness.FAILED,
          errorMessage: message.slice(0, 500),
          completedAt: new Date(),
          durationMs: Date.now() - started,
          progressPhase: null,
        },
      });
      this.logger.warn(
        JSON.stringify({
          event: 'wrist_caviar_dry_run_failed',
          tenantId: params.tenantId,
          datasetId: params.datasetId,
          dryRunId: dryRun.id,
          plannerVersion: PLANNER_VERSION,
        }),
      );
      throw err;
    }
  }

  async regenerate(params: { tenantId: string; dryRunId: string; userId: string }) {
    const existing = await this.requireDryRun(params.tenantId, params.dryRunId);
    // Old plan remains immutable — mark superseded logically via INVALIDATED note, create new
    await this.prisma.wristCaviarMigrationDryRun.update({
      where: { id: existing.id },
      data: {
        // Keep COMPLETED plans readable; mark as superseded context only if regenerating
        invalidationReason: existing.invalidationReason ?? `superseded_by_regeneration`,
      },
    });
    return this.generate({
      tenantId: params.tenantId,
      datasetId: existing.datasetId,
      userId: params.userId,
    });
  }

  async getDryRun(tenantId: string, dryRunId: string) {
    const row = await this.requireDryRun(tenantId, dryRunId);
    const freshness = await this.computeFreshness(row);
    return { ...this.sanitizeDryRun(row), freshness };
  }

  async listItems(
    tenantId: string,
    dryRunId: string,
    query: {
      entityGroup?: string;
      action?: string;
      conflictCode?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    await this.requireDryRun(tenantId, dryRunId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 50));
    const where = {
      tenantId,
      dryRunId,
      ...(query.entityGroup ? { entityGroup: query.entityGroup } : {}),
      ...(query.action ? { action: query.action as WristCaviarDryRunAction } : {}),
      ...(query.conflictCode ? { conflictCode: query.conflictCode } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.wristCaviarMigrationDryRunItem.count({ where }),
      this.prisma.wristCaviarMigrationDryRunItem.findMany({
        where,
        orderBy: { sequence: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      page,
      pageSize,
      total,
      items: items.map((i) => this.sanitizeItem(i)),
    };
  }

  async getDependencies(tenantId: string, dryRunId: string) {
    const row = await this.requireDryRun(tenantId, dryRunId);
    return {
      dryRunId,
      dependencySummary: row.dependencySummary,
      order: (row.dependencySummary as { order?: string[] } | null)?.order ?? [],
    };
  }

  async getFinancialSummary(tenantId: string, dryRunId: string) {
    const row = await this.requireDryRun(tenantId, dryRunId);
    return {
      dryRunId,
      label: 'Simulación; ningún dato ha sido modificado.',
      financialSummary: row.financialSummary,
      actionCounts: row.actionCounts,
    };
  }

  async getReconciliation(tenantId: string, dryRunId: string) {
    const row = await this.requireDryRun(tenantId, dryRunId);
    return {
      dryRunId,
      reconciliationSummary: row.reconciliationSummary,
    };
  }

  async validateFreshness(tenantId: string, dryRunId: string) {
    const row = await this.requireDryRun(tenantId, dryRunId);
    const freshness = await this.computeFreshness(row);
    if (freshness.stale) {
      await this.prisma.wristCaviarMigrationDryRun.update({
        where: { id: row.id },
        data: {
          status: WristCaviarDryRunStatus.STALE,
          planReadiness: WristCaviarDryRunPlanReadiness.STALE,
          invalidatedAt: new Date(),
          invalidationReason: `destination_state_changed:${freshness.affectedGroups.join(',')}`,
        },
      });
    }
    return freshness;
  }

  /** Assert operational tables unchanged — used by integration tests. */
  async countOperational(tenantId: string) {
    const [
      clients,
      watches,
      deals,
      receivables,
      payables,
      accountPayments,
      expenses,
      treasury,
      contributions,
      distributions,
    ] = await Promise.all([
      this.prisma.client.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.watch.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.deal.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.accountEntry.count({
        where: { tenantId, type: 'RECEIVABLE', deletedAt: null },
      }),
      this.prisma.accountEntry.count({
        where: { tenantId, type: 'PAYABLE', deletedAt: null },
      }),
      this.prisma.accountPayment.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.operatingExpense.count({ where: { tenantId } }),
      this.prisma.treasuryEntry.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.investorContribution.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.investorDistribution.count({ where: { tenantId, deletedAt: null } }),
    ]);
    return {
      clients,
      watches,
      deals,
      receivables,
      payables,
      accountPayments,
      expenses,
      treasury,
      contributions,
      distributions,
    };
  }

  private async computeFreshness(row: {
    id: string;
    tenantId: string;
    datasetId: string;
    destinationStateFingerprint: string | null;
    destinationStateByGroup: unknown;
    status: WristCaviarDryRunStatus;
    planReadiness: WristCaviarDryRunPlanReadiness | null;
  }) {
    const current = await loadDestinationState(this.prisma, row.tenantId, row.datasetId);
    const stale =
      Boolean(row.destinationStateFingerprint) &&
      row.destinationStateFingerprint !== current.overallFingerprint;
    const prior = (row.destinationStateByGroup ?? {}) as Record<string, string>;
    const affectedGroups = Object.keys(current.fingerprintsByGroup).filter(
      (g) => prior[g] && prior[g] !== current.fingerprintsByGroup[g],
    );
    return {
      dryRunId: row.id,
      stale,
      affectedGroups,
      currentFingerprintPrefix: fingerprintPrefix(current.overallFingerprint),
      storedFingerprintPrefix: row.destinationStateFingerprint
        ? fingerprintPrefix(row.destinationStateFingerprint)
        : null,
      approvable: !stale && row.planReadiness === 'READY_FOR_APPROVAL',
      message: stale
        ? 'La base operativa cambió; regenere la simulación.'
        : 'El plan sigue vigente respecto al estado destino.',
    };
  }

  private async requireReadyDataset(tenantId: string, datasetId: string) {
    const dataset = await this.prisma.wristCaviarMigrationReviewedDataset.findFirst({
      where: { id: datasetId },
    });
    if (!dataset) {
      throw new NotFoundException({
        code: 'DATASET_NOT_READY',
        message: 'Dataset no encontrado.',
      });
    }
    if (dataset.tenantId !== tenantId) {
      throw new BadRequestException({
        code: 'TENANT_MISMATCH',
        message: 'El dataset no pertenece al tenant seleccionado.',
      });
    }
    if (dataset.supersededByDatasetId) {
      throw new BadRequestException({
        code: 'DATASET_NOT_READY',
        message: 'El dataset fue reemplazado por una versión posterior.',
      });
    }
    if (dataset.readiness !== WristCaviarMigrationReadiness.READY_FOR_DRY_RUN) {
      throw new BadRequestException({
        code: 'DATASET_NOT_READY',
        message: `Readiness ${dataset.readiness} no permite simulación.`,
      });
    }
    if (!dataset.datasetVersion.startsWith(SUPPORTED_DATASET_VERSION_PREFIX)) {
      throw new BadRequestException({
        code: 'DATASET_NOT_READY',
        message: 'Versión de dataset no soportada.',
      });
    }
    if (
      !SUPPORTED_PARSER_VERSIONS.includes(
        dataset.parserVersion as (typeof SUPPORTED_PARSER_VERSIONS)[number],
      )
    ) {
      throw new BadRequestException({
        code: 'DATASET_NOT_READY',
        message: 'Versión de parser no soportada.',
      });
    }

    const activeResolutionIds = Array.isArray(dataset.activeResolutionIds)
      ? [...(dataset.activeResolutionIds as string[])].sort()
      : [];
    const recomputed = fingerprintReviewedDataset({
      datasetVersion: dataset.datasetVersion,
      parserVersion: dataset.parserVersion,
      sourceWorkbookFingerprint: dataset.sourceWorkbookFingerprint,
      activeResolutionIds,
      entityCounts: dataset.entityCounts,
      reconciliationSummary: dataset.reconciliationSummary,
      approvalStates: dataset.approvalStates,
      snapshot: dataset.snapshot,
    });
    if (dataset.fingerprint !== recomputed) {
      throw new BadRequestException({
        code: 'DATASET_INTEGRITY_FAILURE',
        message: 'La huella del dataset congelado no es válida.',
      });
    }

    const approvals = await this.prisma.wristCaviarMigrationEntityApproval.findMany({
      where: { tenantId, analysisId: dataset.analysisId },
    });
    for (const group of REQUIRED_APPROVAL_GROUPS) {
      const row = approvals.find((a) => a.entityGroup === group);
      if (!row) {
        throw new BadRequestException({
          code: 'DATASET_NOT_READY',
          message: `Falta aprobación de grupo ${group}.`,
        });
      }
      if (
        row.status !== WristCaviarMigrationEntityApprovalStatus.APPROVED &&
        row.status !== WristCaviarMigrationEntityApprovalStatus.DEFERRED
      ) {
        throw new BadRequestException({
          code: 'DATASET_NOT_READY',
          message: `Grupo ${group} no está APPROVED ni DEFERRED.`,
        });
      }
    }

    const issues = await this.prisma.wristCaviarMigrationIssue.findMany({
      where: { tenantId, analysisId: dataset.analysisId },
    });
    const blocking = issues.filter((i) => {
      const tax = (i.taxonomyCode ?? mapLegacyIssueCode(i.code, i.sourceSheet)) as TaxonomyCode;
      return ISSUE_TAXONOMY[tax]?.blocksDryRun && i.reviewStatus === 'UNRESOLVED';
    });
    if (blocking.length > 0) {
      throw new BadRequestException({
        code: 'DATASET_NOT_READY',
        message: `Hay ${blocking.length} issues bloqueantes sin resolver.`,
      });
    }

    return dataset;
  }

  private async requireDryRun(tenantId: string, dryRunId: string) {
    const row = await this.prisma.wristCaviarMigrationDryRun.findFirst({
      where: { id: dryRunId, tenantId },
    });
    if (!row) throw new NotFoundException('Dry-run no encontrado');
    return row;
  }

  private async setPhase(dryRunId: string, phase: string) {
    await this.prisma.wristCaviarMigrationDryRun.update({
      where: { id: dryRunId },
      data: { progressPhase: phase },
    });
  }

  private sanitizeDryRun(row: {
    id: string;
    tenantId: string;
    analysisId: string;
    datasetId: string;
    datasetVersion: string;
    datasetFingerprint: string;
    status: WristCaviarDryRunStatus;
    planReadiness: WristCaviarDryRunPlanReadiness | null;
    plannerVersion: string;
    planFingerprint: string | null;
    planFingerprintPrefix: string | null;
    destinationStateFingerprint: string | null;
    sourceCounts: unknown;
    actionCounts: unknown;
    conflictCounts: unknown;
    financialSummary: unknown;
    reconciliationSummary: unknown;
    dependencySummary: unknown;
    progressPhase: string | null;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
    invalidatedAt: Date | null;
    invalidationReason: string | null;
    durationMs: number | null;
  }) {
    return {
      id: row.id,
      tenantId: row.tenantId,
      analysisId: row.analysisId,
      datasetId: row.datasetId,
      datasetVersion: row.datasetVersion,
      datasetFingerprintPrefix: fingerprintPrefix(row.datasetFingerprint),
      status: row.status,
      planReadiness: row.planReadiness,
      plannerVersion: row.plannerVersion,
      planFingerprintPrefix: row.planFingerprintPrefix,
      destinationStateFingerprintPrefix: row.destinationStateFingerprint
        ? fingerprintPrefix(row.destinationStateFingerprint)
        : null,
      sourceCounts: row.sourceCounts,
      actionCounts: row.actionCounts,
      conflictCounts: row.conflictCounts,
      financialSummary: row.financialSummary,
      reconciliationSummary: row.reconciliationSummary,
      dependencySummary: row.dependencySummary,
      progressPhase: row.progressPhase,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      invalidatedAt: row.invalidatedAt,
      invalidationReason: row.invalidationReason,
      durationMs: row.durationMs,
      operationalWrites: 0,
      label: 'Simulación; ningún dato ha sido modificado.',
    };
  }

  private sanitizeItem(item: {
    id: string;
    entityGroup: string;
    entityType: string;
    sourceCandidateId: string;
    sourceFingerprint: string;
    action: WristCaviarDryRunAction;
    confidence: string | null;
    destinationId: string | null;
    dependencyKeys: unknown;
    plannedPayload: unknown;
    comparisonSnapshot: unknown;
    conflictCode: string | null;
    conflictDetails: unknown;
    provenance: unknown;
    sequence: number;
  }) {
    const actionLabels: Record<string, string> = {
      CREATE: 'Se crearía',
      LINK: 'Se vincularía con un registro existente',
      SKIP: 'Ya existe; no se realizaría ninguna acción',
      CONFLICT: 'Requiere resolución antes de importar',
      DEFERRED: 'Fuera del alcance de esta migración',
    };
    return {
      id: item.id,
      entityGroup: item.entityGroup,
      entityType: item.entityType,
      sourceCandidateId: item.sourceCandidateId,
      sourceFingerprintPrefix: fingerprintPrefix(item.sourceFingerprint),
      action: item.action,
      actionLabel: actionLabels[item.action] ?? item.action,
      confidence: item.confidence,
      destinationId: item.destinationId,
      dependencyKeys: item.dependencyKeys,
      // Planned payload returned for Platform Admin detail drawer only
      plannedPayload: item.plannedPayload,
      comparisonSnapshot: item.comparisonSnapshot,
      conflictCode: item.conflictCode,
      conflictDetails: item.conflictDetails,
      provenance: item.provenance,
      sequence: item.sequence,
    };
  }
}
