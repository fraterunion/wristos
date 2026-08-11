import { Injectable } from '@nestjs/common';
import { JsonValue } from '../../domain/canonical-json';
import { ContextEntityType, PresentedCandidate } from '../../context/working-context';
import { evaluateLastReversibleAction } from '../../reversals/last-reversible-action.policy';
import { LastReversibleActionContext } from '../../reversals/financial-reversal.types';
import { buildTransferReversalPreview } from '../../reversals/reversal-preview';
import {
  TransferReversalTargetResolver,
  TransferReversalSearchQuery,
} from '../../reversals/transfer-reversal-target-resolver.service';
import {
  normalizeTreasuryTransferAccount,
  accountLabel,
} from './register-treasury-transfer.binding';

export type ReverseTransferClarify = {
  field: 'target' | 'amount' | 'sourceAccount' | 'destinationAccount' | 'date';
  entityType: ContextEntityType;
  message: string;
  candidates: PresentedCandidate[];
  items: Array<Record<string, JsonValue>>;
  code?:
    | 'AMBIGUOUS_TRANSFER'
    | 'NO_MATCH'
    | 'ALREADY_REVERSED'
    | 'WEAK_SEARCH'
    | 'NO_LAST_ACTION'
    | 'INVARIANT';
};

export type ReverseTransferResolution =
  | {
      kind: 'READY';
      entities: Record<string, JsonValue>;
      targetSource: 'last_action' | 'search' | 'picker' | 'selected';
    }
  | {
      kind: 'CLARIFY';
      entities: Record<string, JsonValue>;
      clarify: ReverseTransferClarify;
    };

export type TransferSearchDiscriminators = {
  amount: number | null;
  sourceAccount: 'CASH' | 'BANK' | 'CESAR' | null;
  destinationAccount: 'CASH' | 'BANK' | 'CESAR' | null;
  transferDate: string | Date | null;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function looksLikeLastActionUndo(entities: Record<string, JsonValue>): boolean {
  if (entities.useLastAction === true || entities.useLastReversibleAction === true) return true;
  if (asString(entities.targetSource) === 'last_action') return true;
  return false;
}

function hasSearchHints(entities: Record<string, JsonValue>): boolean {
  return Boolean(
    asNumber(entities.amount) != null ||
      asString(entities.sourceAccount) ||
      asString(entities.source) ||
      asString(entities.fromAccount) ||
      asString(entities.destinationAccount) ||
      asString(entities.destination) ||
      asString(entities.toAccount) ||
      asString(entities.effectiveDate) ||
      asString(entities.transferDate) ||
      asString(entities.date) ||
      asString(entities.dateLabel),
  );
}

/**
 * Trusted transfer search ranking (26D):
 * 1. amount + source + destination
 * 2. amount + date + source
 * 3. amount + date + destination
 * 4. source + destination + date
 *
 * Weak source-only / amount-only / bare “esa transferencia” → NEEDS_INPUT.
 */
export function isTrustedTransferSearch(d: TransferSearchDiscriminators): boolean {
  const hasAmount = d.amount != null;
  const hasDate = d.transferDate != null;
  const hasSource = d.sourceAccount != null;
  const hasDest = d.destinationAccount != null;
  return (
    (hasAmount && hasSource && hasDest) ||
    (hasAmount && hasDate && hasSource) ||
    (hasAmount && hasDate && hasDest) ||
    (hasSource && hasDest && hasDate)
  );
}

export function buildTransferSearchDiscriminators(
  entities: Record<string, JsonValue>,
): TransferSearchDiscriminators {
  const amount = asNumber(entities.amount);
  const sourceAccount =
    normalizeTreasuryTransferAccount(
      asString(entities.sourceAccount) ??
        asString(entities.source) ??
        asString(entities.fromAccount),
    ) ?? null;
  const destinationAccount =
    normalizeTreasuryTransferAccount(
      asString(entities.destinationAccount) ??
        asString(entities.destination) ??
        asString(entities.toAccount),
    ) ?? null;
  const transferDate =
    asString(entities.transferDate) ??
    asString(entities.effectiveDate) ??
    asString(entities.date) ??
    asString(entities.dateLabel);
  return { amount, sourceAccount, destinationAccount, transferDate };
}

function weakSearchClarifyMessage(
  d: TransferSearchDiscriminators,
): { field: ReverseTransferClarify['field']; message: string } {
  if (d.amount != null && !d.sourceAccount && !d.destinationAccount && !d.transferDate) {
    return {
      field: 'sourceAccount',
      message: '¿De qué cuenta salió esa transferencia?',
    };
  }
  if (d.sourceAccount && !d.destinationAccount && d.amount == null) {
    return {
      field: 'destinationAccount',
      message: '¿A qué cuenta fue, o de cuánto fue?',
    };
  }
  if (d.destinationAccount && !d.sourceAccount && d.amount == null) {
    return {
      field: 'sourceAccount',
      message: '¿De qué cuenta salió, o de cuánto fue?',
    };
  }
  if (d.amount != null && d.sourceAccount && !d.destinationAccount && !d.transferDate) {
    return {
      field: 'destinationAccount',
      message: '¿A qué cuenta fue esa transferencia?',
    };
  }
  if (d.amount != null && d.destinationAccount && !d.sourceAccount && !d.transferDate) {
    return {
      field: 'sourceAccount',
      message: '¿De qué cuenta salió esa transferencia?',
    };
  }
  return {
    field: 'amount',
    message: '¿De cuánto fue la transferencia que quieres revertir?',
  };
}

const INVARIANT_MESSAGE =
  'No puedo revertir esa transferencia de forma segura porque su registro financiero está incompleto.';

/**
 * Trusted REVERSE_TREASURY_TRANSFER resolution (26D).
 * Never trusts provider TreasuryEntry IDs / raw DB ids.
 * Identifies logical transfer pairs only — never a lone leg.
 */
@Injectable()
export class ReverseTreasuryTransferEntityResolver {
  constructor(private readonly targets: TransferReversalTargetResolver) {}

  async resolve(args: {
    tenantId: string;
    conversationId: string;
    workspaceId: string;
    entities: Record<string, JsonValue>;
    lastReversibleAction?: LastReversibleActionContext | null;
  }): Promise<ReverseTransferResolution> {
    const next: Record<string, JsonValue> = { ...args.entities };

    delete next.transferId;
    delete next.targetId;
    delete next.treasuryEntryId;
    delete next.outflowId;
    delete next.inflowId;
    delete next.id;
    delete next.reversalIdempotencyKey;
    delete next.targetFingerprint;

    const selectedId =
      asString(next.selectedTransferId) ??
      asString(next.trustedTransferId) ??
      (asString(next.selectedEntityType) === 'TREASURY_TRANSFER'
        ? asString(next.selectedEntityId)
        : null);

    if (selectedId) {
      const resolved = await this.targets.resolveTrustedTransferId(args.tenantId, selectedId);
      return this.mapResolve(next, resolved, 'picker');
    }

    const preferLast =
      looksLikeLastActionUndo(next) ||
      (!hasSearchHints(next) && Boolean(args.lastReversibleAction));

    if (preferLast) {
      const policy = evaluateLastReversibleAction({
        candidate: args.lastReversibleAction,
        tenantId: args.tenantId,
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
      });
      if (policy.kind === 'USE' && policy.context.capability === 'REVERSE_TREASURY_TRANSFER') {
        const resolved = await this.targets.resolveTrustedTransferId(
          args.tenantId,
          policy.context.targetId,
        );
        if (resolved.kind === 'ALREADY_REVERSED') {
          return {
            kind: 'CLARIFY',
            entities: next,
            clarify: {
              field: 'target',
              entityType: 'TREASURY_TRANSFER',
              code: 'ALREADY_REVERSED',
              message: 'Esa transferencia ya fue revertida.',
              candidates: [],
              items: [],
            },
          };
        }
        if (resolved.kind === 'INVARIANT') {
          return {
            kind: 'CLARIFY',
            entities: next,
            clarify: {
              field: 'target',
              entityType: 'TREASURY_TRANSFER',
              code: 'INVARIANT',
              message: INVARIANT_MESSAGE,
              candidates: [],
              items: [],
            },
          };
        }
        if (resolved.kind === 'TRUSTED') {
          return this.mapResolve(next, resolved, 'last_action');
        }
        if (resolved.kind === 'NONE') {
          return {
            kind: 'CLARIFY',
            entities: next,
            clarify: {
              field: 'target',
              entityType: 'TREASURY_TRANSFER',
              code: 'NO_MATCH',
              message: 'No encontré una transferencia activa que coincida con eso.',
              candidates: [],
              items: [],
            },
          };
        }
      }
      if (!hasSearchHints(next)) {
        return {
          kind: 'CLARIFY',
          entities: next,
          clarify: {
            field: 'target',
            entityType: 'TREASURY_TRANSFER',
            code: 'NO_LAST_ACTION',
            message:
              'No tengo una transferencia reciente en esta conversación para deshacer. ¿Cuál quieres revertir?',
            candidates: [],
            items: [],
          },
        };
      }
    }

    const discriminators = buildTransferSearchDiscriminators(next);
    if (!isTrustedTransferSearch(discriminators)) {
      const weak = weakSearchClarifyMessage(discriminators);
      return {
        kind: 'CLARIFY',
        entities: next,
        clarify: {
          field: weak.field,
          entityType: 'TREASURY_TRANSFER',
          code: 'WEAK_SEARCH',
          message: weak.message,
          candidates: [],
          items: [],
        },
      };
    }

    const query: TransferReversalSearchQuery = {
      amount: discriminators.amount,
      sourceAccount: discriminators.sourceAccount,
      destinationAccount: discriminators.destinationAccount,
      transferDate: discriminators.transferDate,
    };

    const resolved = await this.targets.resolveSearch(args.tenantId, query);
    return this.mapResolve(next, resolved, 'search');
  }

  private mapResolve(
    entities: Record<string, JsonValue>,
    resolved: Awaited<ReturnType<TransferReversalTargetResolver['resolveTrustedTransferId']>>,
    targetSource: 'last_action' | 'search' | 'picker' | 'selected',
  ): ReverseTransferResolution {
    if (resolved.kind === 'NONE') {
      return {
        kind: 'CLARIFY',
        entities,
        clarify: {
          field: 'target',
          entityType: 'TREASURY_TRANSFER',
          code: 'NO_MATCH',
          message: 'No encontré una transferencia activa que coincida con eso.',
          candidates: [],
          items: [],
        },
      };
    }
    if (resolved.kind === 'INVARIANT') {
      return {
        kind: 'CLARIFY',
        entities,
        clarify: {
          field: 'target',
          entityType: 'TREASURY_TRANSFER',
          code: 'INVARIANT',
          message: INVARIANT_MESSAGE,
          candidates: [],
          items: [],
        },
      };
    }
    if (resolved.kind === 'ALREADY_REVERSED') {
      return {
        kind: 'CLARIFY',
        entities,
        clarify: {
          field: 'target',
          entityType: 'TREASURY_TRANSFER',
          code: 'ALREADY_REVERSED',
          message: 'Esa transferencia ya fue revertida.',
          candidates: [],
          items: [],
        },
      };
    }
    if (resolved.kind === 'AMBIGUOUS') {
      const candidates: PresentedCandidate[] = resolved.candidates.map((c) => ({
        id: c.targetId,
        label: c.label.slice(0, 160),
        ordinal: c.ordinal,
      }));
      const amount = asNumber(entities.amount);
      const message =
        amount != null
          ? `Encontré varias transferencias de $${amount.toLocaleString('es-MX')}. ¿Cuál quieres revertir?`
          : 'Encontré varias transferencias. ¿Cuál quieres revertir?';
      return {
        kind: 'CLARIFY',
        entities,
        clarify: {
          field: 'target',
          entityType: 'TREASURY_TRANSFER',
          code: 'AMBIGUOUS_TRANSFER',
          message,
          candidates,
          items: candidates.map((c) => ({
            ordinal: c.ordinal,
            label: c.label,
            entityType: 'TREASURY_TRANSFER',
          })),
        },
      };
    }

    const snap = resolved.target.targetSnapshot;
    if (snap.kind !== 'TREASURY_TRANSFER') {
      return {
        kind: 'CLARIFY',
        entities,
        clarify: {
          field: 'target',
          entityType: 'TREASURY_TRANSFER',
          code: 'NO_MATCH',
          message: 'No encontré una transferencia activa que coincida con eso.',
          candidates: [],
          items: [],
        },
      };
    }

    const preview = buildTransferReversalPreview(snap);
    return {
      kind: 'READY',
      targetSource,
      entities: {
        ...entities,
        targetId: resolved.target.targetId,
        targetFingerprint: resolved.target.targetFingerprint,
        trustedTransferId: resolved.target.targetId,
        trustedTargetFingerprint: resolved.target.targetFingerprint,
        amount: snap.amount,
        currency: snap.currency,
        sourceAccount: snap.sourceAccount,
        destinationAccount: snap.destinationAccount,
        sourceLabel: accountLabel(snap.sourceAccount),
        destinationLabel: accountLabel(snap.destinationAccount),
        transferDate: snap.transferDate,
        targetSafeLabel: preview.targetSafeLabel,
        targetSource,
        restoresLiquidity: false,
        changesPnl: false,
        changesCapital: false,
      },
    };
  }
}
