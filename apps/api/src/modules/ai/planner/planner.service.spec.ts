import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { BusinessActionCatalog } from './actions/business-action-catalog';
import { BusinessActionDefinition } from './actions/business-action-definition';
import { PlannerService } from './planner.service';

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

describe('PlannerService', () => {
  const catalog = new BusinessActionCatalog();
  const planner = new PlannerService(catalog);

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
    expect(plan.preview?.estimatedEffects.map((effect) => effect.area)).toEqual(['Inventory', 'Treasury', 'Capital']);
  });

  it('builds a deterministic execution plan without executing a tool', () => {
    const first = planner.plan({ intent: 'REGISTER_SALE', entities: saleEntities }, context);
    const second = planner.plan({ intent: 'REGISTER_SALE', entities: { currency: 'MXN', price: '35000.00', customerId: 'client-1', watchLabel: 'Batman', watchId: 'watch-1' } }, { entityVersions: { customer: 'v2', watch: 3 }, workspaceVersion: 7 });
    expect(first.executionSteps).toEqual([{ businessAction: 'REGISTER_SALE', toolName: 'register_sale', arguments: saleEntities }]);
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
      requiredEntities: ['amount'], optionalEntities: [], clarificationQuestions: { amount: 'Amount?' }, warningRules: [], allowedToolNames: ['prepare_settlement', 'register_settlement'], resultSchema: z.unknown(),
      previewBuilder: (_entities, warnings) => ({ title: 'Settlement', category: 'ACCOUNTS', fields: [], warnings, confirmationTier: 'HIGH', estimatedEffects: [] }),
      planBuilder: (entities) => [{ businessAction: 'REGISTER_SETTLEMENT', toolName: 'prepare_settlement', arguments: { amount: entities.amount! } }, { businessAction: 'REGISTER_SETTLEMENT', toolName: 'register_settlement', arguments: { amount: entities.amount! } }],
    };
    const customCatalog = new BusinessActionCatalog();
    jest.spyOn(customCatalog, 'get').mockReturnValue(definition);
    const customPlanner = new PlannerService(customCatalog);
    const plan = customPlanner.plan({ intent: 'REGISTER_SETTLEMENT', entities: { amount: '10.00' } }, context);
    expect(plan.executionSteps).toHaveLength(2);
    expect(futureExecutor).not.toHaveBeenCalled();
  });

  it('emits deterministic overpayment and duplicate-serial warnings', () => {
    expect(planner.plan({ intent: 'REGISTER_RECEIVABLE_PAYMENT', entities: { accountId: 'a1', amount: 11, destination: 'BANK', outstandingAmount: 10 } }, context).warnings[0]?.code).toBe('AMOUNT_EXCEEDS_OUTSTANDING');
    expect(planner.plan({ intent: 'REGISTER_PURCHASE', entities: { watch: 'Rolex', cost: '1.00', currency: 'MXN', duplicateSerial: true } }, context).warnings[0]?.code).toBe('DUPLICATE_SERIAL');
  });
});
