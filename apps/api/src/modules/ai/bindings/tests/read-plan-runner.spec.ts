import { createPlanFingerprint } from '../../domain/plan-fingerprint';
import { BusinessActionCatalog } from '../../planner/actions/business-action-catalog';
import { BusinessCapabilityCatalog } from '../../planner/capabilities/business-capability-catalog';
import { PlannerService } from '../../planner/planner.service';
import { BusinessExecutionPlan } from '../../planner/planner.types';
import { CapabilityBindingRegistry } from '../capability-binding-registry';
import { ReadPlanRunner } from '../read-plan-runner';

const planner = new PlannerService(new BusinessActionCatalog(), new BusinessCapabilityCatalog());
const current = { workspaceVersion: 1, entityVersions: {} };
const context = { tenantId: 't1', userId: 'u1', permissions: [], conversationId: 'c1', workspaceId: 'w1', actionRunId: null, requestId: 'trace', locale: 'en', timezone: 'UTC', now: new Date('2026-08-06T00:00:00Z') };
const readPlan = () => planner.plan({ intent: 'SEARCH_CLIENT', entities: { query: 'Jose', limit: 10 } }, current);
const resign = (plan: BusinessExecutionPlan) => {
  const { fingerprint: _fingerprint, ...unsigned } = plan;
  plan.fingerprint = createPlanFingerprint(unsigned as never);
  return plan;
};
const resultFor = (stepId: string, capability = 'SEARCH_CLIENT') => ({ capability, bindingVersion: '1.0.0', toolName: 'search_clients', toolVersion: '1.0.0', success: true, data: {}, summary: stepId, warnings: [], sourceMetadata: { canonicalService: 'CrmService.searchClientsForTools', deterministic: true, tenantScoped: true }, executedAt: context.now.toISOString(), durationMs: 1, traceId: `trace:${stepId}` });

describe('ReadPlanRunner', () => {
  const registry = { getBinding: jest.fn(() => ({ mode: 'READ' })) } as unknown as CapabilityBindingRegistry;
  const runtime = { startExecution: jest.fn(), completeExecution: jest.fn(), failExecution: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('executes dependencies in stable declared order', async () => {
    const plan = readPlan();
    plan.executionSteps = [
      { ...plan.executionSteps[0]!, stepId: 'search' },
      { ...plan.executionSteps[0]!, stepId: 'accounts', capability: 'GET_CLIENT_ACCOUNTS', arguments: { clientId: 'c1' }, dependsOn: ['search'] },
    ];
    resign(plan);
    const order: string[] = [];
    const service = { executeCapability: jest.fn(async (step) => { order.push(step.stepId); return resultFor(step.stepId, step.capability); }) };
    const runner = new ReadPlanRunner(planner, registry, service as never, runtime as never);
    const output = await runner.run({ plan, current, expectedFingerprint: plan.fingerprint, toolContext: context });
    expect(output.executionState).toBe('COMPLETED');
    expect(order).toEqual(['search', 'accounts']);
  });

  it('rejects an unresolvable dependency before execution', async () => {
    const plan = readPlan();
    plan.executionSteps[0]!.dependsOn = ['missing'];
    resign(plan);
    const service = { executeCapability: jest.fn() };
    const runner = new ReadPlanRunner(planner, registry, service as never, runtime as never);
    await expect(runner.run({ plan, current, expectedFingerprint: plan.fingerprint, toolContext: context })).rejects.toThrow('dependency');
    expect(service.executeCapability).not.toHaveBeenCalled();
  });

  it('rejects write, mixed, and above-Tier-0 plans', async () => {
    const service = { executeCapability: jest.fn() };
    const runner = new ReadPlanRunner(planner, registry, service as never, runtime as never);
    const write = planner.plan({ intent: 'REGISTER_SALE', entities: { watchId: 'w', customerId: 'c', price: '1.00', currency: 'MXN' } }, current);
    await expect(runner.run({ plan: write, current, expectedFingerprint: write.fingerprint, toolContext: context })).rejects.toThrow('tier');
    const mixed = readPlan();
    mixed.executionSteps.push({ stepId: 'write', capability: 'REGISTER_SALE', arguments: {}, dependsOn: [], estimatedEffects: [], reversibility: 'NONE' });
    resign(mixed);
    (registry.getBinding as jest.Mock).mockImplementationOnce(() => ({ mode: 'READ' })).mockImplementationOnce(() => { throw new Error('unbound'); });
    await expect(runner.run({ plan: mixed, current, expectedFingerprint: mixed.fingerprint, toolContext: context })).rejects.toThrow('unbound');
    expect(service.executeCapability).not.toHaveBeenCalled();
  });

  it('rejects fingerprint, workspace, entity-version, and tampering staleness', async () => {
    const plan = planner.plan({ intent: 'GET_CLIENT_ACCOUNTS', entities: { clientId: 'c1' } }, { workspaceVersion: 1, entityVersions: { client: 2 } });
    const runner = new ReadPlanRunner(planner, registry, { executeCapability: jest.fn() } as never, runtime as never);
    await expect(runner.run({ plan, current: { workspaceVersion: 1, entityVersions: { client: 2 } }, expectedFingerprint: '0'.repeat(64), toolContext: context })).rejects.toThrow('PLAN_FINGERPRINT_MISMATCH');
    await expect(runner.run({ plan, current: { workspaceVersion: 2, entityVersions: { client: 2 } }, expectedFingerprint: plan.fingerprint, toolContext: context })).rejects.toThrow('WORKSPACE_VERSION_CHANGED');
    await expect(runner.run({ plan, current: { workspaceVersion: 1, entityVersions: { client: 3 } }, expectedFingerprint: plan.fingerprint, toolContext: context })).rejects.toThrow('ENTITY_VERSION_CHANGED');
    plan.executionSteps[0]!.arguments.clientId = 'forged';
    await expect(runner.run({ plan, current: { workspaceVersion: 1, entityVersions: { client: 2 } }, expectedFingerprint: plan.fingerprint, toolContext: context })).rejects.toThrow('PLAN_FINGERPRINT_MISMATCH');
  });

  it('uses the existing runtime lifecycle and stores only a bounded completion receipt', async () => {
    const plan = readPlan();
    const service = { executeCapability: jest.fn(async (step) => resultFor(step.stepId)) };
    const runner = new ReadPlanRunner(planner, registry, service as never, runtime as never);
    const output = await runner.run({ plan, current, expectedFingerprint: plan.fingerprint, toolContext: context, actionRunId: 'run-1' });
    expect(output.executionState).toBe('COMPLETED');
    expect(runtime.startExecution).toHaveBeenCalledWith('t1', 'u1', 'run-1');
    expect(runtime.completeExecution).toHaveBeenCalledWith('t1', 'u1', 'run-1', { planFingerprint: plan.fingerprint, executionState: 'COMPLETED', stepCount: 1 });
  });

  it('moves a started runtime to FAILED without a business mutation when execution fails', async () => {
    const plan = readPlan();
    const runner = new ReadPlanRunner(planner, registry, { executeCapability: jest.fn(async () => { throw new Error('controlled'); }) } as never, runtime as never);
    const output = await runner.run({ plan, current, expectedFingerprint: plan.fingerprint, toolContext: context, actionRunId: 'run-1' });
    expect(output.executionState).toBe('FAILED');
    expect(runtime.failExecution).toHaveBeenCalledWith('t1', 'u1', 'run-1', 'Read plan failed: Error');
  });

  it('fails a retry closed when the existing action-run lifecycle rejects it', async () => {
    runtime.startExecution.mockRejectedValueOnce(new Error('terminal action run'));
    const service = { executeCapability: jest.fn() };
    const plan = readPlan();
    const runner = new ReadPlanRunner(planner, registry, service as never, runtime as never);
    const output = await runner.run({ plan, current, expectedFingerprint: plan.fingerprint, toolContext: context, actionRunId: 'run-1' });
    expect(output.executionState).toBe('FAILED');
    expect(service.executeCapability).not.toHaveBeenCalled();
    expect(runtime.failExecution).not.toHaveBeenCalled();
  });
});
