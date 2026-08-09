import { CapitalInvestorEntityResolver } from '../write/capital-investor-entity-resolver.service';

describe('CapitalInvestorEntityResolver', () => {
  const prisma = {
    investor: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const resolver = new CapitalInvestorEntityResolver(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('strips provider investorId and resolves unique name match', async () => {
    prisma.investor.findFirst.mockResolvedValue(null);
    prisma.investor.findMany.mockResolvedValue([
      { id: 'inv-cesar', name: 'CESAR', ownershipPercent: 75 },
    ]);
    const result = await resolver.resolve('t1', {
      investorId: 'forged-foreign-id',
      investorQuery: 'César',
      amount: '300000',
      account: 'BANK',
    });
    expect(result.kind).toBe('READY');
    if (result.kind !== 'READY') return;
    expect(result.entities.investorId).toBe('inv-cesar');
    expect(result.entities.selectedInvestorId).toBe('inv-cesar');
    expect(result.entities.investorLabel).toBe('CESAR');
  });

  it('returns picker when ambiguous', async () => {
    prisma.investor.findFirst.mockResolvedValue(null);
    prisma.investor.findMany.mockResolvedValue([
      { id: 'a', name: 'CESAR A', ownershipPercent: 50 },
      { id: 'b', name: 'CESAR B', ownershipPercent: 50 },
    ]);
    const result = await resolver.resolve('t1', { investorQuery: 'CESAR', amount: '1' });
    expect(result.kind).toBe('CLARIFY');
    if (result.kind !== 'CLARIFY') return;
    expect(result.clarify.code).toBe('AMBIGUOUS_INVESTOR');
    expect(result.clarify.candidates).toHaveLength(2);
    expect(result.clarify.entityType).toBe('INVESTOR');
  });

  it('trusts selectedInvestorId after picker', async () => {
    prisma.investor.findFirst.mockResolvedValue({
      id: 'inv-2',
      name: 'EDGAR',
      ownershipPercent: 25,
    });
    const result = await resolver.resolve('t1', {
      selectedInvestorId: 'inv-2',
      amount: '100000',
      account: 'CASH',
    });
    expect(result.kind).toBe('READY');
    if (result.kind !== 'READY') return;
    expect(result.entities.investorId).toBe('inv-2');
    expect(prisma.investor.findMany).not.toHaveBeenCalled();
  });

  it('rejects USD/crypto currency', async () => {
    const result = await resolver.resolve('t1', {
      investorQuery: 'CESAR',
      amount: '100',
      currency: 'USD',
    });
    expect(result.kind).toBe('CLARIFY');
    if (result.kind !== 'CLARIFY') return;
    expect(result.clarify.code).toBe('UNSUPPORTED_CURRENCY');
  });
});
