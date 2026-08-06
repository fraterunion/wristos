import { z } from 'zod';
import { CapabilityBindingDefinition } from '../capability-binding-definition';
import { BusinessCapability, BusinessPlanStep } from '../../planner/planner.types';
import { ToolResult } from '../../tools/tool-definition';

const limit = z.number().int().min(1).max(50).optional();
const schemas = {
  GET_LIQUIDITY: z.object({}).strict(),
  GET_MONTHLY_PROFIT: z.object({ year: z.number().int().min(2000).max(2200), month: z.number().int().min(1).max(12) }).strict(),
  SEARCH_INVENTORY: z.object({ query: z.string().trim().min(1).max(120), status: z.enum(['AVAILABLE', 'RESERVED', 'ALL']).optional(), limit }).strict(),
  SEARCH_CLIENT: z.object({ query: z.string().trim().min(1).max(120), limit }).strict(),
  GET_CLIENT_ACCOUNTS: z.object({ clientId: z.string().min(1), type: z.enum(['RECEIVABLE', 'PAYABLE', 'ALL']).optional(), status: z.enum(['OPEN', 'PARTIAL', 'PAID', 'ALL']).optional() }).strict(),
} as const;

const toolNames: Record<keyof typeof schemas, string> = {
  GET_LIQUIDITY: 'get_liquidity',
  GET_MONTHLY_PROFIT: 'get_monthly_profit',
  SEARCH_INVENTORY: 'search_inventory',
  SEARCH_CLIENT: 'search_clients',
  GET_CLIENT_ACCOUNTS: 'get_client_accounts',
};

const binding = <C extends keyof typeof schemas>(capability: C): CapabilityBindingDefinition => {
  const definition: CapabilityBindingDefinition = {
    capability: capability as BusinessCapability,
    version: '1.0.0',
    mode: 'READ',
    toolName: toolNames[capability],
    toolVersion: '1.0.0',
    inputSchema: schemas[capability],
    inputMapper: (step: BusinessPlanStep) => schemas[capability].parse(step.arguments),
    outputMapper: (result: ToolResult) => ({ capability: capability as BusinessCapability, bindingVersion: '1.0.0', toolName: result.toolName, toolVersion: result.toolVersion, success: true, data: result.data, summary: result.summary, warnings: [...result.warnings], sourceMetadata: result.sourceMetadata, executedAt: result.executedAt, durationMs: result.durationMs, traceId: result.traceId }),
  };
  return Object.freeze(definition);
};

export const READ_CAPABILITY_BINDINGS: readonly CapabilityBindingDefinition[] = Object.freeze((Object.keys(schemas) as Array<keyof typeof schemas>).map(binding));
