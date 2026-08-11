import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WriteCapabilityBindingRegistry } from '../write-capability-binding-registry';
import { CreateClientWriteBinding } from '../write/create-client.binding';
import { RegisterExpenseWriteBinding } from '../write/register-expense.binding';
import { RegisterPurchaseWriteBinding } from '../write/register-purchase.binding';
import { RegisterPayablePaymentWriteBinding } from '../write/register-payable-payment.binding';
import { RegisterReceivablePaymentWriteBinding } from '../write/register-receivable-payment.binding';
import { RegisterSaleWriteBinding } from '../write/register-sale.binding';
import { RegisterTreasuryTransferWriteBinding } from '../write/register-treasury-transfer.binding';
import { RegisterCapitalContributionWriteBinding } from '../write/register-capital-contribution.binding';
import { RegisterCapitalDistributionWriteBinding } from '../write/register-capital-distribution.binding';
import { CreateReceivableWriteBinding } from '../write/create-receivable.binding';
import { CreatePayableWriteBinding } from '../write/create-payable.binding';
import { UpdateClientWriteBinding } from '../write/update-client.binding';
import { ReverseExpenseWriteBinding } from '../write/reverse-expense.binding';
import { ReverseTreasuryTransferWriteBinding } from '../write/reverse-treasury-transfer.binding';

function stubReverseTreasuryTransfer() {
  return Object.assign(
    new ReverseTreasuryTransferWriteBinding({} as never, {} as never, {} as never),
    {
      capability: 'REVERSE_TREASURY_TRANSFER' as const,
      version: '1.0.0',
      mode: 'WRITE' as const,
      bindingName: 'reverse_treasury_transfer_canonical@1.0.0',
    },
  );
}

function buildRegistry() {
  const sale = Object.assign(new RegisterSaleWriteBinding({} as never, {} as never), {
    capability: 'REGISTER_SALE',
    version: '1.0.0',
    mode: 'WRITE',
    bindingName: 'register_sale_canonical@1.0.0',
  });
  const payment = Object.assign(
    new RegisterReceivablePaymentWriteBinding({} as never, {} as never),
    {
      capability: 'REGISTER_RECEIVABLE_PAYMENT',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'register_receivable_payment_canonical@1.0.0',
    },
  );
  const expense = Object.assign(new RegisterExpenseWriteBinding({} as never, {} as never), {
    capability: 'REGISTER_EXPENSE',
    version: '1.0.0',
    mode: 'WRITE',
    bindingName: 'register_expense_canonical@1.0.0',
  });
  const purchase = Object.assign(new RegisterPurchaseWriteBinding({} as never, {} as never), {
    capability: 'REGISTER_PURCHASE',
    version: '1.0.0',
    mode: 'WRITE',
    bindingName: 'register_purchase_canonical@1.0.0',
  });
  const createClient = Object.assign(new CreateClientWriteBinding({} as never, {} as never), {
    capability: 'CREATE_CLIENT',
    version: '1.0.0',
    mode: 'WRITE',
    bindingName: 'create_client_canonical@1.0.0',
  });
  const updateClient = Object.assign(new UpdateClientWriteBinding({} as never, {} as never), {
    capability: 'UPDATE_CLIENT',
    version: '1.0.0',
    mode: 'WRITE',
    bindingName: 'update_client_canonical@1.0.0',
  });
  const payablePayment = Object.assign(
    new RegisterPayablePaymentWriteBinding({} as never, {} as never),
    {
      capability: 'REGISTER_PAYABLE_PAYMENT',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'register_payable_payment_canonical@1.0.0',
    },
  );
  const treasuryTransfer = Object.assign(
    new RegisterTreasuryTransferWriteBinding({} as never, {} as never),
    {
      capability: 'REGISTER_TREASURY_TRANSFER',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'register_treasury_transfer_canonical@1.0.0',
    },
  );
  const capitalContribution = Object.assign(
    new RegisterCapitalContributionWriteBinding({} as never, {} as never),
    {
      capability: 'REGISTER_CAPITAL_CONTRIBUTION',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'register_capital_contribution_canonical@1.0.0',
    },
  );
  const capitalDistribution = Object.assign(
    new RegisterCapitalDistributionWriteBinding({} as never, {} as never, {} as never),
    {
      capability: 'REGISTER_CAPITAL_DISTRIBUTION',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'register_capital_distribution_canonical@1.0.0',
    },
  );
  const createReceivable = Object.assign(
    new CreateReceivableWriteBinding({} as never, {} as never),
    {
      capability: 'CREATE_RECEIVABLE',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'create_receivable_canonical@1.0.0',
    },
  );
  const createPayable = Object.assign(
    new CreatePayableWriteBinding({} as never, {} as never),
    {
      capability: 'CREATE_PAYABLE',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'create_payable_canonical@1.0.0',
    },
  );
  const reverseExpense = Object.assign(
    new ReverseExpenseWriteBinding({} as never, {} as never, {} as never),
    {
      capability: 'REVERSE_EXPENSE',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'reverse_expense_canonical@1.0.0',
    },
  );
  const reverseTreasuryTransfer = Object.assign(
    new ReverseTreasuryTransferWriteBinding({} as never, {} as never, {} as never),
    {
      capability: 'REVERSE_TREASURY_TRANSFER',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'reverse_treasury_transfer_canonical@1.0.0',
    },
  );
  const registry = new WriteCapabilityBindingRegistry(
    sale,
    payment,
    expense,
    purchase,
    createClient,
    updateClient,
    payablePayment,
    treasuryTransfer,
    capitalContribution,
    capitalDistribution,
    createReceivable,
    createPayable,
    reverseExpense,
    reverseTreasuryTransfer,
  );
  registry.onModuleInit();
  return registry;
}

describe('WriteCapabilityBindingRegistry', () => {
  it('contains exactly fourteen WRITE bindings including REVERSE_EXPENSE', () => {
    const registry = buildRegistry();
    const bindings = registry.listBindings();
    expect(bindings).toHaveLength(14);
    expect(bindings.map((b) => b.capability).sort()).toEqual([
      'CREATE_CLIENT',
      'CREATE_PAYABLE',
      'CREATE_RECEIVABLE',
      'REGISTER_CAPITAL_CONTRIBUTION',
      'REGISTER_CAPITAL_DISTRIBUTION',
      'REGISTER_EXPENSE',
      'REGISTER_PAYABLE_PAYMENT',
      'REGISTER_PURCHASE',
      'REGISTER_RECEIVABLE_PAYMENT',
      'REGISTER_SALE',
      'REGISTER_TREASURY_TRANSFER',
      'REVERSE_EXPENSE',
      'REVERSE_TREASURY_TRANSFER',
      'UPDATE_CLIENT',
    ]);
    expect(bindings.every((b) => b.mode === 'WRITE')).toBe(true);
    expect(registry).not.toHaveProperty('register');
  });

  it.each([
    'REGISTER_SETTLEMENT',
    'REGISTER_CRYPTO_POSITION',
    'REGISTER_CRYPTO_PRICE',
    'DELETE_CLIENT',
    'MERGE_CLIENT',
  ])('keeps %s explicitly unbound for WRITE', (capability) => {
    const registry = buildRegistry();
    expect(registry.hasBinding(capability)).toBe(false);
    expect(() => registry.getBinding(capability)).toThrow(NotFoundException);
  });

  it('rejects construction when UPDATE_CLIENT is missing', () => {
    const sale = Object.assign(new RegisterSaleWriteBinding({} as never, {} as never), {
      capability: 'REGISTER_SALE',
      mode: 'WRITE',
    });
    const payment = Object.assign(
      new RegisterReceivablePaymentWriteBinding({} as never, {} as never),
      {
        capability: 'REGISTER_RECEIVABLE_PAYMENT',
        mode: 'WRITE',
      },
    );
    const expense = Object.assign(new RegisterExpenseWriteBinding({} as never, {} as never), {
      capability: 'REGISTER_EXPENSE',
      mode: 'WRITE',
    });
    const purchase = Object.assign(new RegisterPurchaseWriteBinding({} as never, {} as never), {
      capability: 'REGISTER_PURCHASE',
      mode: 'WRITE',
    });
    const createClient = Object.assign(new CreateClientWriteBinding({} as never, {} as never), {
      capability: 'CREATE_CLIENT',
      mode: 'WRITE',
    });
    const payablePayment = Object.assign(
      new RegisterPayablePaymentWriteBinding({} as never, {} as never),
      {
        capability: 'REGISTER_PAYABLE_PAYMENT',
        mode: 'WRITE',
      },
    );
    const treasuryTransfer = Object.assign(
      new RegisterTreasuryTransferWriteBinding({} as never, {} as never),
      {
        capability: 'REGISTER_TREASURY_TRANSFER',
        mode: 'WRITE',
      },
    );
    const capitalContribution = Object.assign(
      new RegisterCapitalContributionWriteBinding({} as never, {} as never),
      {
        capability: 'REGISTER_CAPITAL_CONTRIBUTION',
        mode: 'WRITE',
      },
    );
    const capitalDistribution = Object.assign(
      new RegisterCapitalDistributionWriteBinding({} as never, {} as never, {} as never),
      {
        capability: 'REGISTER_CAPITAL_DISTRIBUTION',
        mode: 'WRITE',
      },
    );
    const createReceivable = Object.assign(
      new CreateReceivableWriteBinding({} as never, {} as never),
      {
        capability: 'CREATE_RECEIVABLE',
        mode: 'WRITE',
      },
    );
    const createPayable = Object.assign(
      new CreatePayableWriteBinding({} as never, {} as never),
      {
        capability: 'CREATE_PAYABLE',
        mode: 'WRITE',
      },
    );
    const reverseExpense = Object.assign(
      new ReverseExpenseWriteBinding({} as never, {} as never, {} as never),
      {
        capability: 'REVERSE_EXPENSE',
        mode: 'WRITE',
      },
    );
    const wrong = {
      capability: 'REGISTER_SETTLEMENT',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'x',
    } as never;
    const registry = new WriteCapabilityBindingRegistry(
      sale,
      payment,
      expense,
      purchase,
      createClient,
      wrong,
      payablePayment,
      treasuryTransfer,
      capitalContribution,
      capitalDistribution,
      createReceivable,
      createPayable,
      reverseExpense,
    stubReverseTreasuryTransfer(),
    );
    expect(() => registry.onModuleInit()).toThrow(
      /REVERSE_EXPENSE|UPDATE_CLIENT|CREATE_PAYABLE/,
    );
  });
});

describe('UpdateClientWriteBinding mapInput', () => {
  const binding = new UpdateClientWriteBinding({} as never, {} as never);
  const context = {
    tenantId: 't1',
    userId: 'u1',
    permissions: [],
    conversationId: 'c1',
    workspaceId: null,
    actionRunId: 'run-upd-1',
    requestId: 'r1',
    locale: 'es-MX',
    timezone: 'UTC',
    now: new Date('2026-08-08T00:00:00Z'),
    planFingerprint: 'a'.repeat(64),
  };

  it('maps materialized final patch + expectedUpdatedAt', () => {
    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'UPDATE_CLIENT',
        arguments: {
          clientId: 'client-1',
          expectedUpdatedAt: '2026-08-08T12:00:00.000Z',
          patchPhone: '+525512345678',
          patchNotes: 'base\nprefiere AP',
          operations: ['SET_PHONE', 'APPEND_NOTES'],
          changedFields: ['phone', 'notes'],
        },
        dependsOn: [],
        estimatedEffects: [],
        reversibility: 'NONE',
      },
      context,
    );
    expect(input.clientId).toBe('client-1');
    expect(input.expectedUpdatedAt).toBe('2026-08-08T12:00:00.000Z');
    expect(input.patch.phone).toBe('+525512345678');
    expect(input.patch.notes).toBe('base\nprefiere AP');
  });

  it('rejects missing expectedUpdatedAt', () => {
    expect(() =>
      binding.mapInput(
        {
          stepId: 's1',
          capability: 'UPDATE_CLIENT',
          arguments: { clientId: 'c1', patchPhone: '+525512345678' },
          dependsOn: [],
          estimatedEffects: [],
          reversibility: 'NONE',
        },
        context,
      ),
    ).toThrow(/expectedUpdatedAt/);
  });
});

describe('CreateClientWriteBinding mapInput', () => {
  const binding = new CreateClientWriteBinding({} as never, {} as never);
  const context = {
    tenantId: 't1',
    userId: 'u1',
    permissions: [],
    conversationId: 'c1',
    workspaceId: null,
    actionRunId: 'run-client-1',
    requestId: 'r1',
    locale: 'es-MX',
    timezone: 'UTC',
    now: new Date('2026-08-08T00:00:00Z'),
    planFingerprint: 'a'.repeat(64),
  };

  it('derives registerIdempotencyKey from actionRunId only and normalizes identity', () => {
    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'CREATE_CLIENT',
        arguments: {
          name: '  José   Hernández ',
          email: 'Jose@Email.COM',
          phone: '55 1234 5678',
          registerIdempotencyKey: 'client-forged',
        },
        dependsOn: [],
        estimatedEffects: [],
        reversibility: 'NONE',
      },
      context,
    );
    expect(input.registerIdempotencyKey).toBe('ai-action-run:run-client-1');
    expect(input.name).toBe('José Hernández');
    expect(input.email).toBe('jose@email.com');
    expect(input.phone).toBe('+525512345678');
  });

  it('rejects empty name', () => {
    expect(() =>
      binding.mapInput(
        {
          stepId: 's1',
          capability: 'CREATE_CLIENT',
          arguments: { name: '   ' },
          dependsOn: [],
          estimatedEffects: [],
          reversibility: 'NONE',
        },
        context,
      ),
    ).toThrow(/requires name/);
  });
});

describe('RegisterSaleWriteBinding mapInput', () => {
  const binding = new RegisterSaleWriteBinding({} as never, {} as never);
  const context = {
    tenantId: 't1',
    userId: 'u1',
    permissions: [],
    conversationId: 'c1',
    workspaceId: null,
    actionRunId: 'run-abc',
    requestId: 'r1',
    locale: 'es-MX',
    timezone: 'UTC',
    now: new Date('2026-08-07T00:00:00Z'),
    planFingerprint: 'a'.repeat(64),
  };

  it('derives registerIdempotencyKey from actionRunId only', () => {
    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'REGISTER_SALE',
        arguments: {
          watchId: 'w1',
          customerId: 'c1',
          price: 350000,
          currency: 'MXN',
          paymentMode: 'CREDIT',
          registerIdempotencyKey: 'forged-from-client',
        },
        dependsOn: [],
        estimatedEffects: [],
        reversibility: 'NONE',
      },
      context,
    );
    expect(input.registerIdempotencyKey).toBe('ai-action-run:run-abc');
    expect(input.paymentMode).toBe('CREDIT');
    expect(input.destination).toBeUndefined();
  });

  it('maps PAID BANCOS with bankChannel', () => {
    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'REGISTER_SALE',
        arguments: {
          watchId: 'w1',
          customerId: 'c1',
          price: '100000',
          currency: 'MXN',
          paymentMode: 'PAID',
          amountReceived: '100000',
          destination: 'BANCOS',
          bankChannel: 'JOSE',
        },
        dependsOn: [],
        estimatedEffects: [],
        reversibility: 'NONE',
      },
      context,
    );
    expect(input.paymentMode).toBe('PAID');
    expect(input.destination).toBe('BANCOS');
    expect(input.bankChannel).toBe('JOSE');
    expect(input.amountReceived).toBe(100000);
  });
});

describe('RegisterReceivablePaymentWriteBinding mapInput', () => {
  const binding = new RegisterReceivablePaymentWriteBinding({} as never, {} as never);
  const context = {
    tenantId: 't1',
    userId: 'u1',
    permissions: [],
    conversationId: 'c1',
    workspaceId: null,
    actionRunId: 'run-pay-1',
    requestId: 'r1',
    locale: 'es-MX',
    timezone: 'UTC',
    now: new Date('2026-08-08T00:00:00Z'),
    planFingerprint: 'b'.repeat(64),
  };

  it('derives registerIdempotencyKey from actionRunId only', () => {
    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'REGISTER_RECEIVABLE_PAYMENT',
        arguments: {
          accountId: 'entry-1',
          amount: '35000.00',
          destination: 'BANK',
          registerIdempotencyKey: 'forged',
        },
        dependsOn: [],
        estimatedEffects: [],
        reversibility: 'NONE',
      },
      context,
    );
    expect(input.registerIdempotencyKey).toBe('ai-action-run:run-pay-1');
    expect(input.receivableEntryId).toBe('entry-1');
    expect(input.destination).toBe('BANK');
    expect(input.amount).toBe(35000);
  });

  it('maps APPLY_TO_PAYABLE with payableAccountId', () => {
    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'REGISTER_RECEIVABLE_PAYMENT',
        arguments: {
          receivableEntryId: 'cxc-1',
          amount: 100000,
          destination: 'APPLY_TO_PAYABLE',
          payableAccountId: 'cxp-1',
        },
        dependsOn: [],
        estimatedEffects: [],
        reversibility: 'NONE',
      },
      context,
    );
    expect(input.payableEntryId).toBe('cxp-1');
    expect(input.destination).toBe('APPLY_TO_PAYABLE');
  });
});

describe('RegisterExpenseWriteBinding mapInput', () => {
  const binding = new RegisterExpenseWriteBinding({} as never, {} as never);
  const context = {
    tenantId: 't1',
    userId: 'u1',
    permissions: [],
    conversationId: 'c1',
    workspaceId: null,
    actionRunId: 'run-exp-1',
    requestId: 'r1',
    locale: 'es-MX',
    timezone: 'UTC',
    now: new Date('2026-08-08T00:00:00Z'),
    planFingerprint: 'c'.repeat(64),
  };

  it('derives registerIdempotencyKey from actionRunId only and maps gasoline cash', () => {
    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'REGISTER_EXPENSE',
        arguments: {
          amount: '2500',
          currency: 'MXN',
          category: 'GASOLINE',
          source: 'CASH',
          expenseDate: '2026-08-08',
          concept: 'Gasolina',
          registerIdempotencyKey: 'forged',
        },
        dependsOn: [],
        estimatedEffects: [],
        reversibility: 'NONE',
      },
      context,
    );
    expect(input.registerIdempotencyKey).toBe('ai-action-run:run-exp-1');
    expect(input.category).toBe('GASOLINE');
    expect(input.source).toBe('CASH');
    expect(input.amount).toBe(2500);
    expect(input.currency).toBe('MXN');
  });

  it('maps rent concept to OTHER via resolver', () => {
    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'REGISTER_EXPENSE',
        arguments: {
          amount: 18000,
          currency: 'MXN',
          source: 'BANK',
          expenseDate: '2026-08-08',
          concept: 'renta',
        },
        dependsOn: [],
        estimatedEffects: [],
        reversibility: 'NONE',
      },
      context,
    );
    expect(input.category).toBe('OTHER');
    expect(input.concept).toMatch(/renta/i);
    expect(input.source).toBe('BANK');
  });
});

describe('RegisterPurchaseWriteBinding mapInput', () => {
  const binding = new RegisterPurchaseWriteBinding({} as never, {} as never);
  const context = {
    tenantId: 't1',
    userId: 'u1',
    permissions: [],
    conversationId: 'c1',
    workspaceId: null,
    actionRunId: 'run-purchase-1',
    requestId: 'r1',
    locale: 'es-MX',
    timezone: 'UTC',
    now: new Date('2026-08-08T00:00:00Z'),
    planFingerprint: 'd'.repeat(64),
  };

  it('derives registerIdempotencyKey from actionRunId only', () => {
    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'REGISTER_PURCHASE',
        arguments: {
          brand: 'Rolex',
          model: 'GMT-Master II Batman',
          cost: 280000,
          currency: 'MXN',
          paymentMode: 'PAID',
          sourceAccount: 'BANK',
          acquiredAt: '2026-08-08',
          condition: 'Bueno',
          status: 'AVAILABLE',
          registerIdempotencyKey: 'forged',
        },
        dependsOn: [],
        estimatedEffects: [],
        reversibility: 'NONE',
      },
      context,
    );
    expect(input.registerIdempotencyKey).toBe('ai-action-run:run-purchase-1');
    expect(input.paymentMode).toBe('PAID');
    expect(input.sourceAccount).toBe('BANK');
    expect(input.purchaseAmount).toBe(280000);
  });

  it('maps CREDIT with sellerCounterpartyName and no source', () => {
    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'REGISTER_PURCHASE',
        arguments: {
          brand: 'Rolex',
          model: 'Daytona',
          cost: '350000',
          currency: 'MXN',
          paymentMode: 'CREDIT',
          sellerCounterpartyName: 'José',
          acquiredAt: '2026-08-08',
          condition: 'Bueno',
        },
        dependsOn: [],
        estimatedEffects: [],
        reversibility: 'NONE',
      },
      context,
    );
    expect(input.paymentMode).toBe('CREDIT');
    expect(input.sourceAccount).toBeNull();
    expect(input.sellerCounterpartyName).toBe('José');
  });

  it('requires sourceAccount for PAID', () => {
    expect(() =>
      binding.mapInput(
        {
          stepId: 's1',
          capability: 'REGISTER_PURCHASE',
          arguments: {
            brand: 'Rolex',
            model: 'Batman',
            cost: 280000,
            currency: 'MXN',
            paymentMode: 'PAID',
            acquiredAt: '2026-08-08',
            condition: 'Bueno',
          },
          dependsOn: [],
          estimatedEffects: [],
          reversibility: 'NONE',
        },
        context,
      ),
    ).toThrow(/sourceAccount/);
  });
});

describe('WritePlanRunner fail-closed unbound', () => {
  it('documents that unbound writes throw Forbidden via registry', () => {
    const registry = buildRegistry();
    expect(() => registry.getBinding('REGISTER_SETTLEMENT')).toThrow(NotFoundException);
    expect(() => {
      throw new ForbiddenException('This write capability is not bound for conversational execution');
    }).toThrow(ForbiddenException);
  });
});
