import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AnalyticsService } from '../../analytics/analytics.service';
import { CrmService } from '../../crm/crm.service';
import { CuentasService } from '../../cuentas/cuentas.service';
import { HistoryService } from '../../history/history.service';
import { InventoryService } from '../../inventory/inventory.service';
import { OperationalIntelligenceService } from '../operational-intelligence/operational-intelligence.service';
import { WatchInventoryResolver } from '../watch-intelligence/watch-inventory-resolver.service';
import { createOperationalIntelligenceTools } from './read/operational-intelligence-tools';
import { createReadTools } from './read/read-tools';
import { ToolDefinition } from './tool-definition';

@Injectable()
export class ToolRegistry {
  private readonly definitions: ReadonlyMap<string, ToolDefinition>;
  constructor(
    analytics: AnalyticsService,
    inventory: InventoryService,
    crm: CrmService,
    cuentas: CuentasService,
    history: HistoryService,
    operationalIntelligence: OperationalIntelligenceService,
    watchInventory: WatchInventoryResolver,
  ) {
    const tools = [
      ...createReadTools(analytics, inventory, crm, cuentas, history, watchInventory),
      ...createOperationalIntelligenceTools(operationalIntelligence),
    ];
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
      throw new BadRequestException('Duplicate AI tool name');
    }
    this.definitions = new Map(tools.map((tool) => [tool.name, tool]));
  }
  getDefinition(name: string) {
    const tool = this.definitions.get(name);
    if (!tool) throw new NotFoundException('Unknown AI tool');
    return tool;
  }
  listDefinitions() {
    return [...this.definitions.values()]
      .map(({ execute: _execute, inputValidator: _input, outputValidator: _output, ...metadata }) => metadata)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
