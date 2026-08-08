import {
  resolveExpenseCategory,
  resolveExpenseSource,
} from '../write/expense-category-resolver';
import { enrichExpenseEntities } from '../write/expense-entity-enricher';

describe('expense category resolver', () => {
  it.each([
    ['gasolina', 'GASOLINE'],
    ['casetas', 'TOLLS'],
    ['relojero', 'WATCHMAKER'],
    ['estacionamiento', 'PARKING'],
    ['comida de negocios', 'MEALS'],
    ['boleto de avión', 'FLIGHTS'],
    ['publicidad', 'MARKETING'],
  ])('maps %s → %s', (concept, category) => {
    const result = resolveExpenseCategory({ concept });
    expect(result.kind).toBe('RESOLVED');
    if (result.kind === 'RESOLVED') expect(result.category).toBe(category);
  });

  it('maps rent to OTHER with concept', () => {
    const result = resolveExpenseCategory({ concept: 'renta oficina' });
    expect(result).toEqual({
      kind: 'RESOLVED',
      category: 'OTHER',
      concept: 'renta oficina',
    });
  });

  it('rejects bank fee language as unsupported', () => {
    const result = resolveExpenseCategory({ concept: 'comisión bancaria' });
    expect(result.kind).toBe('UNSUPPORTED');
  });

  it('clarifies unknown concepts', () => {
    expect(resolveExpenseCategory({ concept: 'material raro xyz' }).kind).toBe('CLARIFY');
  });
});

describe('expense source resolver', () => {
  it.each([
    ['efectivo', 'CASH'],
    ['en efectivo', 'CASH'],
    ['bancos', 'BANK'],
    ['desde bancos', 'BANK'],
    ['cuenta de césar', 'CESAR'],
  ])('maps %s → %s', (raw, source) => {
    expect(resolveExpenseSource(raw)).toBe(source);
  });

  it('rejects crypto source', () => {
    expect(resolveExpenseSource('crypto')).toBeNull();
  });
});

describe('expense entity enricher', () => {
  it('defaults date to today and resolves gasoline without source', () => {
    const enriched = enrichExpenseEntities(
      { amount: 2500, currency: 'MXN', concept: 'gasolina' },
      new Date('2026-08-08T15:00:00Z'),
    );
    expect(enriched.category).toBe('GASOLINE');
    expect(enriched.date).toBe('2026-08-08');
    expect(enriched.expenseDate).toBe('2026-08-08');
    expect(enriched.source).toBeUndefined();
  });

  it('resolves rent + bank source', () => {
    const enriched = enrichExpenseEntities({
      amount: 18000,
      concept: 'renta',
      source: 'a bancos',
    });
    expect(enriched.category).toBe('OTHER');
    expect(enriched.source).toBe('BANK');
    expect(enriched.currency).toBe('MXN');
  });
});
