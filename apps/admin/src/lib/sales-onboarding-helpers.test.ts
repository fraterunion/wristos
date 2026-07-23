import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clientSideCalculatedProfit,
  emptyHistoricalSale,
  entityTypeForSession,
  filterSalesByStatus,
  hasProfitMismatch,
  saleMatchesSearch,
} from './sales-onboarding-helpers';

describe('entityTypeForSession', () => {
  it('maps SALES → SALES and INVENTORY → INVENTORY', () => {
    assert.equal(entityTypeForSession('SALES'), 'SALES');
    assert.equal(entityTypeForSession('INVENTORY'), 'INVENTORY');
  });
});

describe('emptyHistoricalSale', () => {
  it('returns a blank sale with null fields', () => {
    const sale = emptyHistoricalSale();
    assert.equal(sale.saleDate, null);
    assert.equal(sale.customerName, null);
    assert.equal(sale.brand, null);
    assert.equal(sale.salePrice, null);
    assert.equal(sale.cost, null);
    assert.equal(sale.extras, null);
    assert.equal(sale.reportedProfit, null);
  });
});

describe('clientSideCalculatedProfit', () => {
  it('returns null when salePrice or cost is missing', () => {
    assert.equal(clientSideCalculatedProfit({ salePrice: 100, cost: null }), null);
    assert.equal(clientSideCalculatedProfit({ salePrice: null, cost: 50 }), null);
  });

  it('computes salePrice − cost − extras (extras default 0)', () => {
    assert.equal(
      clientSideCalculatedProfit({ salePrice: 100, cost: 40, extras: null }),
      60,
    );
    assert.equal(
      clientSideCalculatedProfit({ salePrice: 100, cost: 40, extras: 10 }),
      50,
    );
  });
});

describe('saleMatchesSearch', () => {
  const sale = {
    customerName: 'Ana Pérez',
    brand: 'Rolex',
    model: 'Submariner',
    reference: '126610LN',
    serialNumber: 'SN123',
  };

  it('matches empty query', () => {
    assert.equal(saleMatchesSearch(sale, ''), true);
    assert.equal(saleMatchesSearch(sale, '   '), true);
  });

  it('matches customer, brand, model, reference, serial', () => {
    assert.equal(saleMatchesSearch(sale, 'ana'), true);
    assert.equal(saleMatchesSearch(sale, 'ROLEX'), true);
    assert.equal(saleMatchesSearch(sale, 'sub'), true);
    assert.equal(saleMatchesSearch(sale, '126610'), true);
    assert.equal(saleMatchesSearch(sale, 'sn123'), true);
    assert.equal(saleMatchesSearch(sale, 'omega'), false);
  });
});

describe('filterSalesByStatus / hasProfitMismatch', () => {
  it('filters MISSING_PRICE and COMPLETE', () => {
    const sales = [
      { brand: 'Rolex', salePrice: 100, cost: 50 },
      { brand: 'Omega', salePrice: null, cost: 20 },
      { brand: null, model: null, salePrice: 10, cost: 1 },
    ];
    assert.equal(filterSalesByStatus(sales, 'MISSING_PRICE').length, 1);
    assert.equal(filterSalesByStatus(sales, 'HAS_PRICE').length, 2);
    assert.equal(filterSalesByStatus(sales, 'COMPLETE').length, 1);
    assert.equal(filterSalesByStatus(sales, 'EMPTY_IDENTITY').length, 1);
  });

  it('detects profit mismatch when |reported − calculated| > 1', () => {
    assert.equal(
      hasProfitMismatch({ salePrice: 100, cost: 40, extras: 0, reportedProfit: 60 }),
      false,
    );
    assert.equal(
      hasProfitMismatch({ salePrice: 100, cost: 40, extras: 0, reportedProfit: 50 }),
      true,
    );
  });
});
