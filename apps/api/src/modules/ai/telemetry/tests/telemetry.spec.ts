import { TelemetryAggregator } from '../telemetry-aggregator.service';
import { TelemetryEmitter } from '../telemetry-emitter.service';
import { MemoryTelemetryStore } from '../telemetry-store';
import { assertPrivacySafe, hashId, toTelemetryEvent } from '../telemetry-privacy';
import { TelemetryEmitInput } from '../telemetry.types';
import { runAssistantEvaluation } from '../evaluation/evaluate-runner';

function makeEmitter() {
  const store = new MemoryTelemetryStore();
  return new TelemetryEmitter(store);
}

describe('Assistant telemetry (Commit 16)', () => {
  describe('emitter', () => {
    it('appends immutable events and never throws on bad input', () => {
      const emitter = makeEmitter();
      emitter.emit({ event: 'ConversationStarted', tenantId: 't1', capability: 'GET_LIQUIDITY' });
      emitter.emit({ event: 'ConversationFinished', tenantId: 't1', outcome: 'SUCCESS' });
      expect(emitter.list()).toHaveLength(2);
      expect(() => emitter.emit({ event: 'ExecutionFailed' } as TelemetryEmitInput)).not.toThrow();
    });

    it('drops events that look like secrets', () => {
      const emitter = makeEmitter();
      emitter.emit({
        event: 'ProviderCompleted',
        meta: { apiKey: 'sk-ant-secret' },
      });
      // Forbidden meta keys are stripped before privacy assert; raw secret-like blob still checked
      emitter.emit({
        event: 'ProviderCompleted',
        model: 'sk-ant-abcdefghijklmnopqrstuvwxyz',
      });
      const events = emitter.list();
      expect(events.every((e) => !JSON.stringify(e).includes('sk-ant-abcdefghijklmnopqrstuvwxyz'))).toBe(true);
    });
  });

  describe('privacy', () => {
    it('hashes identifiers and never stores raw tenant ids', () => {
      const event = toTelemetryEvent({
        event: 'PlannerCompleted',
        tenantId: 'tenant-raw-id',
        conversationId: 'conv-1',
        requestId: 'req-1',
        actionRunId: 'run-1',
      });
      expect(event.tenantHash).toBe(hashId('tenant-raw-id'));
      expect(JSON.stringify(event)).not.toContain('tenant-raw-id');
      expect(assertPrivacySafe(event)).toEqual([]);
    });

    it('flags prompt-like keys in meta', () => {
      const event = toTelemetryEvent({
        event: 'ProviderCompleted',
        meta: { systemPrompt: 'you are' },
      });
      // sanitizeMeta strips forbidden keys
      expect(event.meta?.systemPrompt).toBeUndefined();
    });
  });

  describe('latency aggregation', () => {
    it('aggregates provider/planner/domain/total independently', () => {
      const emitter = makeEmitter();
      const aggregator = new TelemetryAggregator(emitter);
      emitter.emit({ event: 'ProviderCompleted', providerLatencyMs: 100, totalLatencyMs: 250 });
      emitter.emit({ event: 'PlannerCompleted', plannerLatencyMs: 40, totalLatencyMs: 250 });
      emitter.emit({ event: 'ExecutionCompleted', domainLatencyMs: 80, totalLatencyMs: 250, capability: 'GET_LIQUIDITY' });
      const report = aggregator.aggregate();
      expect(report.latencyBreakdown.provider.avg).toBe(100);
      expect(report.latencyBreakdown.planner.avg).toBe(40);
      expect(report.latencyBreakdown.domain.avg).toBe(80);
      expect(report.latencyBreakdown.total.avg).toBe(250);
      expect(report.kpis.avgProviderLatencyMs).toBe(100);
      expect(report.kpis.avgPlannerLatencyMs).toBe(40);
    });
  });

  describe('clarification aggregation', () => {
    it('counts clarification types and rate', () => {
      const emitter = makeEmitter();
      const aggregator = new TelemetryAggregator(emitter);
      emitter.emit({ event: 'ConversationStarted', tenantId: 't1' });
      emitter.emit({
        event: 'ClarificationShown',
        clarificationType: 'MISSING_AMOUNT',
        clarificationReason: 'amount',
      });
      emitter.emit({
        event: 'ClarificationShown',
        clarificationType: 'ENTITY_AMBIGUITY',
        clarificationReason: 'account',
      });
      const report = aggregator.aggregate();
      expect(report.kpis.clarificationRate).toBeGreaterThan(0);
      expect(report.topClarifications[0]?.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('recovery and replay aggregation', () => {
    it('tracks recovery causes and replay rate', () => {
      const emitter = makeEmitter();
      const aggregator = new TelemetryAggregator(emitter);
      emitter.emit({
        event: 'ExecutionRecovered',
        recovered: true,
        recoveryReason: 'EXECUTING',
        outcome: 'RECOVERED',
        capability: 'REGISTER_SALE',
      });
      emitter.emit({
        event: 'ReplayServed',
        replayed: true,
        outcome: 'REPLAYED',
        capability: 'REGISTER_SALE',
      });
      emitter.emit({ event: 'ConversationFinished', outcome: 'RECOVERED' });
      emitter.emit({ event: 'ConversationFinished', outcome: 'REPLAYED' });
      const report = aggregator.aggregate();
      expect(report.kpis.recoveryRate).toBeGreaterThan(0);
      expect(report.kpis.replayRate).toBeGreaterThan(0);
      expect(report.topRecoveryCauses.some((c) => c.reason === 'EXECUTING')).toBe(true);
    });
  });

  describe('capability funnels', () => {
    it('builds intent→preview→confirmation→execution→receipt→completed for writes', () => {
      const emitter = makeEmitter();
      const aggregator = new TelemetryAggregator(emitter);
      const cap = 'REGISTER_SALE';
      const actionRunId = 'run-funnel-1';
      emitter.emit({ event: 'PlannerCompleted', capability: cap, funnelStage: 'intent', actionRunId });
      emitter.emit({ event: 'PreviewShown', capability: cap, funnelStage: 'preview', actionRunId, shown: true });
      emitter.emit({ event: 'PreviewConfirmed', capability: cap, funnelStage: 'confirmation', actionRunId, confirmed: true });
      emitter.emit({ event: 'ExecutionStarted', capability: cap, funnelStage: 'execution', actionRunId });
      emitter.emit({ event: 'ExecutionCompleted', capability: cap, funnelStage: 'receipt', actionRunId, completed: true });
      emitter.emit({
        event: 'ConversationFinished',
        capability: cap,
        funnelStage: 'completed',
        actionRunId,
        outcome: 'SUCCESS',
      });
      const funnel = aggregator.aggregate().capabilityFunnels[cap]!;
      expect(funnel.intent).toBeGreaterThan(0);
      expect(funnel.preview).toBeGreaterThan(0);
      expect(funnel.confirmation).toBeGreaterThan(0);
      expect(funnel.execution).toBeGreaterThan(0);
      expect(funnel.receipt).toBeGreaterThan(0);
      expect(funnel.completed).toBeGreaterThan(0);
    });
  });

  describe('dangerous write verification', () => {
    it('flags execution without confirmation (reporting only)', () => {
      const emitter = makeEmitter();
      const aggregator = new TelemetryAggregator(emitter);
      emitter.emit({
        event: 'ExecutionStarted',
        capability: 'REGISTER_SALE',
        actionRunId: 'run-bad',
        funnelStage: 'execution',
      });
      const report = aggregator.aggregate();
      expect(report.dangerousWriteVerification.ok).toBe(false);
      expect(report.dangerousWriteVerification.violations[0]?.detail).toContain('confirmation');
    });

    it('passes when preview→confirm→execute is observed', () => {
      const emitter = makeEmitter();
      const aggregator = new TelemetryAggregator(emitter);
      const actionRunId = 'run-ok';
      emitter.emit({ event: 'PreviewShown', capability: 'REGISTER_EXPENSE', actionRunId, shown: true });
      emitter.emit({ event: 'PreviewConfirmed', capability: 'REGISTER_EXPENSE', actionRunId, confirmed: true });
      emitter.emit({ event: 'ExecutionStarted', capability: 'REGISTER_EXPENSE', actionRunId });
      emitter.emit({ event: 'ExecutionCompleted', capability: 'REGISTER_EXPENSE', actionRunId, completed: true });
      expect(aggregator.aggregate().dangerousWriteVerification.ok).toBe(true);
    });
  });

  describe('dashboard aggregation', () => {
    it('exposes Assistant Health KPIs', () => {
      const emitter = makeEmitter();
      const aggregator = new TelemetryAggregator(emitter);
      emitter.emit({ event: 'ConversationStarted' });
      emitter.emit({ event: 'ConversationFinished', outcome: 'SUCCESS' });
      emitter.emit({ event: 'ConversationFinished', outcome: 'FAILED', failureType: 'UNKNOWN_INTENT' });
      emitter.emit({ event: 'PreviewShown', capability: 'REGISTER_SALE', shown: true });
      emitter.emit({ event: 'PreviewConfirmed', capability: 'REGISTER_SALE', confirmed: true });
      const report = aggregator.aggregate();
      expect(report.kpis).toEqual(
        expect.objectContaining({
          successRate: expect.any(Number),
          failureRate: expect.any(Number),
          clarificationRate: expect.any(Number),
          confirmationRate: expect.any(Number),
          cancellationRate: expect.any(Number),
          recoveryRate: expect.any(Number),
          replayRate: expect.any(Number),
          unknownIntentRate: expect.any(Number),
        }),
      );
    });
  });

  describe('evaluation runner', () => {
    it('runs fake provider eval and reports accuracy metrics', async () => {
      const report = await runAssistantEvaluation({ provider: 'fake', outDir: '/tmp/wristos-eval-test' });
      expect(report.total).toBeGreaterThan(0);
      expect(report.accuracy).toBeGreaterThanOrEqual(0);
      expect(report.accuracy).toBeLessThanOrEqual(1);
      expect(report.clarificationRate).toBeGreaterThanOrEqual(0);
      expect(report.unknownRate).toBeGreaterThanOrEqual(0);
      expect(report.provider).toBe('fake');
    }, 60_000);

    it('computes prompt regression deltas against a baseline', async () => {
      const report = await runAssistantEvaluation({
        provider: 'fake',
        outDir: '/tmp/wristos-eval-test-2',
        baseline: {
          accuracy: 0.5,
          avgLatencyMs: 1,
          clarificationRate: 0.1,
          unknownRate: 0.1,
        },
      });
      expect(report.regressions?.accuracyDelta).toEqual(expect.any(Number));
      expect(report.regressions?.clarificationDelta).toEqual(expect.any(Number));
      expect(report.regressions?.unknownDelta).toEqual(expect.any(Number));
    }, 60_000);
  });

  describe('architecture: passive telemetry', () => {
    it('production planner/bindings modules do not import telemetry reads', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path') as typeof import('path');
      const aiRoot = path.join(__dirname, '../..');
      const forbiddenConsumers = [
        'planner/planner.service.ts',
        'bindings/write/register-sale.binding.ts',
        'bindings/write/register-expense.binding.ts',
        'bindings/write/register-receivable-payment.binding.ts',
        'intent-adapter/providers/claude-intent-provider.ts',
        'intent-adapter/providers/fake-intent-provider.ts',
      ];
      for (const rel of forbiddenConsumers) {
        const src = fs.readFileSync(path.join(aiRoot, rel), 'utf8');
        expect(src).not.toMatch(/from ['"].*telemetry/);
        expect(src).not.toMatch(/TelemetryAggregator|TelemetryEmitter\.list|emitter\.list/);
      }
    });

    it('telem helper tolerates missing emitter (behavior unchanged)', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { telem } = require('../telemetry-hooks') as typeof import('../telemetry-hooks');
      expect(() => telem(undefined, { event: 'ConversationStarted' })).not.toThrow();
      expect(() => telem(null, { event: 'ConversationFinished', outcome: 'SUCCESS' })).not.toThrow();
    });
  });
});
