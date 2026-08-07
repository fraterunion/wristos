import { NotFoundException } from '@nestjs/common';
import { ToolRegistry } from '../tool-registry';

describe('ToolRegistry', () => {
  const analytics = { getLiquidity: jest.fn(), getMonthlyProfit: jest.fn() };
  const inventory = { getSummary: jest.fn(), searchInventory: jest.fn() };
  const crm = { searchClientsForTools: jest.fn() };
  const cuentas = { getClientAccountsForTools: jest.fn(), getOpenAccountsForTools: jest.fn() };
  const history = { getRecentSalesForTools: jest.fn() };
  const oi = {
    getInventoryAging: jest.fn(),
    getTopInventoryCapital: jest.fn(),
    getTopDebtors: jest.fn(),
    getReceivableSummary: jest.fn(),
    getSalesMarginSummary: jest.fn(),
    getProfitByBrand: jest.fn(),
    getTopSales: jest.fn(),
    getAttentionItems: jest.fn(),
  };
  const registry = new ToolRegistry(
    analytics as never,
    inventory as never,
    crm as never,
    cuentas as never,
    history as never,
    oi as never,
  );

  it('lists seventeen unique, versioned, read-only tools including operational intelligence', () => {
    const tools = registry.listDefinitions();
    expect(tools).toHaveLength(17);
    expect(new Set(tools.map((tool) => tool.name))).toHaveProperty('size', 17);
    expect(tools.every((tool) => tool.version === '1.0.0' && tool.mode === 'READ' && tool.confirmationTier === 0)).toBe(true);
    expect(tools.map((tool) => tool.name)).toEqual([
      'get_attention_items',
      'get_client_accounts',
      'get_inventory_aging',
      'get_inventory_summary',
      'get_liquidity',
      'get_monthly_profit',
      'get_open_payables',
      'get_open_receivables',
      'get_profit_by_brand',
      'get_receivable_summary',
      'get_recent_sales',
      'get_sales_margin_summary',
      'get_top_debtors',
      'get_top_inventory_capital',
      'get_top_sales',
      'search_clients',
      'search_inventory',
    ]);
  });

  it('rejects names outside the static allowlist', () => {
    expect(() => registry.getDefinition('queryTable')).toThrow(NotFoundException);
  });

  it('uses canonical services and tenant/time context deterministically', async () => {
    inventory.searchInventory.mockResolvedValue([{ id: 'w1' }]);
    const tool = registry.getDefinition('search_inventory');
    const context = { tenantId: 't1', userId: 'u1', permissions: [], role: 'OWNER', conversationId: null, workspaceId: null, actionRunId: null, requestId: 'trace', locale: 'es-MX', timezone: 'America/Mexico_City', now: new Date('2026-08-06T00:00:00Z') };
    expect(() => tool.inputValidator.parse({ query: 'Rolex', limit: 999 })).toThrow();
    const input = tool.inputValidator.parse({ query: 'Rolex', limit: 20 });
    await tool.execute(context, input);
    expect(inventory.searchInventory).toHaveBeenCalledWith('t1', 'Rolex', 'ALL', 20, context.now);
  });

  it('returns canonical liquidity and inventory summaries without recomputing adapters', async () => {
    const context = { tenantId: 't1', userId: 'u1', permissions: [], conversationId: null, workspaceId: null, actionRunId: null, requestId: 'trace', locale: 'es-MX', timezone: 'UTC', now: new Date('2026-08-06T00:00:00Z') };
    const liquidity = { cashMxn: '731200.00', bankMxn: '4769759.44', cryptoMxn: '1.00', cesarMxn: '80869.26', totalLiquidityMxn: '5581829.70', cryptoPriceStatus: 'FRESH', cryptoOldestPriceCapturedAt: null, warnings: [] };
    analytics.getLiquidity.mockResolvedValue(liquidity);
    expect((await registry.getDefinition('get_liquidity').execute(context, {})).data).toEqual(liquidity);
    inventory.getSummary.mockResolvedValue({ activeItemCount: 40, totalInventoryValue: '18261520.00', averageCost: '456538.00' });
    expect((await registry.getDefinition('get_inventory_summary').execute(context, {})).data).toEqual({ activeItemCount: 40, totalInventoryCostMxn: '18261520.00', averageCostMxn: '456538.00' });
  });

  it('delegates AccountEntry, monthly profit, and historical sales reads only', async () => {
    const context = { tenantId: 't1', userId: 'u1', permissions: [], conversationId: null, workspaceId: null, actionRunId: null, requestId: 'trace', locale: 'es-MX', timezone: 'UTC', now: new Date('2026-08-06T00:00:00Z') };
    cuentas.getClientAccountsForTools.mockResolvedValue([]);
    await registry.getDefinition('get_client_accounts').execute(context, { clientId: 'c1', type: 'ALL', status: 'ALL' });
    expect(cuentas.getClientAccountsForTools).toHaveBeenCalledWith('t1', 'c1', undefined, undefined);
    const profit = { period: '2026-07', salesMxn: '10.00', cogsMxn: '2.00', bankCommissionsMxn: '1.00', operatingExpensesMxn: '3.00', netProfitMxn: '4.00', saleCount: 1 };
    analytics.getMonthlyProfit.mockResolvedValue(profit);
    expect((await registry.getDefinition('get_monthly_profit').execute(context, { year: 2026, month: 7 })).data).toEqual(profit);
    const snapshot = { dealId: 'd1', soldAt: '2026-07-01T00:00:00.000Z', agreedPrice: '10.00', computedStatus: 'HISTORICO', isHistoricalImport: true };
    history.getRecentSalesForTools.mockResolvedValue([snapshot]);
    expect((await registry.getDefinition('get_recent_sales').execute(context, { limit: 20 })).data).toEqual({ items: [snapshot] });
  });

  it('delegates operational intelligence tools without mutation', async () => {
    const context = { tenantId: 't1', userId: 'u1', permissions: [], conversationId: null, workspaceId: null, actionRunId: null, requestId: 'trace', locale: 'es-MX', timezone: 'UTC', now: new Date('2026-08-06T00:00:00Z') };
    oi.getInventoryAging.mockResolvedValue({ count: 1, items: [], totalCapitalAtRisk: '0.00', asOf: context.now.toISOString(), ageSource: 'Watch.createdAt', ageSourceNote: 'x', minAgeDays: 0 });
    await registry.getDefinition('get_inventory_aging').execute(context, {});
    expect(oi.getInventoryAging).toHaveBeenCalledWith('t1', expect.objectContaining({ now: context.now }));
    oi.getAttentionItems.mockResolvedValue({ count: 0, items: [], asOf: context.now.toISOString(), policyVersion: '1.0.0', note: 'n' });
    await registry.getDefinition('get_attention_items').execute(context, {});
    expect(oi.getAttentionItems).toHaveBeenCalled();
  });
});
