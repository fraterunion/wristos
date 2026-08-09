import { AIActionRunStatus, AIAuditEventType, AIRequestStatus } from '@prisma/client';
import {
  ABANDONMENT_OBSERVATION_MS,
  DurableTelemetrySource,
} from '../durable-telemetry.source';
import { TelemetryEmitter } from '../telemetry-emitter.service';
import { MemoryTelemetryStore } from '../telemetry-store';
import { assertPrivacySafe, toTelemetryEvent } from '../telemetry-privacy';
import { PlatformAdminGuard } from '../../../platform-migrations/guards/platform-admin.guard';
import { TelemetryController } from '../telemetry.controller';
import { TelemetryAggregator } from '../telemetry-aggregator.service';

function mockPrisma(data: {
  requests?: unknown[];
  actionRuns?: unknown[];
  auditEvents?: unknown[];
}) {
  return {
    aIRequest: {
      findMany: jest.fn(async () => data.requests ?? []),
    },
    aIActionRun: {
      findMany: jest.fn(async () => data.actionRuns ?? []),
    },
    aIAuditEvent: {
      findMany: jest.fn(async () => data.auditEvents ?? []),
    },
  };
}

describe('Durable telemetry source of truth (Commit 16 gate)', () => {
  it('derives preview/confirm/execution from durable audit types without duplicate taxonomy storage', () => {
    expect(DurableTelemetrySource.deriveSignal(AIAuditEventType.PLAN_READY_FOR_CONFIRMATION)).toBe(
      'PreviewShown',
    );
    expect(DurableTelemetrySource.deriveSignal(AIAuditEventType.PLAN_CONFIRMED)).toBe(
      'PreviewConfirmed',
    );
    expect(DurableTelemetrySource.deriveSignal(AIAuditEventType.EXECUTION_STARTED)).toBe(
      'ExecutionStarted',
    );
    expect(DurableTelemetrySource.deriveSignal(AIAuditEventType.ASSISTANT_REQUEST_REPLAYED)).toBe(
      'ReplayServed',
    );
    expect(DurableTelemetrySource.deriveSignal(AIAuditEventType.EXECUTION_CANCELLED)).toBe(
      'PreviewCancelled',
    );
  });

  it('aggregates request + action-run funnels from durable rows (not process memory)', async () => {
    const now = new Date('2026-08-08T12:00:00.000Z');
    const prisma = mockPrisma({
      requests: [
        {
          id: 'r1',
          tenantId: 't1',
          status: AIRequestStatus.COMPLETED,
          requestPayload: {
            intent: 'GET_LIQUIDITY',
            providerMetrics: { provider: 'fake', model: 'm', latencyMs: 42, tokenInput: null, tokenOutput: null },
          },
          responsePayload: { responseType: 'METRIC_CARD' },
          errorType: null,
          receivedAt: new Date('2026-08-08T11:00:00.000Z'),
          completedAt: new Date('2026-08-08T11:00:01.000Z'),
          failedAt: null,
        },
        {
          id: 'r2',
          tenantId: 't1',
          status: AIRequestStatus.NEEDS_CLARIFICATION,
          requestPayload: { intent: 'REGISTER_SALE' },
          responsePayload: { responseType: 'MISSING_FIELDS_CARD' },
          errorType: null,
          receivedAt: new Date('2026-08-08T10:00:00.000Z'),
          completedAt: new Date('2026-08-08T10:00:01.000Z'),
          failedAt: null,
        },
      ],
      actionRuns: [
        {
          id: 'a1',
          intent: 'REGISTER_SALE',
          status: AIActionRunStatus.COMPLETED,
          confirmedAt: new Date('2026-08-08T10:05:00.000Z'),
          executedAt: new Date('2026-08-08T10:05:01.000Z'),
          completedAt: new Date('2026-08-08T10:05:02.000Z'),
          createdAt: new Date('2026-08-08T10:00:00.000Z'),
          result: { recovered: false, replayed: false },
          requiresConfirmation: true,
        },
      ],
      auditEvents: [
        {
          type: AIAuditEventType.PLAN_CREATED,
          actionRunId: 'a1',
          payload: { plannerLatencyMs: 12 },
        },
        {
          type: AIAuditEventType.PLAN_READY_FOR_CONFIRMATION,
          actionRunId: 'a1',
          payload: {},
        },
        {
          type: AIAuditEventType.PLAN_CONFIRMED,
          actionRunId: 'a1',
          payload: {},
        },
        {
          type: AIAuditEventType.EXECUTION_STARTED,
          actionRunId: 'a1',
          payload: {},
        },
        {
          type: AIAuditEventType.EXECUTION_COMPLETED,
          actionRunId: 'a1',
          payload: {},
        },
      ],
    });

    const source = new DurableTelemetrySource(prisma as never);
    const report = await source.aggregate({ window: '7d', now });

    expect(report.sourceOfTruth).toBe('AIRequest+AIActionRun+AIAuditEvent');
    expect(report.requestCount).toBe(2);
    expect(report.kpis.avgProviderLatencyMs).toBe(42);
    expect(report.kpis.avgPlannerLatencyMs).toBe(12);
    expect(report.latencyBreakdown.sql.count).toBe(0);
    expect(report.latencyBreakdown.binding.count).toBe(0);
    expect(report.dangerousWriteVerification.ok).toBe(true);
    expect(report.capabilityFunnels.REGISTER_SALE?.confirmation).toBeGreaterThan(0);
    expect(report.kpis.clarificationRate).toBeGreaterThan(0);
  });

  it('flags dangerous write execution without confirmation (report only)', async () => {
    const prisma = mockPrisma({
      requests: [],
      actionRuns: [
        {
          id: 'bad',
          intent: 'REGISTER_EXPENSE',
          status: AIActionRunStatus.COMPLETED,
          confirmedAt: null,
          executedAt: new Date(),
          completedAt: new Date(),
          createdAt: new Date(),
          result: {},
          requiresConfirmation: true,
        },
      ],
      auditEvents: [
        { type: AIAuditEventType.EXECUTION_STARTED, actionRunId: 'bad', payload: {} },
        { type: AIAuditEventType.EXECUTION_COMPLETED, actionRunId: 'bad', payload: {} },
      ],
    });
    const report = await new DurableTelemetrySource(prisma as never).aggregate({ window: '30d' });
    expect(report.dangerousWriteVerification.ok).toBe(false);
    expect(report.dangerousWriteVerification.violations[0]?.detail).toContain('confirmation');
  });

  it('infers abandonment only after observation window; explicit cancel is separate', async () => {
    const now = new Date('2026-08-08T12:00:00.000Z');
    const old = new Date(now.getTime() - ABANDONMENT_OBSERVATION_MS - 1000);
    const prisma = mockPrisma({
      requests: [
        {
          id: 'awaiting',
          tenantId: 't1',
          status: AIRequestStatus.NEEDS_CLARIFICATION,
          requestPayload: { intent: 'REGISTER_SALE' },
          responsePayload: { responseType: 'MISSING_FIELDS_CARD' },
          errorType: null,
          receivedAt: old,
          completedAt: old,
          failedAt: null,
        },
      ],
      actionRuns: [
        {
          id: 'cancelled',
          intent: 'REGISTER_SALE',
          status: AIActionRunStatus.CANCELLED,
          confirmedAt: null,
          executedAt: null,
          completedAt: null,
          createdAt: now,
          result: {},
          requiresConfirmation: true,
        },
      ],
      auditEvents: [],
    });
    const report = await new DurableTelemetrySource(prisma as never).aggregate({ window: '30d', now });
    expect(report.kpis.inferredAbandonmentRate).toBeGreaterThan(0);
    expect(report.kpis.cancellationRate).toBeGreaterThan(0);
    expect(report.actionRunOutcomes.CANCELLED).toBe(1);
  });

  it('treats missing token usage as null/unknown — never forces 0', async () => {
    const prisma = mockPrisma({
      requests: [
        {
          id: 'r1',
          tenantId: 't1',
          status: AIRequestStatus.COMPLETED,
          requestPayload: {
            intent: 'GET_LIQUIDITY',
            providerMetrics: { provider: 'claude', model: 'x', latencyMs: 10, tokenInput: null, tokenOutput: null },
          },
          responsePayload: { responseType: 'METRIC_CARD' },
          errorType: null,
          receivedAt: new Date(),
          completedAt: new Date(),
          failedAt: null,
        },
      ],
      actionRuns: [],
      auditEvents: [],
    });
    const report = await new DurableTelemetrySource(prisma as never).aggregate({ window: 'today' });
    expect(report.kpis.avgProviderLatencyMs).toBe(10);
    // No fabricated token averages — tokens are not KPI'd as 0 when unknown.
    expect(report.requestCount).toBe(1);
  });

  it('does not force conversation-level terminal outcomes', async () => {
    const prisma = mockPrisma({
      requests: [
        {
          id: 'r1',
          tenantId: 't1',
          status: AIRequestStatus.READY_FOR_CONFIRMATION,
          requestPayload: { intent: 'REGISTER_SALE' },
          responsePayload: { responseType: 'ACTION_PREVIEW_CARD' },
          errorType: null,
          receivedAt: new Date(),
          completedAt: new Date(),
          failedAt: null,
        },
      ],
      actionRuns: [],
      auditEvents: [],
    });
    const report = await new DurableTelemetrySource(prisma as never).aggregate({ window: '7d' });
    expect(report.requestOutcomes.READY_FOR_CONFIRMATION).toBe(1);
    expect((report as { conversationOutcomes?: unknown }).conversationOutcomes).toBeUndefined();
  });
});

describe('Privacy rejection operational evidence', () => {
  it('increments rejection counter and never logs raw rejected payload', () => {
    const store = new MemoryTelemetryStore();
    const emitter = new TelemetryEmitter(store);
    const warns: string[] = [];
    const original = (emitter as unknown as { logger: { warn: (m: string) => void } }).logger;
    (emitter as unknown as { logger: { warn: (m: string) => void } }).logger = {
      warn: (m: string) => {
        warns.push(m);
      },
    };

    emitter.emit({
      event: 'ProviderCompleted',
      model: 'sk-ant-abcdefghijklmnopqrstuvwxyz',
      meta: { userText: 'secret customer message' },
    });

    expect(emitter.privacyRejectionCount()).toBeGreaterThan(0);
    expect(emitter.list()).toHaveLength(0);
    expect(warns.join(' ')).toContain('privacy drop');
    expect(warns.join(' ')).not.toContain('secret customer message');
    expect(assertPrivacySafe(toTelemetryEvent({ event: 'PlannerCompleted', capability: 'GET_LIQUIDITY' }))).toEqual(
      [],
    );

    (emitter as unknown as { logger: typeof original }).logger = original;
  });
});

describe('Assistant Health access control', () => {
  it('PlatformAdminGuard denies normal tenant members', () => {
    const guard = new PlatformAdminGuard({
      get: () => 'admin@fraterunion.com',
    } as never);
    expect(() =>
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({ user: { userId: 'u1', email: 'owner@wristcaviar.com', tenantId: 't1', role: 'OWNER' } }),
        }),
      } as never),
    ).toThrow(/PLATFORM_ADMIN/);
  });

  it('PlatformAdminGuard allows allowlisted platform admin', () => {
    const guard = new PlatformAdminGuard({
      get: (k: string) => (k === 'PLATFORM_ADMIN_EMAILS' ? 'admin@fraterunion.com' : ''),
    } as never);
    expect(
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: 'u1', email: 'admin@fraterunion.com', tenantId: 't1', role: 'OWNER' },
          }),
        }),
      } as never),
    ).toBe(true);
  });

  it('health controller uses durable aggregation and never returns raw tenant ids in filter hash mode', async () => {
    const durable = {
      aggregate: jest.fn(async () => ({
        generatedAt: new Date().toISOString(),
        sourceOfTruth: 'AIRequest+AIActionRun+AIAuditEvent',
        window: '7d',
        windowStart: new Date().toISOString(),
        windowEnd: new Date().toISOString(),
        scope: 'tenant_filtered',
        tenantFilterHash: 'abcd',
        requestCount: 0,
        actionRunCount: 0,
        auditEventCount: 0,
        kpis: {
          successRate: 0,
          failureRate: 0,
          clarificationRate: 0,
          confirmationRate: 0,
          cancellationRate: 0,
          recoveryRate: 0,
          replayRate: 0,
          unknownIntentRate: 0,
          inferredAbandonmentRate: 0,
          avgProviderLatencyMs: null,
          avgPlannerLatencyMs: null,
          avgRequestLatencyMs: null,
          avgExecutionLatencyMs: null,
        },
        denominators: {
          requests: 0,
          requestsWithPreview: 0,
          actionRuns: 0,
          dangerousWriteAttempts: 0,
          clarificationsAwaiting: 0,
        },
        requestOutcomes: {},
        actionRunOutcomes: {},
        topFailedIntents: [],
        topClarifications: [],
        topCapabilities: [],
        topRecoveryCauses: [],
        topSlowQueries: [],
        capabilityFunnels: {},
        dangerousWriteVerification: { capabilities: [], violations: [], ok: true },
        latencyBreakdown: {
          provider: { avg: null, p95: null, count: 0, note: '' },
          planner: { avg: null, p95: null, count: 0, note: '' },
          binding: { avg: null, p95: null, count: 0, note: '' },
          domain: { avg: null, p95: null, count: 0, note: '' },
          total: { avg: null, p95: null, count: 0, note: '' },
          sql: { avg: null, p95: null, count: 0, note: '' },
        },
        retentionNote: 'test',
        passive: true as const,
      })),
    };
    const emitter = new TelemetryEmitter(new MemoryTelemetryStore());
    const aggregator = new TelemetryAggregator(emitter, durable as never);
    const controller = new TelemetryController(aggregator, emitter);
    const result = await controller.health(
      { userId: 'admin', email: 'admin@fraterunion.com', tenantId: 'tenant-raw-secret' },
      '7d',
      'tenant-raw-secret',
    );
    expect(durable.aggregate).toHaveBeenCalledWith({ window: '7d', tenantId: 'tenant-raw-secret' });
    expect(JSON.stringify(result)).not.toContain('tenant-raw-secret');
    expect(result.access).toBe('PLATFORM_ADMIN');
    expect(result.sourceOfTruth).toContain('AIRequest');
  });
});

describe('Architecture: production logic does not depend on telemetry', () => {
  it('planner and write bindings still have zero telemetry imports', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const aiRoot = path.join(__dirname, '../..');
    for (const rel of [
      'planner/planner.service.ts',
      'bindings/write/register-sale.binding.ts',
      'bindings/write/register-expense.binding.ts',
      'bindings/write/register-receivable-payment.binding.ts',
      'intent-adapter/providers/claude-intent-provider.ts',
    ]) {
      const src = fs.readFileSync(path.join(aiRoot, rel), 'utf8');
      expect(src).not.toMatch(/TelemetryAggregator|DurableTelemetrySource|emitter\.list/);
    }
  });

  it('exactly eight executable write bindings remain registered', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const registry = fs.readFileSync(
      path.join(__dirname, '../../bindings/write-capability-binding-registry.ts'),
      'utf8',
    );
    expect(registry).toContain('RegisterSaleWriteBinding');
    expect(registry).toContain('RegisterReceivablePaymentWriteBinding');
    expect(registry).toContain('RegisterPayablePaymentWriteBinding');
    expect(registry).toContain('RegisterExpenseWriteBinding');
    expect(registry).toContain('RegisterPurchaseWriteBinding');
    expect(registry).toContain('CreateClientWriteBinding');
    expect(registry).toContain('UpdateClientWriteBinding');
    expect(registry).toContain('RegisterTreasuryTransferWriteBinding');
    expect(registry).toContain('this.bindings.size !== 8');
    const structured = fs.readFileSync(
      path.join(__dirname, '../../assistant/structured-assistant.service.ts'),
      'utf8',
    );
    expect(structured).toContain("'REGISTER_PURCHASE'");
    expect(structured).toContain("'REGISTER_SALE'");
    expect(structured).toContain("'REGISTER_RECEIVABLE_PAYMENT'");
    expect(structured).toContain("'REGISTER_PAYABLE_PAYMENT'");
    expect(structured).toContain("'REGISTER_TREASURY_TRANSFER'");
    expect(structured).toContain("'REGISTER_EXPENSE'");
    expect(structured).toContain("'CREATE_CLIENT'");
    expect(structured).toContain("'UPDATE_CLIENT'");
  });
});
