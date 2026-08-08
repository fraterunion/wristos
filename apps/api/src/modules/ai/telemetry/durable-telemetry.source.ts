/**
 * Production telemetry source of truth: existing durable AI tables.
 * Never process-local memory/JSONL for authoritative KPIs.
 *
 * Units:
 * - AIRequest — terminal exactly once (NEEDS_CLARIFICATION | READY_FOR_CONFIRMATION | COMPLETED | FAILED)
 * - AIActionRun — terminal exactly once (COMPLETED | FAILED | CANCELLED | STALE | …)
 * - Capability attempt — derived from ActionRun.intent + audit timeline
 * - Conversation — resumable; NEVER forced to a single final outcome
 */
import { Injectable } from '@nestjs/common';
import {
  AIActionRunStatus,
  AIAuditEventType,
  AIRequestStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashId } from './telemetry-privacy';
import { ClarificationType } from './telemetry.types';
import { mapClarificationType } from './telemetry-mappers';

export type HealthWindow = 'today' | '7d' | '30d';

export const ABANDONMENT_OBSERVATION_MS = 24 * 60 * 60 * 1000; // analytics-only inference window

const DANGEROUS_WRITES = new Set([
  'REGISTER_SALE',
  'REGISTER_RECEIVABLE_PAYMENT',
  'REGISTER_EXPENSE',
  'REGISTER_PURCHASE',
]);

const TERMINAL_REQUEST = new Set<AIRequestStatus>([
  AIRequestStatus.NEEDS_CLARIFICATION,
  AIRequestStatus.READY_FOR_CONFIRMATION,
  AIRequestStatus.COMPLETED,
  AIRequestStatus.FAILED,
]);

export type DurableHealthReport = {
  generatedAt: string;
  sourceOfTruth: 'AIRequest+AIActionRun+AIAuditEvent';
  window: HealthWindow;
  windowStart: string;
  windowEnd: string;
  scope: 'platform_global' | 'tenant_filtered';
  tenantFilterHash?: string;
  requestCount: number;
  actionRunCount: number;
  auditEventCount: number;
  kpis: {
    successRate: number;
    failureRate: number;
    clarificationRate: number;
    confirmationRate: number;
    cancellationRate: number;
    recoveryRate: number;
    replayRate: number;
    unknownIntentRate: number;
    inferredAbandonmentRate: number;
    avgProviderLatencyMs: number | null;
    avgPlannerLatencyMs: number | null;
    avgRequestLatencyMs: number | null;
    avgExecutionLatencyMs: number | null;
  };
  denominators: {
    requests: number;
    requestsWithPreview: number;
    actionRuns: number;
    dangerousWriteAttempts: number;
    clarificationsAwaiting: number;
  };
  requestOutcomes: Record<string, number>;
  actionRunOutcomes: Record<string, number>;
  topFailedIntents: Array<{ intent: string; count: number }>;
  topClarifications: Array<{ type: string; count: number }>;
  topCapabilities: Array<{ capability: string; count: number }>;
  topRecoveryCauses: Array<{ reason: string; count: number }>;
  topSlowQueries: Array<{ capability: string; avgTotalLatencyMs: number; count: number }>;
  capabilityFunnels: Record<
    string,
    {
      intent: number;
      preview: number;
      confirmation: number;
      execution: number;
      receipt: number;
      completed: number;
    }
  >;
  dangerousWriteVerification: {
    capabilities: string[];
    violations: Array<{ actionRunHash?: string; capability?: string; detail: string }>;
    ok: boolean;
  };
  latencyBreakdown: {
    provider: { avg: number | null; p95: number | null; count: number; note: string };
    planner: { avg: number | null; p95: number | null; count: number; note: string };
    binding: { avg: number | null; p95: number | null; count: number; note: string };
    domain: { avg: number | null; p95: number | null; count: number; note: string };
    total: { avg: number | null; p95: number | null; count: number; note: string };
    sql: { avg: number | null; p95: number | null; count: number; note: string };
  };
  retentionNote: string;
  passive: true;
};

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function p95(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
}

function rate(num: number, den: number): number {
  if (den <= 0) return 0;
  return Math.round((num / den) * 10000) / 10000;
}

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function topN(map: Record<string, number>, n: number) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, count]) => ({ key: k, count }));
}

function windowStart(window: HealthWindow, now: Date): Date {
  if (window === 'today') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  const days = window === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readIntent(payload: unknown): string {
  const r = asRecord(payload);
  if (!r) return 'UNKNOWN';
  if (typeof r.resolvedIntent === 'string' && r.resolvedIntent) return r.resolvedIntent;
  if (typeof r.intent === 'string' && r.intent) return r.intent;
  return 'UNKNOWN';
}

function readProviderMetrics(payload: unknown): {
  providerLatencyMs?: number;
} {
  const r = asRecord(payload);
  const m = asRecord(r?.providerMetrics);
  if (!m) return {};
  return {
    providerLatencyMs: typeof m.latencyMs === 'number' ? m.latencyMs : undefined,
  };
}

function readResponseType(payload: unknown): string | null {
  const r = asRecord(payload);
  return typeof r?.responseType === 'string' ? r.responseType : null;
}

function clarificationTypeFromResponse(responseType: string | null, errorType: string | null): ClarificationType {
  if (responseType === 'ENTITY_PICKER') return 'ENTITY_AMBIGUITY';
  if (responseType === 'MISSING_FIELDS_CARD') return 'MISSING_FIELD';
  if (errorType) return mapClarificationType(errorType);
  return 'OTHER';
}

@Injectable()
export class DurableTelemetrySource {
  constructor(private readonly prisma: PrismaService) {}

  async aggregate(options: {
    window: HealthWindow;
    tenantId?: string;
    now?: Date;
  }): Promise<DurableHealthReport> {
    const now = options.now ?? new Date();
    const start = windowStart(options.window, now);
    const tenantWhere: Prisma.AIRequestWhereInput = options.tenantId
      ? { tenantId: options.tenantId }
      : {};

    const [requests, actionRuns, auditEvents] = await Promise.all([
      this.prisma.aIRequest.findMany({
        where: { ...tenantWhere, receivedAt: { gte: start, lte: now } },
        select: {
          id: true,
          tenantId: true,
          status: true,
          requestPayload: true,
          responsePayload: true,
          errorType: true,
          receivedAt: true,
          completedAt: true,
          failedAt: true,
        },
        take: 20_000,
        orderBy: { receivedAt: 'desc' },
      }),
      this.prisma.aIActionRun.findMany({
        where: {
          ...(options.tenantId ? { tenantId: options.tenantId } : {}),
          createdAt: { gte: start, lte: now },
        },
        select: {
          id: true,
          intent: true,
          status: true,
          confirmedAt: true,
          executedAt: true,
          completedAt: true,
          createdAt: true,
          result: true,
          requiresConfirmation: true,
        },
        take: 20_000,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.aIAuditEvent.findMany({
        where: {
          ...(options.tenantId ? { tenantId: options.tenantId } : {}),
          createdAt: { gte: start, lte: now },
          type: {
            in: [
              AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
              AIAuditEventType.ASSISTANT_REQUEST_FAILED,
              AIAuditEventType.ASSISTANT_REQUEST_REPLAYED,
              AIAuditEventType.PLAN_CREATED,
              AIAuditEventType.PLAN_NEEDS_CLARIFICATION,
              AIAuditEventType.PLAN_READY_FOR_CONFIRMATION,
              AIAuditEventType.PLAN_CONFIRMED,
              AIAuditEventType.EXECUTION_STARTED,
              AIAuditEventType.EXECUTION_COMPLETED,
              AIAuditEventType.EXECUTION_FAILED,
              AIAuditEventType.EXECUTION_CANCELLED,
            ],
          },
        },
        select: {
          type: true,
          actionRunId: true,
          payload: true,
        },
        take: 50_000,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const requestOutcomes: Record<string, number> = {};
    const actionRunOutcomes: Record<string, number> = {};
    const failedIntents: Record<string, number> = {};
    const clarifications: Record<string, number> = {};
    const capabilities: Record<string, number> = {};
    const recoveryCauses: Record<string, number> = {};
    const slow: Record<string, { sum: number; count: number }> = {};
    const funnels: Record<
      string,
      { intent: number; preview: number; confirmation: number; execution: number; receipt: number; completed: number }
    > = {};

    let success = 0;
    let failed = 0;
    let clarificationReq = 0;
    let unknownIntent = 0;
    let previewReady = 0;
    let inferredAbandoned = 0;
    let clarificationsAwaiting = 0;

    const providerLat: number[] = [];
    const plannerLat: number[] = [];
    const requestLat: number[] = [];
    const execLat: number[] = [];

    for (const req of requests) {
      bump(requestOutcomes, req.status);
      const intent = readIntent(req.requestPayload);
      bump(capabilities, intent);
      const metrics = readProviderMetrics(req.requestPayload);
      if (typeof metrics.providerLatencyMs === 'number') providerLat.push(metrics.providerLatencyMs);
      if (intent === 'UNKNOWN') unknownIntent += 1;

      if (req.status === AIRequestStatus.COMPLETED) success += 1;
      if (req.status === AIRequestStatus.FAILED) {
        failed += 1;
        bump(failedIntents, intent);
      }
      if (req.status === AIRequestStatus.NEEDS_CLARIFICATION) {
        clarificationReq += 1;
        clarificationsAwaiting += 1;
        const rt = readResponseType(req.responsePayload);
        bump(clarifications, clarificationTypeFromResponse(rt, req.errorType));
        const age = now.getTime() - (req.completedAt ?? req.failedAt ?? req.receivedAt).getTime();
        if (age >= ABANDONMENT_OBSERVATION_MS) inferredAbandoned += 1;
      }
      if (req.status === AIRequestStatus.READY_FOR_CONFIRMATION) previewReady += 1;

      const end = req.completedAt ?? req.failedAt;
      if (end) {
        const totalMs = Math.max(0, end.getTime() - req.receivedAt.getTime());
        requestLat.push(totalMs);
        const slot = slow[intent] ?? { sum: 0, count: 0 };
        slot.sum += totalMs;
        slot.count += 1;
        slow[intent] = slot;
      }

      const f = funnels[intent] ?? {
        intent: 0,
        preview: 0,
        confirmation: 0,
        execution: 0,
        receipt: 0,
        completed: 0,
      };
      if (TERMINAL_REQUEST.has(req.status) || req.status === AIRequestStatus.PLANNING) f.intent += 1;
      if (req.status === AIRequestStatus.READY_FOR_CONFIRMATION) f.preview += 1;
      if (req.status === AIRequestStatus.COMPLETED) {
        f.completed += 1;
        f.receipt += 1;
      }
      funnels[intent] = f;
    }

    let confirmed = 0;
    let cancelled = 0;
    let recovered = 0;
    let replayed = 0;
    let dangerousAttempts = 0;
    const violations: DurableHealthReport['dangerousWriteVerification']['violations'] = [];

    const auditsByRun = new Map<string, Set<AIAuditEventType>>();
    for (const ev of auditEvents) {
      if (!ev.actionRunId) continue;
      const set = auditsByRun.get(ev.actionRunId) ?? new Set();
      set.add(ev.type);
      auditsByRun.set(ev.actionRunId, set);

      const payload = asRecord(ev.payload);
      if (ev.type === AIAuditEventType.PLAN_CREATED && typeof payload?.plannerLatencyMs === 'number') {
        plannerLat.push(payload.plannerLatencyMs);
      }
      if (ev.type === AIAuditEventType.ASSISTANT_REQUEST_REPLAYED) replayed += 1;
    }

    for (const run of actionRuns) {
      bump(actionRunOutcomes, run.status);
      const cap = run.intent || 'UNKNOWN';
      const f = funnels[cap] ?? {
        intent: 0,
        preview: 0,
        confirmation: 0,
        execution: 0,
        receipt: 0,
        completed: 0,
      };
      f.intent += 1;
      if (
        run.requiresConfirmation &&
        (run.status === AIActionRunStatus.READY_FOR_CONFIRMATION ||
          run.confirmedAt ||
          run.status === AIActionRunStatus.EXECUTING ||
          run.status === AIActionRunStatus.COMPLETED ||
          run.status === AIActionRunStatus.FAILED ||
          run.status === AIActionRunStatus.CANCELLED)
      ) {
        f.preview += 1;
      }
      if (run.confirmedAt) {
        confirmed += 1;
        f.confirmation += 1;
      }
      if (
        run.status === AIActionRunStatus.EXECUTING ||
        run.status === AIActionRunStatus.COMPLETED ||
        run.status === AIActionRunStatus.FAILED ||
        run.executedAt
      ) {
        f.execution += 1;
      }
      if (run.status === AIActionRunStatus.COMPLETED) {
        f.receipt += 1;
        f.completed += 1;
      }
      funnels[cap] = f;

      if (run.status === AIActionRunStatus.CANCELLED) cancelled += 1;
      if (run.status === AIActionRunStatus.NEEDS_CLARIFICATION) {
        bump(clarifications, 'MISSING_FIELD');
        const age = now.getTime() - run.createdAt.getTime();
        if (age >= ABANDONMENT_OBSERVATION_MS) inferredAbandoned += 1;
      }

      const result = asRecord(run.result);
      if (result?.recovered === true) {
        recovered += 1;
        bump(recoveryCauses, String(result.priorRuntimeStatus ?? 'RECOVERED'));
      }
      if (result?.replayed === true) replayed += 1;

      if (run.executedAt && run.completedAt) {
        execLat.push(Math.max(0, run.completedAt.getTime() - run.executedAt.getTime()));
      }

      if (DANGEROUS_WRITES.has(cap)) {
        dangerousAttempts += 1;
        const types = auditsByRun.get(run.id) ?? new Set();
        const executed =
          types.has(AIAuditEventType.EXECUTION_STARTED) ||
          types.has(AIAuditEventType.EXECUTION_COMPLETED) ||
          run.status === AIActionRunStatus.EXECUTING ||
          run.status === AIActionRunStatus.COMPLETED ||
          Boolean(run.executedAt);
        const confirmedEv = types.has(AIAuditEventType.PLAN_CONFIRMED) || Boolean(run.confirmedAt);
        const previewEv =
          types.has(AIAuditEventType.PLAN_READY_FOR_CONFIRMATION) || run.requiresConfirmation;
        if (executed && !confirmedEv) {
          violations.push({
            actionRunHash: hashId(run.id),
            capability: cap,
            detail: previewEv
              ? 'execution_without_confirmation'
              : 'execution_without_preview_or_confirmation',
          });
        }
      }
    }

    const requestDen = Math.max(requests.length, 1);
    const previewDen = Math.max(previewReady + confirmed, 1);

    return {
      generatedAt: now.toISOString(),
      sourceOfTruth: 'AIRequest+AIActionRun+AIAuditEvent',
      window: options.window,
      windowStart: start.toISOString(),
      windowEnd: now.toISOString(),
      scope: options.tenantId ? 'tenant_filtered' : 'platform_global',
      tenantFilterHash: options.tenantId ? hashId(options.tenantId) : undefined,
      requestCount: requests.length,
      actionRunCount: actionRuns.length,
      auditEventCount: auditEvents.length,
      kpis: {
        successRate: rate(success, requestDen),
        failureRate: rate(failed, requestDen),
        clarificationRate: rate(clarificationReq, requestDen),
        confirmationRate: rate(confirmed, previewDen),
        cancellationRate: rate(cancelled, Math.max(actionRuns.length, 1)),
        recoveryRate: rate(recovered, Math.max(actionRuns.length, 1)),
        replayRate: rate(replayed, requestDen),
        unknownIntentRate: rate(unknownIntent, requestDen),
        inferredAbandonmentRate: rate(inferredAbandoned, Math.max(clarificationsAwaiting, 1)),
        avgProviderLatencyMs: avg(providerLat),
        avgPlannerLatencyMs: avg(plannerLat),
        avgRequestLatencyMs: avg(requestLat),
        avgExecutionLatencyMs: avg(execLat),
      },
      denominators: {
        requests: requests.length,
        requestsWithPreview: previewReady + confirmed,
        actionRuns: actionRuns.length,
        dangerousWriteAttempts: dangerousAttempts,
        clarificationsAwaiting,
      },
      requestOutcomes,
      actionRunOutcomes,
      topFailedIntents: topN(failedIntents, 10).map((x) => ({ intent: x.key, count: x.count })),
      topClarifications: topN(clarifications, 10).map((x) => ({ type: x.key, count: x.count })),
      topCapabilities: topN(capabilities, 10).map((x) => ({ capability: x.key, count: x.count })),
      topRecoveryCauses: topN(recoveryCauses, 10).map((x) => ({ reason: x.key, count: x.count })),
      topSlowQueries: Object.entries(slow)
        .map(([capability, v]) => ({
          capability,
          avgTotalLatencyMs: Math.round((v.sum / v.count) * 100) / 100,
          count: v.count,
        }))
        .sort((a, b) => b.avgTotalLatencyMs - a.avgTotalLatencyMs)
        .slice(0, 10),
      capabilityFunnels: funnels,
      dangerousWriteVerification: {
        capabilities: [...DANGEROUS_WRITES],
        violations,
        ok: violations.length === 0,
      },
      latencyBreakdown: {
        provider: {
          avg: avg(providerLat),
          p95: p95(providerLat),
          count: providerLat.length,
          note: 'From AIRequest.requestPayload.providerMetrics.latencyMs when present',
        },
        planner: {
          avg: avg(plannerLat),
          p95: p95(plannerLat),
          count: plannerLat.length,
          note: 'From PLAN_CREATED audit payload.plannerLatencyMs when present',
        },
        binding: {
          avg: null,
          p95: null,
          count: 0,
          note: 'Not instrumented in V1 — omitted (no fake precision)',
        },
        domain: {
          avg: avg(execLat),
          p95: p95(execLat),
          count: execLat.length,
          note: 'ActionRun executedAt→completedAt when both present',
        },
        total: {
          avg: avg(requestLat),
          p95: p95(requestLat),
          count: requestLat.length,
          note: 'AIRequest receivedAt→completedAt/failedAt',
        },
        sql: {
          avg: null,
          p95: null,
          count: 0,
          note: 'Not instrumented in V1 — omitted',
        },
      },
      retentionNote:
        'Reuses AIAuditEvent / AIRequest / AIActionRun with no dedicated retention job. Future TELEMETRY_RETENTION_POLICY recommended.',
      passive: true,
    };
  }

  /** Map durable audit types to telemetry taxonomy without duplicate appends. */
  static deriveSignal(type: AIAuditEventType): string | null {
    switch (type) {
      case AIAuditEventType.ASSISTANT_REQUEST_REPLAYED:
        return 'ReplayServed';
      case AIAuditEventType.PLAN_NEEDS_CLARIFICATION:
        return 'ClarificationShown';
      case AIAuditEventType.PLAN_READY_FOR_CONFIRMATION:
        return 'PreviewShown';
      case AIAuditEventType.PLAN_CONFIRMED:
        return 'PreviewConfirmed';
      case AIAuditEventType.EXECUTION_STARTED:
        return 'ExecutionStarted';
      case AIAuditEventType.EXECUTION_COMPLETED:
        return 'ExecutionCompleted';
      case AIAuditEventType.EXECUTION_FAILED:
        return 'ExecutionFailed';
      case AIAuditEventType.EXECUTION_CANCELLED:
        return 'PreviewCancelled';
      default:
        return null;
    }
  }
}
