import { z } from 'zod';
import { OperationalIntelligenceService } from '../../operational-intelligence/operational-intelligence.service';
import { ToolDefinition } from '../tool-definition';

const money = z.string().regex(/^-?\d+\.\d{2}$/);
const limit = z.number().int().min(1).max(50).optional();
const period = z.enum(['CURRENT_MONTH', 'YEAR', 'ALL', 'CUSTOM']).optional();
const year = z.number().int().min(2000).max(2200).optional();
const month = z.number().int().min(1).max(12).optional();

const definition = <I, O>(
  value: Omit<
    ToolDefinition<I, O>,
    'inputSchema' | 'outputSchema' | 'mode' | 'confirmationTier' | 'version'
  >,
): ToolDefinition<I, O> => ({
  ...value,
  version: '1.0.0',
  mode: 'READ',
  confirmationTier: 0,
  inputSchema: z.toJSONSchema(value.inputValidator) as Record<string, unknown>,
  outputSchema: z.toJSONSchema(value.outputValidator) as Record<string, unknown>,
});

export function createOperationalIntelligenceTools(
  oi: OperationalIntelligenceService,
): ToolDefinition[] {
  return [
    definition({
      name: 'get_inventory_aging',
      description: 'Active inventory ranked by days since Watch.createdAt (documented age source).',
      category: 'INVENTORY',
      permission: null,
      canonicalService: 'OperationalIntelligenceService.getInventoryAging',
      inputValidator: z.object({ minAgeDays: z.number().int().min(0).max(3650).optional(), limit }).strict(),
      outputValidator: z.object({
        asOf: z.string(),
        ageSource: z.string(),
        ageSourceNote: z.string(),
        minAgeDays: z.number(),
        items: z.array(z.object({
          watchId: z.string(),
          label: z.string(),
          brand: z.string().nullable(),
          reference: z.string().nullable(),
          cost: money,
          ageDays: z.number().int(),
          status: z.string(),
        })),
        totalCapitalAtRisk: money,
        count: z.number().int(),
      }).passthrough(),
      execute: async (ctx, input) => {
        const data = await oi.getInventoryAging(ctx.tenantId, { ...input, now: ctx.now });
        return { data, summary: `${data.count} active watches matching age filter` };
      },
    }),
    definition({
      name: 'get_top_inventory_capital',
      description: 'Top active inventory positions by cost capital.',
      category: 'INVENTORY',
      permission: null,
      canonicalService: 'OperationalIntelligenceService.getTopInventoryCapital',
      inputValidator: z.object({ limit }).strict(),
      outputValidator: z.object({
        asOf: z.string(),
        totalInventoryCapital: money,
        items: z.array(z.object({
          watchId: z.string(),
          label: z.string(),
          brand: z.string().nullable(),
          reference: z.string().nullable(),
          cost: money,
          percentOfInventoryCapital: money,
          ageDays: z.number().int(),
          status: z.string(),
        })),
        count: z.number().int(),
      }).passthrough(),
      execute: async (ctx, input) => {
        const data = await oi.getTopInventoryCapital(ctx.tenantId, { ...input, now: ctx.now });
        return { data, summary: `Top ${data.count} inventory capital positions` };
      },
    }),
    definition({
      name: 'get_top_debtors',
      description: 'Top outstanding AccountEntry debtors by currency (no FX mix).',
      category: 'ACCOUNTS',
      permission: null,
      canonicalService: 'OperationalIntelligenceService.getTopDebtors',
      inputValidator: z.object({ limit }).strict(),
      outputValidator: z.object({
        currencies: z.object({
          MXN: z.array(z.object({
            clientId: z.string().nullable(),
            clientLabel: z.string(),
            outstanding: money,
            openAccountCount: z.number().int(),
          })),
          USD: z.array(z.object({
            clientId: z.string().nullable(),
            clientLabel: z.string(),
            outstanding: money,
            openAccountCount: z.number().int(),
          })),
        }),
        totals: z.object({ MXN: money, USD: money }),
        limit: z.number().int(),
      }).passthrough(),
      execute: async (ctx, input) => {
        const data = await oi.getTopDebtors(ctx.tenantId, input);
        return { data, summary: `Top debtors MXN ${data.totals.MXN} / USD ${data.totals.USD}` };
      },
    }),
    definition({
      name: 'get_receivable_summary',
      description: 'CXC summary from AccountEntry only (no legacy Receivable, no aging).',
      category: 'ACCOUNTS',
      permission: null,
      canonicalService: 'OperationalIntelligenceService.getReceivableSummary',
      inputValidator: z.object({}).strict(),
      outputValidator: z.object({
        currencies: z.object({
          MXN: z.object({
            originalTotal: money,
            paidTotal: money,
            outstanding: money,
            openCount: z.number().int(),
            partialCount: z.number().int(),
            paidCount: z.number().int(),
            activeAccountCount: z.number().int(),
          }),
          USD: z.object({
            originalTotal: money,
            paidTotal: money,
            outstanding: money,
            openCount: z.number().int(),
            partialCount: z.number().int(),
            paidCount: z.number().int(),
            activeAccountCount: z.number().int(),
          }),
        }),
        source: z.string(),
        agingIncluded: z.boolean(),
      }).passthrough(),
      execute: async (ctx) => {
        const data = await oi.getReceivableSummary(ctx.tenantId);
        return {
          data,
          summary: `CXC outstanding MXN ${data.currencies.MXN.outstanding} / USD ${data.currencies.USD.outstanding}`,
        };
      },
    }),
    definition({
      name: 'get_sales_margin_summary',
      description: 'Gross margin summary (revenue − COGS). Not net profit.',
      category: 'ANALYTICS',
      permission: null,
      canonicalService: 'OperationalIntelligenceService.getSalesMarginSummary',
      inputValidator: z.object({ period, year, month, brand: z.string().trim().min(1).max(80).optional() }).strict(),
      outputValidator: z.object({
        period: z.string(),
        brand: z.string().nullable(),
        revenue: money,
        cogs: money,
        grossProfit: money,
        grossMarginPercent: money,
        unitsSold: z.number().int(),
        averageSalePrice: money,
        averageGrossProfit: money,
        definition: z.string(),
      }).passthrough(),
      execute: async (ctx, input) => {
        const data = await oi.getSalesMarginSummary(ctx.tenantId, { ...input, now: ctx.now });
        return { data, summary: `Gross profit ${data.period}: MXN ${data.grossProfit}` };
      },
    }),
    definition({
      name: 'get_profit_by_brand',
      description: 'Gross profit aggregated by watch brand.',
      category: 'ANALYTICS',
      permission: null,
      canonicalService: 'OperationalIntelligenceService.getProfitByBrand',
      inputValidator: z.object({ period, year, month, brand: z.string().trim().min(1).max(80).optional(), limit }).strict(),
      outputValidator: z.object({
        period: z.string(),
        items: z.array(z.object({
          brand: z.string(),
          unitsSold: z.number().int(),
          revenue: money,
          cogs: money,
          grossProfit: money,
          grossMarginPercent: money,
          averageProfitPerWatch: money,
        })),
        count: z.number().int(),
        definition: z.string(),
      }).passthrough(),
      execute: async (ctx, input) => {
        const data = await oi.getProfitByBrand(ctx.tenantId, { ...input, now: ctx.now });
        return { data, summary: `${data.count} brands ranked by gross profit` };
      },
    }),
    definition({
      name: 'get_top_sales',
      description: 'Top closed sales by gross profit, price, or margin %.',
      category: 'SALES',
      permission: null,
      canonicalService: 'OperationalIntelligenceService.getTopSales',
      inputValidator: z.object({
        period,
        year,
        month,
        sortBy: z.enum(['GROSS_PROFIT', 'AGREED_PRICE', 'GROSS_MARGIN_PERCENT']).optional(),
        limit,
        includeCustomerLabel: z.boolean().optional(),
      }).strict(),
      outputValidator: z.object({
        period: z.string(),
        sortBy: z.string(),
        items: z.array(z.object({
          dealId: z.string(),
          watchLabel: z.string(),
          customerLabel: z.string().nullable(),
          saleAmount: money,
          cost: money,
          grossProfit: money,
          grossMarginPercent: money,
          date: z.string(),
        })),
        count: z.number().int(),
      }).passthrough(),
      execute: async (ctx, input) => {
        const data = await oi.getTopSales(ctx.tenantId, { ...input, now: ctx.now });
        return { data, summary: `${data.count} top sales (${data.sortBy})` };
      },
    }),
    definition({
      name: 'get_attention_items',
      description: 'Deterministic operational attention items (facts/ratios only).',
      category: 'ANALYTICS',
      permission: null,
      canonicalService: 'OperationalIntelligenceService.getAttentionItems',
      inputValidator: z.object({ limit: z.number().int().min(1).max(8).optional() }).strict(),
      outputValidator: z.object({
        asOf: z.string(),
        items: z.array(z.object({
          type: z.string(),
          severity: z.enum(['INFO', 'WATCH', 'IMPORTANT']),
          title: z.string(),
          explanation: z.string(),
          evidence: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
          suggestedReadAction: z.string().optional(),
        })),
        count: z.number().int(),
        policyVersion: z.string(),
        note: z.string(),
      }).passthrough(),
      execute: async (ctx, input) => {
        const data = await oi.getAttentionItems(ctx.tenantId, { ...input, now: ctx.now });
        return { data, summary: `${data.count} attention items` };
      },
    }),
  ];
}
