import { ClarificationFieldLockService } from './clarification-field-lock.service';
import { presentClarification } from './clarification-presenter';

function mockWatchInventory(resolveImpl: jest.Mock) {
  return { resolve: resolveImpl };
}

describe('ClarificationFieldLockService', () => {
  it('sale pending watch binds inventory match and never searches clients', async () => {
    const resolve = jest.fn().mockResolvedValue({
      kind: 'UNIQUE',
      watchId: 'w1',
      watchLabel: 'Rolex GMT-Master II Bruce Wayne',
      candidate: {
        id: 'w1',
        brand: 'Rolex',
        model: 'GMT-Master II',
        reference: 'Bruce Wayne',
        status: 'AVAILABLE',
        label: 'Rolex GMT-Master II Bruce Wayne',
        score: 90,
        scoreKind: 'BRAND_NICKNAME',
      },
    });
    const searchClientsForTools = jest.fn();
    const lock = new ClarificationFieldLockService(
      mockWatchInventory(resolve) as never,
      { searchClientsForTools } as never,
    );

    const result = await lock.resolve({
      tenantId: 't1',
      intent: 'REGISTER_SALE',
      pendingField: 'watchId',
      answer: 'Bruce Wayne',
      draftEntities: {
        customerId: 'c1',
        customerName: 'Bruce Wayne',
        price: 10000,
        currency: 'USD',
      },
    });

    expect(result.kind).toBe('BOUND');
    if (result.kind !== 'BOUND') return;
    expect(result.entities.watchId).toBe('w1');
    expect(result.entities.customerId).toBe('c1');
    expect(result.entities.customerName).toBe('Bruce Wayne');
    expect(result.entities.price).toBe(10000);
    expect(result.entities.currency).toBe('USD');
    expect(result.entities).not.toHaveProperty('customerQuery');
    expect(searchClientsForTools).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', query: 'Bruce Wayne', eligibility: 'SALE' }),
    );
  });

  it('sale pending watch with multiple matches returns WATCH picker only', async () => {
    const resolve = jest.fn().mockResolvedValue({
      kind: 'PICKER',
      message: 'Encontré dos relojes que podrían ser. ¿Cuál es? Di “el primero”, “el segundo”, o elige uno.',
      candidates: [
        {
          id: 'w1',
          brand: 'Rolex',
          model: 'A',
          reference: null,
          status: 'AVAILABLE',
          label: 'Rolex A',
          score: 70,
          scoreKind: 'BRAND_FAMILY',
        },
        {
          id: 'w2',
          brand: 'Rolex',
          model: 'B',
          reference: null,
          status: 'AVAILABLE',
          label: 'Rolex B',
          score: 68,
          scoreKind: 'BRAND_FAMILY',
        },
      ],
    });
    const searchClientsForTools = jest.fn();
    const lock = new ClarificationFieldLockService(
      mockWatchInventory(resolve) as never,
      { searchClientsForTools } as never,
    );

    const result = await lock.resolve({
      tenantId: 't1',
      intent: 'REGISTER_SALE',
      pendingField: 'watchId',
      answer: 'Rolex',
      draftEntities: { customerName: 'Bruce Wayne', price: 10000, currency: 'USD' },
    });

    expect(result.kind).toBe('PICKER');
    if (result.kind !== 'PICKER') return;
    expect(result.entityType).toBe('WATCH');
    expect(result.message).toMatch(/Bruce Wayne/);
    expect(searchClientsForTools).not.toHaveBeenCalled();
  });

  it('sale pending watch with no inventory match returns CLARIFY (stays on WATCH)', async () => {
    const resolve = jest.fn().mockResolvedValue({
      kind: 'NO_MATCH',
      reason: 'no_candidates',
      message: 'No encontré un Bruce Wayne activo en Inventario. ¿Qué reloj fue?',
    });
    const searchClientsForTools = jest.fn();
    const lock = new ClarificationFieldLockService(
      mockWatchInventory(resolve) as never,
      { searchClientsForTools } as never,
    );

    const result = await lock.resolve({
      tenantId: 't1',
      intent: 'REGISTER_SALE',
      pendingField: 'watchId',
      answer: 'Bruce Wayne',
      draftEntities: { customerId: 'c1', customerName: 'Bruce Wayne' },
    });

    expect(result.kind).toBe('CLARIFY');
    if (result.kind !== 'CLARIFY') return;
    expect(result.message).toMatch(/Bruce Wayne|reloj/i);
    expect(result.entities.watchQuery).toBe('Bruce Wayne');
    expect(searchClientsForTools).not.toHaveBeenCalled();
  });

  it('purchase pending watch binds free-text watchQuery without inventory resolve', async () => {
    const resolve = jest.fn();
    const searchClientsForTools = jest.fn();
    const lock = new ClarificationFieldLockService(
      mockWatchInventory(resolve) as never,
      { searchClientsForTools } as never,
    );

    const result = await lock.resolve({
      tenantId: 't1',
      intent: 'REGISTER_PURCHASE',
      pendingField: 'watch',
      answer: 'Daytona',
      draftEntities: { sellerClientId: 's1', sellerLabel: 'Pepe', cost: 200000, currency: 'MXN' },
    });

    expect(result.kind).toBe('BOUND');
    if (result.kind !== 'BOUND') return;
    expect(result.entities.watchQuery).toBe('Daytona');
    expect(result.entities.sellerClientId).toBe('s1');
    expect(resolve).not.toHaveBeenCalled();
    expect(searchClientsForTools).not.toHaveBeenCalled();
  });

  it('expense currency Pesos continues with MXN bound', async () => {
    const lock = new ClarificationFieldLockService(
      mockWatchInventory(jest.fn()) as never,
      { searchClientsForTools: jest.fn() } as never,
    );
    const result = await lock.resolve({
      tenantId: 't1',
      intent: 'REGISTER_EXPENSE',
      pendingField: 'currency',
      answer: 'Pesos',
      draftEntities: { amount: 500, concept: 'gasolina' },
    });
    expect(result.kind).toBe('BOUND');
    if (result.kind !== 'BOUND') return;
    expect(result.entities.currency).toBe('MXN');
    expect(result.entities.amount).toBe(500);
  });

  it('transfer source Bancos continues with BANK bound', async () => {
    const lock = new ClarificationFieldLockService(
      mockWatchInventory(jest.fn()) as never,
      { searchClientsForTools: jest.fn() } as never,
    );
    const result = await lock.resolve({
      tenantId: 't1',
      intent: 'REGISTER_TREASURY_TRANSFER',
      pendingField: 'sourceAccount',
      answer: 'Bancos',
      draftEntities: { amount: 100000, currency: 'MXN' },
    });
    expect(result.kind).toBe('BOUND');
    if (result.kind !== 'BOUND') return;
    expect(result.entities.sourceAccount).toBe('BANK');
  });
});

describe('ClarificationPresenter contextual questions', () => {
  it('sale watch question includes known customer', () => {
    const presented = presentClarification({
      capability: 'REGISTER_SALE',
      missing: [{ entity: 'watchId' }],
      entities: { customerName: 'Bruce Wayne', price: 10000, currency: 'USD' },
    });
    expect(presented).toBeTruthy();
    expect(presented!.question).toMatch(/Bruce Wayne/);
    expect(presented!.question).toMatch(/reloj/i);
  });

  it('sale amount question includes known customer', () => {
    const presented = presentClarification({
      capability: 'REGISTER_SALE',
      missing: [{ entity: 'price' }],
      entities: { customerName: 'Bruce Wayne', watchId: 'w1' },
    });
    expect(presented).toBeTruthy();
    expect(presented!.question).toMatch(/Bruce Wayne/);
    expect(presented!.question).toMatch(/cu[aá]nto/i);
  });
});
