/**
 * Evaluation runner for Assistant intent dataset (Commit 16).
 * Passive — does not mutate production Assistant behavior.
 *
 * Usage:
 *   pnpm assistant:evaluate
 *   ASSISTANT_EVAL_PROVIDER=claude pnpm assistant:evaluate
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { IntentAdapterService } from '../../intent-adapter/intent-adapter.service';
import { FakeIntentProvider } from '../../intent-adapter/providers/fake-intent-provider';
import { ClaudeIntentProvider } from '../../intent-adapter/providers/claude-intent-provider';
import { decideConfidencePolicy } from '../../intent-adapter/safety';
import { EVAL_DATASET } from '../../intent-adapter/eval/dataset';
import { MemoryTelemetryStore } from '../telemetry-store';
import { TelemetryEmitter } from '../telemetry-emitter.service';
import { TelemetryAggregator, mapFailureTaxonomy } from '../telemetry-aggregator.service';

export type EvalReport = {
  generatedAt: string;
  provider: string;
  model: string | null;
  total: number;
  accuracy: number;
  clarificationRate: number;
  unknownRate: number;
  providerFailureRate: number;
  avgLatencyMs: number | null;
  mismatches: Array<{ text: string; expected: string; actual: string; category: string }>;
  regressions?: {
    baselineAccuracy?: number;
    accuracyDelta?: number;
    latencyDelta?: number;
    clarificationDelta?: number;
    unknownDelta?: number;
  };
  telemetryHealth: ReturnType<TelemetryAggregator['aggregate']>;
};

export async function runAssistantEvaluation(options?: {
  provider?: 'fake' | 'claude';
  baseline?: Partial<EvalReport> | null;
  outDir?: string;
}): Promise<EvalReport> {
  const providerName = options?.provider ?? (process.env.ASSISTANT_EVAL_PROVIDER as 'fake' | 'claude') ?? 'fake';
  const store = new MemoryTelemetryStore();
  const emitter = new TelemetryEmitter(store);
  const aggregator = new TelemetryAggregator(emitter);

  let adapter: IntentAdapterService;
  let model: string | null = null;
  if (providerName === 'claude') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    model = process.env.INTENT_ADAPTER_MODEL ?? process.env.ANTHROPIC_MODEL ?? null;
    if (!apiKey || !model) {
      throw new Error('Claude eval requires ANTHROPIC_API_KEY and INTENT_ADAPTER_MODEL');
    }
    adapter = new IntentAdapterService(new ClaudeIntentProvider(apiKey, model), emitter);
  } else {
    adapter = new IntentAdapterService(new FakeIntentProvider(), emitter);
  }

  let matched = 0;
  let clarify = 0;
  let unknown = 0;
  let providerFail = 0;
  const latencies: number[] = [];
  const mismatches: EvalReport['mismatches'] = [];

  for (const evalCase of EVAL_DATASET) {
    const started = Date.now();
    emitter.emit({
      event: 'ProviderStarted',
      tenantId: 'eval',
      provider: providerName,
      model: model ?? 'fake-heuristic-v1',
      capability: evalCase.expectedIntent,
    });

    const outcome = await adapter.interpret({
      userText: evalCase.text,
      locale: 'es-MX',
      timezone: 'UTC',
      allowedIntents: [],
      currentDate: '2026-07-15',
      requestTraceId: 'assistant-evaluate',
    });
    const latencyMs = Date.now() - started;
    latencies.push(latencyMs);

    if (outcome.kind !== 'CANDIDATE') {
      providerFail += 1;
      emitter.emit({
        event: 'ProviderCompleted',
        tenantId: 'eval',
        provider: outcome.provider,
        model: outcome.model,
        providerLatencyMs: outcome.latencyMs,
        schemaValidationFailure: outcome.kind === 'INVALID_OUTPUT',
        timeout: outcome.kind === 'PROVIDER_FAILURE' && outcome.failureType === 'TIMEOUT',
        failureType: mapFailureTaxonomy(outcome.kind === 'PROVIDER_FAILURE' ? outcome.failureType : 'SCHEMA_INVALID'),
        totalLatencyMs: latencyMs,
      });
      mismatches.push({
        text: evalCase.text,
        expected: evalCase.expectedIntent,
        actual: outcome.kind,
        category: evalCase.category,
      });
      continue;
    }

    const { candidate } = outcome;
    const policy = decideConfidencePolicy(candidate);
    const intentMatch = candidate.intent === evalCase.expectedIntent;
    if (intentMatch) matched += 1;
    else {
      mismatches.push({
        text: evalCase.text,
        expected: evalCase.expectedIntent,
        actual: candidate.intent,
        category: evalCase.category,
      });
    }
    if (candidate.intent === 'UNKNOWN') unknown += 1;
    if (policy.action !== 'PROCEED' || (candidate.missingEntities?.length ?? 0) > 0) clarify += 1;

    emitter.emit({
      event: 'ProviderCompleted',
      tenantId: 'eval',
      provider: outcome.provider,
      model: outcome.model,
      providerLatencyMs: outcome.latencyMs,
      providerIntent: candidate.intent,
      normalizedIntent: candidate.intent,
      tokenInput: outcome.tokenUsage?.inputTokens,
      tokenOutput: outcome.tokenUsage?.outputTokens,
      totalLatencyMs: latencyMs,
      funnelStage: 'intent',
      capability: candidate.intent,
    });
    if (candidate.intent === 'UNKNOWN' || policy.action !== 'PROCEED') {
      emitter.emit({
        event: 'ClarificationShown',
        tenantId: 'eval',
        clarificationType: candidate.intent === 'UNKNOWN' ? 'OTHER' : 'MISSING_FIELD',
        clarificationReason: policy.action,
        providerIntent: candidate.intent,
      });
    }
  }

  const total = EVAL_DATASET.length;
  const avgLatencyMs =
    latencies.length === 0 ? null : Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100;

  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    provider: providerName,
    model,
    total,
    accuracy: Math.round((matched / total) * 10000) / 10000,
    clarificationRate: Math.round((clarify / total) * 10000) / 10000,
    unknownRate: Math.round((unknown / total) * 10000) / 10000,
    providerFailureRate: Math.round((providerFail / total) * 10000) / 10000,
    avgLatencyMs,
    mismatches,
    telemetryHealth: aggregator.aggregate(),
  };

  if (options?.baseline) {
    report.regressions = {
      baselineAccuracy: options.baseline.accuracy,
      accuracyDelta:
        options.baseline.accuracy != null ? report.accuracy - options.baseline.accuracy : undefined,
      latencyDelta:
        options.baseline.avgLatencyMs != null && report.avgLatencyMs != null
          ? report.avgLatencyMs - options.baseline.avgLatencyMs
          : undefined,
      clarificationDelta:
        options.baseline.clarificationRate != null
          ? report.clarificationRate - options.baseline.clarificationRate
          : undefined,
      unknownDelta:
        options.baseline.unknownRate != null ? report.unknownRate - options.baseline.unknownRate : undefined,
    };
  }

  const outDir = options?.outDir ?? join(process.cwd(), '.tmp');
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'assistant-eval-report.json'), JSON.stringify(report, null, 2));
  } catch {
    /* ignore */
  }

  return report;
}
