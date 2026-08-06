import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessCapability } from '../planner/planner.types';
import { ToolRegistry } from '../tools/tool-registry';
import { CapabilityBindingDefinition } from './capability-binding-definition';
import { READ_CAPABILITY_BINDINGS } from './read/read-bindings';

@Injectable()
export class CapabilityBindingRegistry {
  private readonly bindings: ReadonlyMap<BusinessCapability, CapabilityBindingDefinition>;

  constructor(toolRegistry: ToolRegistry) {
    if (new Set(READ_CAPABILITY_BINDINGS.map((entry) => entry.capability)).size !== READ_CAPABILITY_BINDINGS.length) throw new BadRequestException('Duplicate business capability binding');
    for (const binding of READ_CAPABILITY_BINDINGS) {
      if (binding.mode !== 'READ') throw new BadRequestException(`Capability binding mode mismatch: ${binding.capability}`);
      const tool = toolRegistry.getDefinition(binding.toolName);
      if (tool.name !== binding.toolName || tool.version !== binding.toolVersion || tool.mode !== binding.mode) throw new BadRequestException(`Capability binding target mismatch: ${binding.capability}`);
    }
    this.bindings = new Map(READ_CAPABILITY_BINDINGS.map((entry) => [entry.capability, entry]));
  }

  getBinding(capability: BusinessCapability | string): CapabilityBindingDefinition {
    const binding = this.bindings.get(capability as BusinessCapability);
    if (!binding) throw new NotFoundException(`Business capability is not bound: ${capability}`);
    return binding;
  }

  hasBinding(capability: BusinessCapability | string): boolean {
    return this.bindings.has(capability as BusinessCapability);
  }

  listBindings(): readonly CapabilityBindingDefinition[] {
    return [...this.bindings.values()];
  }
}
