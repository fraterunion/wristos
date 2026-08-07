import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { BusinessCapability } from '../planner/planner.types';
import { RegisterSaleWriteBinding } from './write/register-sale.binding';
import { WriteCapabilityBindingDefinition } from './write/write-capability-binding-definition';

/**
 * Construction-time allowlist for WRITE capability bindings.
 * Commit 12B: exactly one binding — REGISTER_SALE.
 * No dynamic registration API. No user-supplied binding names.
 */
@Injectable()
export class WriteCapabilityBindingRegistry implements OnModuleInit {
  private readonly bindings = new Map<BusinessCapability, WriteCapabilityBindingDefinition>();

  constructor(private readonly registerSale: RegisterSaleWriteBinding) {}

  onModuleInit() {
    const bindings: WriteCapabilityBindingDefinition[] = [this.registerSale];
    if (new Set(bindings.map((b) => b.capability)).size !== bindings.length) {
      throw new Error('Duplicate write capability binding');
    }
    for (const binding of bindings) {
      if (binding.mode !== 'WRITE') {
        throw new Error(`Write binding mode mismatch: ${binding.capability}`);
      }
      this.bindings.set(binding.capability, binding);
    }
    if (this.bindings.size !== 1 || !this.bindings.has('REGISTER_SALE')) {
      throw new Error('WriteCapabilityBindingRegistry must contain exactly REGISTER_SALE');
    }
  }

  getBinding(capability: BusinessCapability | string): WriteCapabilityBindingDefinition {
    const binding = this.bindings.get(capability as BusinessCapability);
    if (!binding) {
      throw new NotFoundException(`Write capability is not bound: ${capability}`);
    }
    return binding;
  }

  hasBinding(capability: BusinessCapability | string): boolean {
    return this.bindings.has(capability as BusinessCapability);
  }

  listBindings(): readonly WriteCapabilityBindingDefinition[] {
    return [...this.bindings.values()];
  }
}
