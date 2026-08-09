import { PurchaseEntityResolver } from './purchase-entity-resolver.service';

describe('PurchaseEntityResolver composition V1', () => {
  const crm = {
    searchClientsForTools: jest.fn(),
  };
  const prisma = {
    client: { findFirst: jest.fn() },
    watch: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const resolver = new PurchaseEntityResolver(crm as never, prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.watch.findFirst.mockResolvedValue(null);
  });

  it('returns dependencyRequired when seller query has zero matches', async () => {
    crm.searchClientsForTools.mockResolvedValue([]);
    const result = await resolver.resolve('t1', {
      brand: 'Rolex',
      model: 'Daytona',
      cost: 300000,
      sellerQuery: 'Pepe',
      paymentMode: 'CREDIT',
    });
    expect(result.clarify).toBeNull();
    expect(result.dependencyRequired).toEqual(
      expect.objectContaining({ reason: 'PURCHASE_SELLER', query: 'Pepe' }),
    );
    expect(result.entities.sellerUnlinked).toBeUndefined();
  });

  it('does not compose when seller uniquely exists', async () => {
    crm.searchClientsForTools.mockResolvedValue([{ id: 'c1', name: 'Pepe' }]);
    const result = await resolver.resolve('t1', {
      sellerQuery: 'Pepe',
      cost: 300000,
    });
    expect(result.dependencyRequired).toBeNull();
    expect(result.entities.sellerClientId).toBe('c1');
  });

  it('clarifies when multiple sellers match (no CREATE_CLIENT yet)', async () => {
    crm.searchClientsForTools.mockResolvedValue([
      { id: 'c1', name: 'Pepe A' },
      { id: 'c2', name: 'Pepe B' },
    ]);
    const result = await resolver.resolve('t1', { sellerQuery: 'Pepe' });
    expect(result.dependencyRequired).toBeNull();
    expect(result.clarify?.candidates).toHaveLength(2);
  });
});
