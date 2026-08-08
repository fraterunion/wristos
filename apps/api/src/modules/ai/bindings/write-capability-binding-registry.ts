import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { BusinessCapability } from '../planner/planner.types';
import { RegisterReceivablePaymentWriteBinding } from './write/register-receivable-payment.binding';
import { RegisterSaleWriteBinding } from './write/register-sale.binding';
import { WriteCapabilityBindingDefinition } from './write/write-capability-binding-definition';

/**
 * Construction-time allowlist for WRITE capability bindings.
 * Commit 14B: exactly two bindings — REGISTER_SALE + REGISTER_RECEIVABLE_PAYMENT.
 * No dynamic registration API. No user-supplied binding names.
 */
@Injectable()
export class WriteCapabilityBindingRegistry implements OnModuleInit {
  private readonly bindings = new Map<BusinessCapability, WriteCapabilityBindingDefinition>();

  constructor(
    private readonly registerSale: RegisterSaleWriteBinding,
    private readonly registerReceivablePayment: RegisterReceivablePaymentWriteBinding,
  ) {}

  onModuleInit() {
    const bindings: WriteCapabilityBindingDefinition[] = [
      this.registerSale,
      this.registerReceivablePayment,
    ];
    if (new Set(bindings.map((b) => b.capability)).size !== bindings.length) {
      throw new Error('Duplicate write capability binding');
    }
    for (const binding of bindings) {
      if (binding.mode !== 'WRITE') {
        throw new Error(`Write binding mode mismatch: ${binding.capability}`);
      }
      this.bindings.set(binding.capability, binding);
    }
    if (
      this.bindings.size !== 2 ||
      !this.bindings.has('REGISTER_SALE') ||
      !this.bindings.has('REGISTER_RECEIVABLE_PAYMENT')
    ) {
      throw new Error(
        'WriteCapabilityBindingRegistry must contain exactly REGISTER_SALE and REGISTER_RECEIVABLE_PAYMENT',
      );
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
