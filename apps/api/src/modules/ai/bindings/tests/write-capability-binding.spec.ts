import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WriteCapabilityBindingRegistry } from '../write-capability-binding-registry';
import { RegisterSaleWriteBinding } from '../write/register-sale.binding';

describe('WriteCapabilityBindingRegistry', () => {
  it('contains exactly one WRITE binding: REGISTER_SALE', () => {
    const sale = Object.assign(new RegisterSaleWriteBinding({} as never, {} as never), {
      capability: 'REGISTER_SALE',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'register_sale_canonical@1.0.0',
    });
    const registry = new WriteCapabilityBindingRegistry(sale);
    registry.onModuleInit();
    const bindings = registry.listBindings();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.capability).toBe('REGISTER_SALE');
    expect(bindings[0]!.mode).toBe('WRITE');
    expect(registry).not.toHaveProperty('register');
  });

  it.each([
    'REGISTER_RECEIVABLE_PAYMENT',
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
    const registry = new WriteCapabilityBindingRegistry(sale);
    registry.onModuleInit();
    expect(registry.hasBinding(capability)).toBe(false);
    expect(() => registry.getBinding(capability)).toThrow(NotFoundException);
  });

  it('rejects construction when REGISTER_SALE is missing', () => {
    const wrong = {
      capability: 'REGISTER_EXPENSE',
      version: '1.0.0',
      mode: 'WRITE',
      bindingName: 'x',
    } as never;
    const registry = new WriteCapabilityBindingRegistry(wrong);
    expect(() => registry.onModuleInit()).toThrow(/exactly REGISTER_SALE/);
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

describe('WritePlanRunner fail-closed unbound', () => {
  it('documents that unbound writes throw Forbidden via registry', () => {
    const sale = Object.assign(new RegisterSaleWriteBinding({} as never, {} as never), {
      capability: 'REGISTER_SALE',
      mode: 'WRITE',
    });
    const registry = new WriteCapabilityBindingRegistry(sale);
    registry.onModuleInit();
    expect(() => registry.getBinding('REGISTER_PURCHASE')).toThrow(NotFoundException);
    expect(() => {
      throw new ForbiddenException('This write capability is not bound for conversational execution');
    }).toThrow(ForbiddenException);
  });
});
