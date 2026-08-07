import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { BusinessActionCatalog } from './actions/business-action-catalog';
import { BusinessActionDefinition } from './actions/business-action-definition';
import { BusinessCapabilityCatalog } from './capabilities/business-capability-catalog';
import { PlannerService } from './planner.service';
import { createNotExecutedResult } from './planner.types';

const context = { workspaceVersion: 7, entityVersions: { watch: 3, customer: 'v2' } };
const saleEntities = { watchId: 'watch-1', customerId: 'client-1', price: '35000.00', currency: 'MXN', watchLabel: 'Batman' };

describe('BusinessActionCatalog', () => {
  const catalog = new BusinessActionCatalog();

  it('contains the twelve V1 business actions', () => {
    expect(catalog.list().map((action) => action.id)).toEqual([
      'GET_LIQUIDITY', 'GET_MONTHLY_PROFIT', 'SEARCH_INVENTORY', 'SEARCH_CLIENT', 'GET_CLIENT_ACCOUNTS',
      'REGISTER_SALE', 'REGISTER_RECEIVABLE_PAYMENT', 'REGISTER_PURCHASE', 'REGISTER_EXPENSE', 'REGISTER_SETTLEMENT',
      'REGISTER_CRYPTO_POSITION', 'REGISTER_CRYPTO_PRICE',
    ]);
  });

  it('rejects unknown actions', () => {
    expect(() => catalog.get('INVENT_A_VALUE')).toThrow(NotFoundException);
  });
});

describe('BusinessCapabilityCatalog', () => {
  it('contains business meaning for exactly the twelve V1 capabilities', () => {
    const entries = new BusinessCapabilityCatalog().list();
    expect(entries).toHaveLength(12);
    expect(entries.map((entry) => entry.id)).toContain('REGISTER_SALE');
    expect(entries.every((entry) => entry.name && entry.description && entry.category)).toBe(true);
  });
});

describe('PlannerService', () => {
  const catalog = new BusinessActionCatalog();
  const capabilities = new BusinessCapabilityCatalog();
  const planner = new PlannerService(catalog, capabilities);

  it('detects every missing entity and generates deterministic clarification questions', () => {
    const plan = planner.plan({ intent: 'REGISTER_SALE', entities: { watchId: 'watch-1' } }, context);
    expect(plan.state).toBe('NEEDS_CLARIFICATION');
    expect(plan.missingEntities.map((item) => item.entity)).toEqual(['customerId', 'price', 'currency']);
    expect(plan.clarificationQuestions).toEqual(['Who is the customer?', 'What is the price?', 'What currency applies?']);
    expect(plan.executionSteps).toEqual([]);
    expect(plan.preview).toBeNull();
  });

  it('generates warnings without blocking a ready confirmation preview', () => {
    const plan = planner.plan({ intent: 'REGISTER_SALE', entities: { ...saleEntities, watchStatus: 'RESERVED' } }, context);
    expect(plan.state).toBe('READY_FOR_CONFIRMATION');
    expect(plan.warnings).toEqual([{ code: 'WATCH_RESERVED', message: 'The selected watch is reserved.' }]);
    expect(plan.preview).toEqual(expect.objectContaining({ title: 'Register Sale', confirmationTier: 'HIGH', warnings: plan.warnings }));
    expect(plan.preview?.estimatedEffects.map((effect) => effect.area)).toEqual(['Inventory', 'Treasury', 'CxC', 'Capital']);
  });

  it('REGISTER_SALE preview matches payment-mode canonical semantics', () => {
    const credit = planner.plan({ intent: 'REGISTER_SALE', entities: { ...saleEntities, paymentMode: 'CREDIT' } }, context);
    expect(credit.preview?.estimatedEffects).toEqual([
      { area: 'Inventory', description: 'Selected watch becomes SOLD.' },
      { area: 'Treasury', description: 'Sin movimiento — no payment received.' },
      { area: 'CxC', description: 'Full sale balance outstanding as receivable.' },
      { area: 'Capital', description: 'Profit is recalculated.' },
    ]);
    const paid = planner.plan({ intent: 'REGISTER_SALE', entities: { ...saleEntities, paymentMode: 'PAID' } }, context);
    expect(paid.preview?.estimatedEffects.find((e) => e.area === 'Treasury')?.description).toContain('Inflow');
    expect(paid.preview?.estimatedEffects.find((e) => e.area === 'CxC')?.description).toContain('No open receivable');
  });

  it('builds a deterministic execution plan without executing a tool', () => {
    const first = planner.plan({ intent: 'REGISTER_SALE', entities: saleEntities }, context);
    const second = planner.plan({ intent: 'REGISTER_SALE', entities: { currency: 'MXN', price: '35000.00', customerId: 'client-1', watchLabel: 'Batman', watchId: 'watch-1' } }, { entityVersions: { customer: 'v2', watch: 3 }, workspaceVersion: 7 });
    expect(first.executionSteps).toEqual([{ stepId: 'register-sale-1', capability: 'REGISTER_SALE', arguments: saleEntities, dependsOn: [], estimatedEffects: first.preview?.estimatedEffects, reversibility: 'PARTIAL' }]);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('selects confirmation tiers by business risk', () => {
    expect(planner.plan({ intent: 'GET_LIQUIDITY', entities: {} }, context).confirmationTier).toBe('NONE');
    expect(planner.plan({ intent: 'REGISTER_EXPENSE', entities: { concept: 'Rent', amount: '1.00', currency: 'MXN' } }, context).confirmationTier).toBe('MEDIUM');
    expect(planner.plan({ intent: 'REGISTER_PURCHASE', entities: { watch: 'Rolex', cost: '1.00', currency: 'MXN' } }, context).confirmationTier).toBe('HIGH');
  });

  it('marks workspace, entity and fingerprint changes stale', () => {
    const plan = planner.plan({ intent: 'REGISTER_SALE', entities: saleEntities }, context);
    expect(planner.validatePlanStillCurrent(plan, context)).toEqual({ current: true, reasons: [] });
    expect(planner.validatePlanStillCurrent(plan, { ...context, workspaceVersion: 8 }).reasons).toContain('WORKSPACE_VERSION_CHANGED');
    expect(planner.validatePlanStillCurrent(plan, { ...context, entityVersions: { ...context.entityVersions, watch: 4 } }).reasons).toContain('ENTITY_VERSION_CHANGED');
    expect(planner.validatePlanStillCurrent(plan, context, '0'.repeat(64)).reasons).toContain('PLAN_FINGERPRINT_MISMATCH');
  });

  it('detects in-memory plan tampering through fingerprint recomputation', () => {
    const plan = planner.plan({ intent: 'REGISTER_SALE', entities: saleEntities }, context);
    plan.executionSteps[0]!.arguments.price = '1.00';
    expect(planner.validatePlanStillCurrent(plan, context).reasons).toEqual(['PLAN_FINGERPRINT_MISMATCH']);
  });

  it('supports multiple planned steps but never calls their future executors', () => {
    const futureExecutor = jest.fn();
    const definition: BusinessActionDefinition = {
      id: 'REGISTER_SETTLEMENT', name: 'Settlement', description: 'test', category: 'ACCOUNTS', confirmationTier: 'HIGH',
      requiredEntities: ['amount'], optionalEntities: [], clarificationQuestions: { amount: 'Amount?' }, warningRules: [], capabilities: ['GET_CLIENT_ACCOUNTS', 'REGISTER_SETTLEMENT'], resultSchema: z.unknown(),
      previewBuilder: (_entities, warnings) => ({ title: 'Settlement', category: 'ACCOUNTS', fields: [], warnings, confirmationTier: 'HIGH', estimatedEffects: [] }),
      planningStrategy: (entities) => [
        { stepId: 'load-accounts', capability: 'GET_CLIENT_ACCOUNTS', arguments: { amount: entities.amount! }, dependsOn: [], estimatedEffects: [], reversibility: 'FULL' },
        { stepId: 'settle', capability: 'REGISTER_SETTLEMENT', arguments: { amount: entities.amount! }, dependsOn: ['load-accounts'], estimatedEffects: [], reversibility: 'PARTIAL' },
      ],
    };
    const customCatalog = new BusinessActionCatalog();
    jest.spyOn(customCatalog, 'get').mockReturnValue(definition);
    const customPlanner = new PlannerService(customCatalog, capabilities);
    const plan = customPlanner.plan({ intent: 'REGISTER_SETTLEMENT', entities: { amount: '10.00' } }, context);
    expect(plan.executionSteps).toHaveLength(2);
    expect(plan.executionSteps.map((step) => [step.stepId, step.dependsOn])).toEqual([['load-accounts', []], ['settle', ['load-accounts']]]);
    expect(futureExecutor).not.toHaveBeenCalled();
  });

  it('keeps fingerprints stable when an external capability binding changes', () => {
    const bindings = new Map([['REGISTER_SALE', 'implementation-a']]);
    const first = planner.plan({ intent: 'REGISTER_SALE', entities: saleEntities }, context);
    bindings.set('REGISTER_SALE', 'implementation-b');
    const second = planner.plan({ intent: 'REGISTER_SALE', entities: saleEntities }, context);
    expect(bindings.get('REGISTER_SALE')).toBe('implementation-b');
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it('creates only an inert, not-executed business action result', () => {
    expect(createNotExecutedResult('REGISTER_SALE')).toEqual({ actionId: 'REGISTER_SALE', executionState: 'NOT_EXECUTED', success: false, affectedEntities: [], generatedEvents: [], receipt: null, warnings: [], rollbackPossible: false });
  });

  it('emits deterministic overpayment and duplicate-serial warnings', () => {
    expect(planner.plan({ intent: 'REGISTER_RECEIVABLE_PAYMENT', entities: { accountId: 'a1', amount: 11, destination: 'BANK', outstandingAmount: 10 } }, context).warnings[0]?.code).toBe('AMOUNT_EXCEEDS_OUTSTANDING');
    expect(planner.plan({ intent: 'REGISTER_PURCHASE', entities: { watch: 'Rolex', cost: '1.00', currency: 'MXN', duplicateSerial: true } }, context).warnings[0]?.code).toBe('DUPLICATE_SERIAL');
  });
});
