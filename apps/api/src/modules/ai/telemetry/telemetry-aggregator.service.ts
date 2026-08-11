import { Injectable, Optional } from '@nestjs/common';
import { DurableTelemetrySource, DurableHealthReport, HealthWindow } from './durable-telemetry.source';
import { TelemetryEmitter } from './telemetry-emitter.service';
import {
  ConversationOutcome,
  TelemetryEvent,
  TelemetryEventName,
} from './telemetry.types';
import { mapClarificationType, mapFailureTaxonomy } from './telemetry-mappers';

export { mapClarificationType, mapFailureTaxonomy };
export type { DurableHealthReport, HealthWindow };

const DANGEROUS_WRITES = new Set([
  'REGISTER_SALE',
  'REGISTER_RECEIVABLE_PAYMENT',
  'REGISTER_PAYABLE_PAYMENT',
  'REGISTER_TREASURY_TRANSFER',
  'REGISTER_CAPITAL_CONTRIBUTION',
  'REGISTER_CAPITAL_DISTRIBUTION',
  'REGISTER_EXPENSE',
  'REVERSE_EXPENSE',
  'REGISTER_PURCHASE',
  'CREATE_CLIENT',
  'UPDATE_CLIENT',
  'CREATE_RECEIVABLE',
  'CREATE_PAYABLE',
]);

export type AssistantHealthReport = {
  generatedAt: string;
  eventCount: number;
  kpis: {
    successRate: number;
    failureRate: number;
    clarificationRate: number;
    confirmationRate: number;
    cancellationRate: number;
    recoveryRate: number;
    replayRate: number;
    unknownIntentRate: number;
    avgProviderLatencyMs: number | null;
    avgPlannerLatencyMs: number | null;
    avgExecutionLatencyMs: number | null;
  };
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
    provider: { avg: number | null; p95: number | null; count: number };
    planner: { avg: number | null; p95: number | null; count: number };
    binding: { avg: number | null; p95: number | null; count: number };
    domain: { avg: number | null; p95: number | null; count: number };
    total: { avg: number | null; p95: number | null; count: number };
  };
  outcomes: Record<ConversationOutcome, number>;
  failures: Record<string, number>;
};

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function p95(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx]!;
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

@Injectable()
export class TelemetryAggregator {
  constructor(
    private readonly emitter: TelemetryEmitter,
    @Optional() private readonly durable?: DurableTelemetrySource,
  ) {}

  /**
   * Production Assistant Health — durable shared AI tables.
   * Survives restart/deploy/multi-replica.
   */
  aggregateDurable(options: {
    window: HealthWindow;
    tenantId?: string;
    now?: Date;
  }): Promise<DurableHealthReport> {
    if (!this.durable) {
      throw new Error('DurableTelemetrySource is not configured');
    }
    return this.durable.aggregate(options);
  }

  /**
   * Ephemeral event aggregation for unit tests / offline eval only.
   * NOT the production source of truth.
   */
  aggregate(events?: TelemetryEvent[]): AssistantHealthReport {
    const rows = events ?? this.emitter.list();
    const outcomes: Record<ConversationOutcome, number> = {
      SUCCESS: 0,
      FAILED: 0,
      ABANDONED: 0,
      CANCELLED: 0,
      RECOVERED: 0,
      REPLAYED: 0,
    };
    const failures: Record<string, number> = {};
    const failedIntents: Record<string, number> = {};
    const clarifications: Record<string, number> = {};
    const capabilities: Record<string, number> = {};
    const recoveryCauses: Record<string, number> = {};
    const slow: Record<string, { sum: number; count: number }> = {};
    const funnels: Record<
      string,
      { intent: number; preview: number; confirmation: number; execution: number; receipt: number; completed: number }
    > = {};

    let conversations = 0;
    let clarificationsShown = 0;
    let previewsShown = 0;
    let previewsConfirmed = 0;
    let cancelled = 0;
    let recovered = 0;
    let replayed = 0;
    let unknownIntent = 0;

    const providerLat: number[] = [];
    const plannerLat: number[] = [];
    const bindingLat: number[] = [];
    const domainLat: number[] = [];
    const totalLat: number[] = [];
    const execLat: number[] = [];

    // Dangerous write verification: group by actionRunHash
    const byRun = new Map<string, TelemetryEvent[]>();

    for (const e of rows) {
      if (e.outcome) outcomes[e.outcome] += 1;
      if (e.event === 'ConversationStarted' || e.event === 'ConversationFinished') {
        if (e.event === 'ConversationStarted') conversations += 1;
      }
      if (e.event === 'ClarificationShown') {
        clarificationsShown += 1;
        bump(clarifications, e.clarificationType ?? e.clarificationReason ?? 'OTHER');
      }
      if (e.event === 'PreviewShown') {
        previewsShown += 1;
        if (e.capability) bump(capabilities, e.capability);
      }
      if (e.event === 'PreviewConfirmed') previewsConfirmed += 1;
      if (e.event === 'PreviewCancelled') cancelled += 1;
      if (e.event === 'ExecutionRecovered' || e.recovered) {
        recovered += 1;
        bump(recoveryCauses, e.recoveryReason ?? 'unknown');
      }
      if (e.event === 'ReplayServed' || e.replayed) replayed += 1;
      if (e.failureType === 'UNKNOWN_INTENT' || e.providerIntent === 'UNKNOWN' || e.normalizedIntent === 'UNKNOWN') {
        unknownIntent += 1;
      }
      if (e.event === 'ExecutionFailed' || e.failed) {
        bump(failures, e.failureType ?? 'OTHER');
        bump(failedIntents, e.plannerIntent ?? e.normalizedIntent ?? e.capability ?? 'UNKNOWN');
      }

      if (typeof e.providerLatencyMs === 'number') providerLat.push(e.providerLatencyMs);
      if (typeof e.plannerLatencyMs === 'number') plannerLat.push(e.plannerLatencyMs);
      if (typeof e.bindingLatencyMs === 'number') bindingLat.push(e.bindingLatencyMs);
      if (typeof e.domainLatencyMs === 'number') domainLat.push(e.domainLatencyMs);
      if (typeof e.totalLatencyMs === 'number') {
        totalLat.push(e.totalLatencyMs);
        const cap = e.capability ?? e.plannerIntent ?? 'UNKNOWN';
        const slot = slow[cap] ?? { sum: 0, count: 0 };
        slot.sum += e.totalLatencyMs;
        slot.count += 1;
        slow[cap] = slot;
      }
      if (e.event === 'ExecutionCompleted' && typeof e.totalLatencyMs === 'number') {
        execLat.push(e.totalLatencyMs);
      }

      const cap = e.capability ?? e.plannerIntent;
      if (cap) {
        const f = funnels[cap] ?? {
          intent: 0,
          preview: 0,
          confirmation: 0,
          execution: 0,
          receipt: 0,
          completed: 0,
        };
        if (e.funnelStage === 'intent' || e.event === 'PlannerCompleted') f.intent += 1;
        if (e.funnelStage === 'preview' || e.event === 'PreviewShown') f.preview += 1;
        if (e.funnelStage === 'confirmation' || e.event === 'PreviewConfirmed') f.confirmation += 1;
        if (e.funnelStage === 'execution' || e.event === 'ExecutionStarted') f.execution += 1;
        if (e.funnelStage === 'receipt' || e.event === 'ExecutionCompleted') f.receipt += 1;
        if (e.funnelStage === 'completed' || (e.event === 'ConversationFinished' && e.outcome === 'SUCCESS')) {
          f.completed += 1;
        }
        funnels[cap] = f;
      }

      if (e.actionRunHash && e.capability && DANGEROUS_WRITES.has(e.capability)) {
        const list = byRun.get(e.actionRunHash) ?? [];
        list.push(e);
        byRun.set(e.actionRunHash, list);
      }
    }

    const finished =
      outcomes.SUCCESS +
      outcomes.FAILED +
      outcomes.ABANDONED +
      outcomes.CANCELLED +
      outcomes.RECOVERED +
      outcomes.REPLAYED;
    const den = Math.max(finished, conversations, 1);

    const violations: AssistantHealthReport['dangerousWriteVerification']['violations'] = [];
    for (const [runHash, list] of byRun) {
      const names = new Set(list.map((e) => e.event));
      const capability = list.find((e) => e.capability)?.capability;
      if (names.has('ExecutionCompleted') || names.has('ExecutionStarted')) {
        if (!names.has('PreviewConfirmed') && !names.has('PreviewShown')) {
          violations.push({
            actionRunHash: runHash,
            capability,
            detail: 'execution_without_preview_or_confirmation',
          });
        } else if (!names.has('PreviewConfirmed')) {
          violations.push({
            actionRunHash: runHash,
            capability,
            detail: 'execution_without_confirmation',
          });
        }
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      eventCount: rows.length,
      kpis: {
        successRate: rate(outcomes.SUCCESS, den),
        failureRate: rate(outcomes.FAILED, den),
        clarificationRate: rate(clarificationsShown, Math.max(conversations, den)),
        confirmationRate: rate(previewsConfirmed, Math.max(previewsShown, 1)),
        cancellationRate: rate(cancelled, Math.max(previewsShown, 1)),
        recoveryRate: rate(recovered, den),
        replayRate: rate(replayed, den),
        unknownIntentRate: rate(unknownIntent, den),
        avgProviderLatencyMs: avg(providerLat),
        avgPlannerLatencyMs: avg(plannerLat),
        avgExecutionLatencyMs: avg(execLat),
      },
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
        provider: { avg: avg(providerLat), p95: p95(providerLat), count: providerLat.length },
        planner: { avg: avg(plannerLat), p95: p95(plannerLat), count: plannerLat.length },
        binding: { avg: avg(bindingLat), p95: p95(bindingLat), count: bindingLat.length },
        domain: { avg: avg(domainLat), p95: p95(domainLat), count: domainLat.length },
        total: { avg: avg(totalLat), p95: p95(totalLat), count: totalLat.length },
      },
      outcomes,
      failures,
    };
  }
}

export type { TelemetryEventName };
