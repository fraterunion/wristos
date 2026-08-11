import {
  detectExpenseCorrectionLanguage,
  isExpenseCorrectionVerbUtterance,
} from '../expense-correction-language';
import {
  CANONICAL_EXPENSE_INVARIANT_MESSAGE,
  classifyExpenseReversalEconomics,
} from '../expense-reversal-classification';
import { isPureReferentialUtterance } from '../../context/ordinal-reference';
import { Prisma } from '@prisma/client';

function d(n: number) {
  return new Prisma.Decimal(n);
}

describe('26C.1 expense correction language', () => {
  it.each([
    'Deshaz eso.',
    'Revierte eso.',
    'Deshazlo',
    'Reviértelo',
    'Me equivoqué, deshaz eso.',
    'Me equivoqué, reviértelo.',
    'Borra eso.',
  ])('detects last-action deixis: %s', (text) => {
    const dtc = detectExpenseCorrectionLanguage(text);
    expect(dtc?.kind).toBe('LAST_ACTION_DEIXIS');
    expect(dtc?.intent).toBe('REVERSE_EXPENSE');
    if (dtc?.kind === 'LAST_ACTION_DEIXIS') {
      expect(dtc.entities.useLastAction).toBe(true);
    }
  });

  it.each([
    'Borra ese gasto.',
    'Elimina ese gasto.',
    'Borra el gasto de gasolina de 500.',
    'Elimina el gasto de gasolina de 500 de hoy.',
    'Revierte el gasto de gasolina.',
  ])('maps delete/reverse expense language: %s', (text) => {
    const dtc = detectExpenseCorrectionLanguage(text);
    expect(dtc?.kind).toBe('EXPENSE_DELETE_OR_REVERSE');
    expect(dtc?.intent).toBe('REVERSE_EXPENSE');
  });

  it.each([
    'Deshaz la transferencia',
    'Revierte la transferencia',
    'Borra el cliente',
    'Elimina el reloj',
    'Cancela la compra',
  ])('blocks non-expense reversal: %s', (text) => {
    const dtc = detectExpenseCorrectionLanguage(text);
    expect(dtc?.kind).toBe('BLOCKED_NON_EXPENSE_REVERSAL');
  });

  it('does not steal pure deictic eso for correction verbs', () => {
    expect(isPureReferentialUtterance('Deshaz eso.')).toBe(false);
    expect(isPureReferentialUtterance('Borra eso.')).toBe(false);
    expect(isExpenseCorrectionVerbUtterance('Deshaz eso.')).toBe(true);
  });

  it('leaves ordinary chat alone', () => {
    expect(detectExpenseCorrectionLanguage('Gracias.')).toBeNull();
    expect(detectExpenseCorrectionLanguage('Gasté 500 en gasolina.')).toBeNull();
  });
});

describe('26C.1 expense reversal classification', () => {
  const baseExpense = {
    id: 'e1',
    deletedAt: null as Date | null,
    amount: d(500),
    sourceAccount: 'BANK' as string | null,
  };

  it('classifies never-provenance as LEGACY_VALID', () => {
    expect(
      classifyExpenseReversalEconomics({
        expense: baseExpense,
        treasuryOutflow: null,
      }),
    ).toBe('LEGACY_VALID');
  });

  it('classifies active coherent outflow as CANONICAL_VALID', () => {
    expect(
      classifyExpenseReversalEconomics({
        expense: baseExpense,
        treasuryOutflow: {
          id: 't1',
          deletedAt: null,
          direction: 'OUTFLOW',
          amountMxn: d(500),
          account: 'BANK',
        },
      }),
    ).toBe('CANONICAL_VALID');
  });

  it('classifies soft-deleted provenance + active expense as CANONICAL_INVARIANT', () => {
    expect(
      classifyExpenseReversalEconomics({
        expense: baseExpense,
        treasuryOutflow: {
          id: 't1',
          deletedAt: new Date(),
          direction: 'OUTFLOW',
          amountMxn: d(500),
          account: 'BANK',
        },
      }),
    ).toBe('CANONICAL_INVARIANT');
  });

  it('classifies amount-mismatched active outflow as CANONICAL_INVARIANT', () => {
    expect(
      classifyExpenseReversalEconomics({
        expense: baseExpense,
        treasuryOutflow: {
          id: 't1',
          deletedAt: null,
          direction: 'OUTFLOW',
          amountMxn: d(999),
          account: 'BANK',
        },
      }),
    ).toBe('CANONICAL_INVARIANT');
  });

  it('exposes fail-closed copy', () => {
    expect(CANONICAL_EXPENSE_INVARIANT_MESSAGE).toMatch(/registro financiero está incompleto/);
  });
});
