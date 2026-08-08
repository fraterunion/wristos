import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WriteCapabilityBindingRegistry } from '../write-capability-binding-registry';
import { RegisterReceivablePaymentWriteBinding } from '../write/register-receivable-payment.binding';
import { RegisterSaleWriteBinding } from '../write/register-sale.binding';

describe('WriteCapabilityBindingRegistry', () => {
  it('contains exactly two WRITE bindings: REGISTER_SALE + REGISTER_RECEIVABLE_PAYMENT', () => {
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
    const registry = new WriteCapabilityBindingRegistry(sale, payment);
    registry.onModuleInit();
    const bindings = registry.listBindings();
    expect(bindings).toHaveLength(2);
    expect(bindings.map((b) => b.capability).sort()).toEqual([
      'REGISTER_RECEIVABLE_PAYMENT',
      'REGISTER_SALE',
    ]);
    expect(bindings.every((b) => b.mode === 'WRITE')).toBe(true);
    expect(registry).not.toHaveProperty('register');
  });

  it.each([
    'REGISTER_PURCHASE',
    'REGISTER_EXPENSE',
    'REGISTER_SETTLEMENT',
    'REGISTER_CRYPTO_POSITION',
    'REGISTER_CRYPTO_PRICE',
  ])('keeps %s explicitly unbound for WRITE', (capability) => {
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
    const registry = new WriteCapabilityBindingRegistry(sale, payment);
    registry.onModuleInit();
    expect(registry.hasBinding(capability)).toBe(false);
    expect(() => registry.getBinding(capability)).toThrow(NotFoundException);
  });

  it('rejects construction when REGISTER_RECEIVABLE_PAYMENT is missing', () => {
    const sale = Object.assign(new RegisterSaleWriteBinding({} as never, {} as never), {
      capability: 'REGISTER_SALE',
      mode: 'WRITE',
    });
    const wrong = {
      capability: 'REGISTER_EXPENSE',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'x',
    } as never;
    const registry = new WriteCapabilityBindingRegistry(sale, wrong);
    expect(() => registry.onModuleInit()).toThrow(
      /exactly REGISTER_SALE and REGISTER_RECEIVABLE_PAYMENT/,
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

describe('WritePlanRunner fail-closed unbound', () => {
  it('documents that unbound writes throw Forbidden via registry', () => {
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
    const registry = new WriteCapabilityBindingRegistry(sale, payment);
    registry.onModuleInit();
    expect(() => registry.getBinding('REGISTER_PURCHASE')).toThrow(NotFoundException);
    expect(() => {
      throw new ForbiddenException('This write capability is not bound for conversational execution');
    }).toThrow(ForbiddenException);
  });
});
