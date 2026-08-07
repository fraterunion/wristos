import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AIController } from '../ai.controller';

describe('structured assistant architecture boundaries', () => {
  const source = (relative: string) => readFileSync(join(__dirname, relative), 'utf8');

  it('exposes one structured assistant endpoint and no generic execution endpoint', () => {
    const prototype = AIController.prototype as unknown as Record<string, object>;
    const routes = Object.getOwnPropertyNames(prototype).map((name) => ({ path: Reflect.getMetadata(PATH_METADATA, prototype[name]), method: Reflect.getMetadata(METHOD_METADATA, prototype[name]) }));
    expect(routes).toContainEqual({ path: 'assistant/structured', method: RequestMethod.POST });
    expect(routes.map((route) => route.path)).not.toEqual(expect.arrayContaining(['tools/execute', 'capabilities/execute', 'assistant/execute']));
  });

  it('keeps the orchestrator free of Prisma, tool registry, bindings and domain services', () => {
    const orchestrator = source('structured-assistant.service.ts');
    expect(orchestrator).not.toMatch(/PrismaService|ToolRegistry|CapabilityBinding(Service|Registry)|AnalyticsService|InventoryService|CrmService|CuentasService|HistoryService/);
  });

  it('keeps the planner tool and binding agnostic', () => {
    const planner = source('../planner/planner.service.ts');
    expect(planner).not.toMatch(/ToolDefinition|ToolRegistry|CapabilityBinding|toolName|toolVersion/);
  });

  it('contains an explicit read allowlist and no write execution path', () => {
    const orchestrator = source('structured-assistant.service.ts');
    expect(orchestrator).toContain("GET_INVENTORY_AGING");
    expect(orchestrator).toContain("GET_ATTENTION_ITEMS");
    expect(orchestrator).toContain("const READ_ACTIONS = new Set(['GET_LIQUIDITY', 'GET_MONTHLY_PROFIT', 'SEARCH_INVENTORY', 'SEARCH_CLIENT', 'GET_CLIENT_ACCOUNTS', 'GET_INVENTORY_AGING', 'GET_TOP_INVENTORY_CAPITAL', 'GET_TOP_DEBTORS', 'GET_RECEIVABLE_SUMMARY', 'GET_SALES_MARGIN_SUMMARY', 'GET_PROFIT_BY_BRAND', 'GET_TOP_SALES', 'GET_ATTENTION_ITEMS', 'GET_BUSINESS_SUMMARY'])");
    expect(orchestrator).toContain('Esta acción todavía no está habilitada para ejecución desde el asistente.');
  });
});
