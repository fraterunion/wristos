import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ToolRegistry } from '../../tools/tool-registry';
import { CapabilityBindingRegistry } from '../capability-binding-registry';
import { CapabilityBindingService } from '../capability-binding.service';
import { BusinessCapability, BusinessPlanStep } from '../../planner/planner.types';

const toolRegistry = () => new ToolRegistry({} as never, {} as never, {} as never, {} as never, {} as never);
const step = (capability: BusinessCapability, args: Record<string, any> = {}): BusinessPlanStep => ({ stepId: 's1', capability, arguments: args, dependsOn: [], estimatedEffects: [], reversibility: 'FULL' });
const context = { tenantId: 't1', userId: 'u1', permissions: [], conversationId: null, workspaceId: null, actionRunId: null, requestId: 'trace-1', locale: 'en', timezone: 'UTC', now: new Date('2026-08-06T00:00:00Z') };
const pendingAudit = (capability: BusinessCapability) => ({ planFingerprint: 'a'.repeat(64), stepId: 's1', capability });

describe('CapabilityBindingRegistry', () => {
  it('contains exactly five unique, verified read bindings', () => {
    const registry = new CapabilityBindingRegistry(toolRegistry());
    const bindings = registry.listBindings();
    expect(bindings).toHaveLength(5);
    expect(new Set(bindings.map((binding) => binding.capability)).size).toBe(5);
    expect(bindings.every((binding) => binding.mode === 'READ' && binding.version === '1.0.0' && binding.toolVersion === '1.0.0')).toBe(true);
    expect(registry).not.toHaveProperty('register');
  });

  it.each(['REGISTER_SALE', 'REGISTER_RECEIVABLE_PAYMENT', 'REGISTER_PURCHASE', 'REGISTER_EXPENSE', 'REGISTER_SETTLEMENT', 'REGISTER_CRYPTO_POSITION', 'REGISTER_CRYPTO_PRICE'])('keeps %s explicitly unbound', (capability) => {
    const registry = new CapabilityBindingRegistry(toolRegistry());
    expect(registry.hasBinding(capability)).toBe(false);
    expect(() => registry.getBinding(capability)).toThrow(NotFoundException);
  });

  it('fails construction when a target version or mode does not match', () => {
    const registry = { getDefinition: jest.fn(() => ({ name: 'get_liquidity', version: '9.0.0', mode: 'WRITE' })) };
    expect(() => new CapabilityBindingRegistry(registry as never)).toThrow(BadRequestException);
  });
});

describe('Capability input mapping and execution', () => {
  const cases: Array<[BusinessCapability, string, Record<string, any>]> = [
    ['GET_LIQUIDITY', 'get_liquidity', {}],
    ['GET_MONTHLY_PROFIT', 'get_monthly_profit', { year: 2026, month: 8 }],
    ['SEARCH_INVENTORY', 'search_inventory', { query: 'Batman', status: 'ALL', limit: 10 }],
    ['SEARCH_CLIENT', 'search_clients', { query: 'Jose', limit: 10 }],
    ['GET_CLIENT_ACCOUNTS', 'get_client_accounts', { clientId: 'c1', type: 'ALL', status: 'OPEN' }],
  ];

  it.each(cases)('maps and executes %s only through %s', async (capability, toolName, args) => {
    const registry = new CapabilityBindingRegistry(toolRegistry());
    const execute = jest.fn(async (name, _context, input) => ({ toolName: name, toolVersion: '1.0.0', success: true, data: { amount: '1.20', at: '2026-08-06T00:00:00.000Z', input }, summary: 'bounded', sourceMetadata: { canonicalService: 'Test.read', deterministic: true, tenantScoped: true }, warnings: [], executedAt: context.now.toISOString(), durationMs: 1, traceId: context.requestId }));
    const prisma = { tenantUser: { findFirst: jest.fn(async () => ({ id: 'membership' })) } };
    const service = new CapabilityBindingService(registry, { execute } as never, prisma as never);
    const result = await service.executeCapability(step(capability, args), context, pendingAudit(capability));
    expect(execute).toHaveBeenCalledWith(toolName, context, args, { ...pendingAudit(capability), bindingVersion: '1.0.0' });
    expect(result).toEqual(expect.objectContaining({ capability, toolName, toolVersion: '1.0.0', bindingVersion: '1.0.0', data: { amount: '1.20', at: '2026-08-06T00:00:00.000Z', input: args } }));
  });

  it('rejects unknown arguments and missing required arguments without executing', async () => {
    const registry = new CapabilityBindingRegistry(toolRegistry());
    const execute = jest.fn();
    const service = new CapabilityBindingService(registry, { execute } as never, { tenantUser: { findFirst: jest.fn(async () => ({ id: 'm' })) } } as never);
    await expect(service.executeCapability(step('SEARCH_CLIENT', { query: 'Jose', extra: true }), context, pendingAudit('SEARCH_CLIENT'))).rejects.toThrow();
    await expect(service.executeCapability(step('GET_MONTHLY_PROFIT', { year: 2026 }), context, pendingAudit('GET_MONTHLY_PROFIT'))).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated or cross-tenant membership before resolving a tool', async () => {
    const registry = new CapabilityBindingRegistry(toolRegistry());
    const execute = jest.fn();
    const service = new CapabilityBindingService(registry, { execute } as never, { tenantUser: { findFirst: jest.fn(async () => null) } } as never);
    await expect(service.executeCapability(step('GET_LIQUIDITY'), context, pendingAudit('GET_LIQUIDITY'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(execute).not.toHaveBeenCalled();
  });
});
