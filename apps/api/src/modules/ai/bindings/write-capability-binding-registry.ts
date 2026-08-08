import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { BusinessCapability } from '../planner/planner.types';
import { CreateClientWriteBinding } from './write/create-client.binding';
import { RegisterExpenseWriteBinding } from './write/register-expense.binding';
import { RegisterPurchaseWriteBinding } from './write/register-purchase.binding';
import { RegisterReceivablePaymentWriteBinding } from './write/register-receivable-payment.binding';
import { RegisterSaleWriteBinding } from './write/register-sale.binding';
import { WriteCapabilityBindingDefinition } from './write/write-capability-binding-definition';

/**
 * Construction-time allowlist for WRITE capability bindings.
 * Commit 18B: exactly five bindings —
 * REGISTER_SALE + REGISTER_RECEIVABLE_PAYMENT + REGISTER_EXPENSE + REGISTER_PURCHASE + CREATE_CLIENT.
 * No dynamic registration API. No user-supplied binding names.
 */
@Injectable()
export class WriteCapabilityBindingRegistry implements OnModuleInit {
  private readonly bindings = new Map<BusinessCapability, WriteCapabilityBindingDefinition>();

  constructor(
    private readonly registerSale: RegisterSaleWriteBinding,
    private readonly registerReceivablePayment: RegisterReceivablePaymentWriteBinding,
    private readonly registerExpense: RegisterExpenseWriteBinding,
    private readonly registerPurchase: RegisterPurchaseWriteBinding,
    private readonly createClient: CreateClientWriteBinding,
  ) {}

  onModuleInit() {
    const bindings: WriteCapabilityBindingDefinition[] = [
      this.registerSale,
      this.registerReceivablePayment,
      this.registerExpense,
      this.registerPurchase,
      this.createClient,
    ];
    if (new Set(bindings.map((b) => b.capability)).size !== bindings.length) {
      throw new Error('Duplicate write capability binding');
    }
    for (const binding of bindings) {
      if (binding.mode !== 'WRITE') {
        throw new Error(`Write binding mode mismatch: ${binding.capability}`);
      }
    }
    for (const binding of bindings) {
      this.bindings.set(binding.capability, binding);
    }
    if (
      this.bindings.size !== 5 ||
      !this.bindings.has('REGISTER_SALE') ||
      !this.bindings.has('REGISTER_RECEIVABLE_PAYMENT') ||
      !this.bindings.has('REGISTER_EXPENSE') ||
      !this.bindings.has('REGISTER_PURCHASE') ||
      !this.bindings.has('CREATE_CLIENT')
    ) {
      throw new Error(
        'WriteCapabilityBindingRegistry must contain exactly REGISTER_SALE, REGISTER_RECEIVABLE_PAYMENT, REGISTER_EXPENSE, REGISTER_PURCHASE, and CREATE_CLIENT',
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
