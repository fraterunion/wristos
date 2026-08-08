import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WriteCapabilityBindingRegistry } from '../write-capability-binding-registry';
import { RegisterExpenseWriteBinding } from '../write/register-expense.binding';
import { RegisterPurchaseWriteBinding } from '../write/register-purchase.binding';
import { RegisterReceivablePaymentWriteBinding } from '../write/register-receivable-payment.binding';
import { RegisterSaleWriteBinding } from '../write/register-sale.binding';

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
  const registry = new WriteCapabilityBindingRegistry(sale, payment, expense, purchase);
  registry.onModuleInit();
  return registry;
}

describe('WriteCapabilityBindingRegistry', () => {
  it('contains exactly four WRITE bindings: SALE + RECEIVABLE_PAYMENT + EXPENSE + PURCHASE', () => {
    const registry = buildRegistry();
    const bindings = registry.listBindings();
    expect(bindings).toHaveLength(4);
    expect(bindings.map((b) => b.capability).sort()).toEqual([
      'REGISTER_EXPENSE',
      'REGISTER_PURCHASE',
      'REGISTER_RECEIVABLE_PAYMENT',
      'REGISTER_SALE',
    ]);
    expect(bindings.every((b) => b.mode === 'WRITE')).toBe(true);
    expect(registry).not.toHaveProperty('register');
  });

  it.each(['REGISTER_SETTLEMENT', 'REGISTER_CRYPTO_POSITION', 'REGISTER_CRYPTO_PRICE'])(
    'keeps %s explicitly unbound for WRITE',
    (capability) => {
      const registry = buildRegistry();
      expect(registry.hasBinding(capability)).toBe(false);
      expect(() => registry.getBinding(capability)).toThrow(NotFoundException);
    },
  );

  it('rejects construction when REGISTER_PURCHASE is missing', () => {
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
    const wrong = {
      capability: 'REGISTER_SETTLEMENT',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'x',
    } as never;
    const registry = new WriteCapabilityBindingRegistry(sale, payment, expense, wrong);
    expect(() => registry.onModuleInit()).toThrow(
      /exactly REGISTER_SALE, REGISTER_RECEIVABLE_PAYMENT, REGISTER_EXPENSE, and REGISTER_PURCHASE/,
    );
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
