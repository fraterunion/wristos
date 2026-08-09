import { PayablePaymentEntityResolver } from '../write/payable-payment-entity-resolver.service';

describe('PayablePaymentEntityResolver trust gate', () => {
  function build(open: Array<Record<string, unknown>> = []) {
    const cuentas = {
      getOpenAccountsForTools: jest.fn(async () => open),
    };
    const crm = {
      searchClientsForTools: jest.fn(async () => []),
    };
    return {
      resolver: new PayablePaymentEntityResolver(cuentas as never, crm as never),
      cuentas,
      crm,
    };
  }

  it('strips unresolved/foreign payable IDs and is not executable-ready', async () => {
    const { resolver } = build([]);
    const resolved = await resolver.resolve('tenant-demo', {
      payableEntryId: 'foreign-wc-payable',
      accountId: 'foreign-wc-payable',
      accountEntryId: 'foreign-wc-payable',
      amount: '1000',
      sourceAccount: 'BANK',
      currency: 'MXN',
      uniquePayableSelected: true,
      payableTrustSource: 'PROVIDER_LIE',
    });

    expect(resolved.entities.payableEntryId).toBeUndefined();
    expect(resolved.entities.accountId).toBeUndefined();
    expect(resolved.entities.accountEntryId).toBeUndefined();
    expect(resolved.entities.payableAccountId).toBeUndefined();
    expect(resolved.entities.entryId).toBeUndefined();
    expect(resolved.entities.payableTrustSource).toBeUndefined();
    expect(resolved.entities.uniquePayableSelected).toBeUndefined();
    expect(resolved.clarify).toBeNull();
  });

  it('revalidates claimed ID against tenant-eligible open PAYABLE', async () => {
    const { resolver } = build([
      {
        id: 'ap-demo-1',
        concept: 'Compra Daytona',
        counterpartyName: 'Pepe',
        currency: 'MXN',
        balance: '100000.00',
        source: 'MANUAL',
        clientId: 'c1',
        dealId: null,
      },
    ]);
    const resolved = await resolver.resolve('tenant-demo', {
      payableEntryId: 'ap-demo-1',
      amount: '35000',
      sourceAccount: 'BANK',
    });

    expect(resolved.entities.payableEntryId).toBe('ap-demo-1');
    expect(resolved.entities.accountId).toBe('ap-demo-1');
    expect(resolved.entities.payableTrustSource).toBe('SERVER_REVALIDATED');
    expect(resolved.entities.outstandingAmount).toBe('100000.00');
  });

  it('rejects stale/paid candidate that is no longer open', async () => {
    const { resolver } = build([]); // previously presented id no longer open
    const resolved = await resolver.resolve('tenant-demo', {
      accountId: 'ap-stale-paid',
      amount: '50000',
      sourceAccount: 'BANK',
      outstandingAmount: '50000',
    });
    expect(resolved.entities.accountId).toBeUndefined();
    expect(resolved.entities.payableEntryId).toBeUndefined();
  });

  it('unique open payable binds with UNIQUE_OPEN trust source', async () => {
    const { resolver, crm } = build([
      {
        id: 'ap-only',
        concept: 'Cuenta manual',
        counterpartyName: 'Pepe',
        currency: 'MXN',
        balance: '80000.00',
        source: 'PURCHASE_AUTO',
        clientId: 'c-pepe',
        dealId: null,
      },
    ]);
    crm.searchClientsForTools.mockResolvedValue([
      { id: 'c-pepe', name: 'Pepe' },
    ] as never);
    const resolved = await resolver.resolve('tenant-demo', {
      counterpartyQuery: 'Pepe',
      amount: '20000',
      sourceAccount: 'CASH',
    });
    expect(resolved.uniquePayableSelected).toBe(true);
    expect(resolved.entities.payableEntryId).toBe('ap-only');
    expect(resolved.entities.payableTrustSource).toBe('UNIQUE_OPEN');
  });

  it('multiple open payables return picker without carrying untrusted IDs', async () => {
    const open = [
      {
        id: 'ap-1',
        concept: 'A',
        counterpartyName: 'Pepe',
        currency: 'MXN',
        balance: '300000.00',
        source: 'MANUAL',
        clientId: 'c1',
        dealId: null,
      },
      {
        id: 'ap-2',
        concept: 'B',
        counterpartyName: 'Pepe',
        currency: 'MXN',
        balance: '80000.00',
        source: 'MANUAL',
        clientId: 'c1',
        dealId: null,
      },
    ];
    const { resolver } = build(open);
    const resolved = await resolver.resolve('tenant-demo', {
      customerId: 'c1',
      payableEntryId: 'injector-id',
      amount: '50000',
      sourceAccount: 'BANK',
    });
    expect(resolved.clarify?.entityType).toBe('ACCOUNT_ENTRY');
    expect(resolved.entities.payableEntryId).toBeUndefined();
    expect(resolved.entities.accountId).toBeUndefined();
    expect(resolved.clarify?.candidates).toHaveLength(2);
  });
});
