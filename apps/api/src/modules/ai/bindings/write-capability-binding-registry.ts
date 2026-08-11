import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { BusinessCapability } from '../planner/planner.types';
import { CreateClientWriteBinding } from './write/create-client.binding';
import { CreatePayableWriteBinding } from './write/create-payable.binding';
import { CreateReceivableWriteBinding } from './write/create-receivable.binding';
import { RegisterCapitalContributionWriteBinding } from './write/register-capital-contribution.binding';
import { RegisterCapitalDistributionWriteBinding } from './write/register-capital-distribution.binding';
import { RegisterExpenseWriteBinding } from './write/register-expense.binding';
import { RegisterPayablePaymentWriteBinding } from './write/register-payable-payment.binding';
import { RegisterPurchaseWriteBinding } from './write/register-purchase.binding';
import { RegisterReceivablePaymentWriteBinding } from './write/register-receivable-payment.binding';
import { RegisterSaleWriteBinding } from './write/register-sale.binding';
import { RegisterTreasuryTransferWriteBinding } from './write/register-treasury-transfer.binding';
import { UpdateClientWriteBinding } from './write/update-client.binding';
import { ReverseExpenseWriteBinding } from './write/reverse-expense.binding';
import { WriteCapabilityBindingDefinition } from './write/write-capability-binding-definition';

/**
 * Construction-time allowlist for WRITE capability bindings.
 * Commit 26C: exactly thirteen bindings —
 * REGISTER_SALE + REGISTER_RECEIVABLE_PAYMENT + REGISTER_EXPENSE + REGISTER_PURCHASE
 * + CREATE_CLIENT + UPDATE_CLIENT + REGISTER_PAYABLE_PAYMENT + REGISTER_TREASURY_TRANSFER
 * + REGISTER_CAPITAL_CONTRIBUTION + REGISTER_CAPITAL_DISTRIBUTION
 * + CREATE_RECEIVABLE + CREATE_PAYABLE + REVERSE_EXPENSE.
 * No dynamic registration API. REVERSE_TREASURY_TRANSFER remains unbound.
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
    private readonly updateClient: UpdateClientWriteBinding,
    private readonly registerPayablePayment: RegisterPayablePaymentWriteBinding,
    private readonly registerTreasuryTransfer: RegisterTreasuryTransferWriteBinding,
    private readonly registerCapitalContribution: RegisterCapitalContributionWriteBinding,
    private readonly registerCapitalDistribution: RegisterCapitalDistributionWriteBinding,
    private readonly createReceivable: CreateReceivableWriteBinding,
    private readonly createPayable: CreatePayableWriteBinding,
    private readonly reverseExpense: ReverseExpenseWriteBinding,
  ) {}

  onModuleInit() {
    const bindings: WriteCapabilityBindingDefinition[] = [
      this.registerSale,
      this.registerReceivablePayment,
      this.registerExpense,
      this.registerPurchase,
      this.createClient,
      this.updateClient,
      this.registerPayablePayment,
      this.registerTreasuryTransfer,
      this.registerCapitalContribution,
      this.registerCapitalDistribution,
      this.createReceivable,
      this.createPayable,
      this.reverseExpense,
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
      this.bindings.size !== 13 ||
      !this.bindings.has('REGISTER_SALE') ||
      !this.bindings.has('REGISTER_RECEIVABLE_PAYMENT') ||
      !this.bindings.has('REGISTER_EXPENSE') ||
      !this.bindings.has('REGISTER_PURCHASE') ||
      !this.bindings.has('CREATE_CLIENT') ||
      !this.bindings.has('UPDATE_CLIENT') ||
      !this.bindings.has('REGISTER_PAYABLE_PAYMENT') ||
      !this.bindings.has('REGISTER_TREASURY_TRANSFER') ||
      !this.bindings.has('REGISTER_CAPITAL_CONTRIBUTION') ||
      !this.bindings.has('REGISTER_CAPITAL_DISTRIBUTION') ||
      !this.bindings.has('CREATE_RECEIVABLE') ||
      !this.bindings.has('CREATE_PAYABLE') ||
      !this.bindings.has('REVERSE_EXPENSE')
    ) {
      throw new Error(
        'WriteCapabilityBindingRegistry must contain exactly REGISTER_SALE, REGISTER_RECEIVABLE_PAYMENT, REGISTER_EXPENSE, REGISTER_PURCHASE, CREATE_CLIENT, UPDATE_CLIENT, REGISTER_PAYABLE_PAYMENT, REGISTER_TREASURY_TRANSFER, REGISTER_CAPITAL_CONTRIBUTION, REGISTER_CAPITAL_DISTRIBUTION, CREATE_RECEIVABLE, CREATE_PAYABLE, and REVERSE_EXPENSE',
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
