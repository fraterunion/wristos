import {
  detectTransferCorrectionLanguage,
  isTransferCorrectionVerbUtterance,
} from '../transfer-correction-language';
import { reverseIntentFromLastReversibleAction } from '../last-action-reverse-allowlist';
import { classifyTransferReversalRecovery } from '../transfer-reversal-recovery';
import {
  isTrustedTransferSearch,
  buildTransferSearchDiscriminators,
} from '../../bindings/write/reverse-treasury-transfer-entity-resolver.service';

describe('26D transfer correction language + allowlist', () => {
  it('maps reverse/delete transfer phrases to REVERSE_TREASURY_TRANSFER', () => {
    for (const phrase of [
      'Revierte la transferencia.',
      'Deshaz la transferencia de 100 mil.',
      'Borra esa transferencia.',
      'Me equivoqué con el traspaso.',
      'Revierte lo que acabo de mover.',
      'Elimina el traspaso.',
    ]) {
      const d = detectTransferCorrectionLanguage(phrase);
      expect(d?.intent).toBe('REVERSE_TREASURY_TRANSFER');
    }
  });

  it('extracts amount + source + destination', () => {
    const d = detectTransferCorrectionLanguage(
      'Revierte la transferencia de 100 mil de Bancos a Efectivo.',
    );
    expect(d?.kind).toBe('TRANSFER_DELETE_OR_REVERSE');
    if (d?.kind !== 'TRANSFER_DELETE_OR_REVERSE') return;
    expect(d.entities.amount).toBe(100000);
    expect(d.entities.sourceAccount).toBe('BANK');
    expect(d.entities.destinationAccount).toBe('CASH');
  });

  it('does not steal expense or payment language', () => {
    expect(detectTransferCorrectionLanguage('Revierte el gasto')).toBeNull();
    expect(detectTransferCorrectionLanguage('Deshaz el pago')).toBeNull();
    expect(detectTransferCorrectionLanguage('Pasa 100 mil de Bancos a Efectivo')).toBeNull();
  });

  it('closed last-action allowlist maps expense vs transfer only', () => {
    expect(
      reverseIntentFromLastReversibleAction({
        capability: 'REVERSE_EXPENSE',
        targetType: 'OPERATING_EXPENSE',
        targetId: 'e1',
        targetFingerprint: 'fp',
        actionRunId: 'r1',
        safeLabel: 'gasto',
        completedAt: new Date().toISOString(),
        conversationId: 'c',
        workspaceId: 'w',
      }),
    ).toBe('REVERSE_EXPENSE');
    expect(
      reverseIntentFromLastReversibleAction({
        capability: 'REVERSE_TREASURY_TRANSFER',
        targetType: 'TREASURY_TRANSFER',
        targetId: 't1',
        targetFingerprint: 'fp',
        actionRunId: 'r1',
        safeLabel: 'xfer',
        completedAt: new Date().toISOString(),
        conversationId: 'c',
        workspaceId: 'w',
      }),
    ).toBe('REVERSE_TREASURY_TRANSFER');
    expect(reverseIntentFromLastReversibleAction(null)).toBeNull();
  });

  it('requires trusted transfer search discriminators', () => {
    expect(
      isTrustedTransferSearch(
        buildTransferSearchDiscriminators({ amount: 100000 }),
      ),
    ).toBe(false);
    expect(
      isTrustedTransferSearch(
        buildTransferSearchDiscriminators({
          amount: 100000,
          sourceAccount: 'BANK',
          destinationAccount: 'CASH',
        }),
      ),
    ).toBe(true);
    expect(isTransferCorrectionVerbUtterance('borra esa transferencia')).toBe(true);
  });

  it('SAME_COMMAND requires BOTH legs stamped with the same key', () => {
    const key = 'ai-action-run:run1';
    expect(
      classifyTransferReversalRecovery({
        commandKey: key,
        outflow: { deletedAt: new Date(), reversalIdempotencyKey: key },
        inflow: { deletedAt: new Date(), reversalIdempotencyKey: key },
        plannedFingerprint: 'a',
        currentFingerprint: 'a',
      }).kind,
    ).toBe('MATCH');

    expect(
      classifyTransferReversalRecovery({
        commandKey: key,
        outflow: { deletedAt: new Date(), reversalIdempotencyKey: key },
        inflow: { deletedAt: new Date(), reversalIdempotencyKey: 'other' },
        plannedFingerprint: 'a',
        currentFingerprint: 'a',
      }).kind,
    ).toBe('INVARIANT');

    expect(
      classifyTransferReversalRecovery({
        commandKey: key,
        outflow: { deletedAt: new Date(), reversalIdempotencyKey: key },
        inflow: { deletedAt: new Date(), reversalIdempotencyKey: null },
        plannedFingerprint: 'a',
        currentFingerprint: 'a',
      }).kind,
    ).toBe('INVARIANT');
  });
});
