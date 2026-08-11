import {
  buildExpenseSearchDiscriminators,
  isTrustedExpenseSearch,
} from '../write/reverse-expense-entity-resolver.service';
import { writeWorkingContext, parseResolvedContextShell } from '../../context/working-context';

describe('REVERSE_EXPENSE search ranking (26C harden)', () => {
  it('rejects concept-only / category-only as trusted search', () => {
    const gasolina = buildExpenseSearchDiscriminators({ concept: 'gasolina' });
    expect(gasolina.category).toBe('GASOLINE');
    expect(isTrustedExpenseSearch(gasolina)).toBe(false);

    const conceptOnly = buildExpenseSearchDiscriminators({
      conceptContains: 'uber',
    });
    expect(isTrustedExpenseSearch(conceptOnly)).toBe(false);
  });

  it('accepts amount + category / amount + date / category + date / category + source', () => {
    expect(
      isTrustedExpenseSearch(
        buildExpenseSearchDiscriminators({ amount: 500, concept: 'gasolina' }),
      ),
    ).toBe(true);
    expect(
      isTrustedExpenseSearch(
        buildExpenseSearchDiscriminators({
          amount: 500,
          dateLabel: 'hoy',
        }),
      ),
    ).toBe(true);
    expect(
      isTrustedExpenseSearch(
        buildExpenseSearchDiscriminators({
          concept: 'gasolina',
          dateLabel: 'hoy',
        }),
      ),
    ).toBe(true);
    expect(
      isTrustedExpenseSearch(
        buildExpenseSearchDiscriminators({
          concept: 'gasolina',
          source: 'BANK',
        }),
      ),
    ).toBe(true);
  });

  it('never treats conceptContains as sufficient alone even with notes text', () => {
    const d = buildExpenseSearchDiscriminators({
      conceptContains: 'gasolina del viaje',
      notes: 'gasolina del viaje',
    });
    // May resolve category from concept — still category-only → not trusted alone.
    if (d.category) {
      expect(isTrustedExpenseSearch(d)).toBe(false);
    } else {
      expect(isTrustedExpenseSearch(d)).toBe(false);
    }
  });

  it('preserves lastReversibleAction across conversational working-context writes', () => {
    const shell = writeWorkingContext(
      {
        lastReversibleAction: {
          capability: 'REVERSE_EXPENSE',
          targetType: 'OPERATING_EXPENSE',
          targetId: 'exp-1',
          targetFingerprint: 'fp',
          actionRunId: 'run-1',
          safeLabel: 'Gasolina 500',
          completedAt: new Date().toISOString(),
          conversationId: 'c1',
          workspaceId: 'w1',
        },
        workingContext: undefined,
      },
      {
        schemaVersion: '1.1',
        lastIntent: 'GET_LIQUIDITY',
        lastResponseType: 'TEXT_ANSWER',
        contextUpdatedAt: new Date().toISOString(),
      },
    );
    const parsed = parseResolvedContextShell(shell);
    expect(parsed.lastReversibleAction).toEqual(
      expect.objectContaining({
        capability: 'REVERSE_EXPENSE',
        targetId: 'exp-1',
      }),
    );
  });
});
