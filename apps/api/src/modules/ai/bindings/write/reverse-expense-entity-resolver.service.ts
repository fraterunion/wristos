import { Injectable } from '@nestjs/common';
import { OperatingExpenseCategory } from '@prisma/client';
import { JsonValue } from '../../domain/canonical-json';
import { ContextEntityType, PresentedCandidate } from '../../context/working-context';
import {
  evaluateLastReversibleAction,
} from '../../reversals/last-reversible-action.policy';
import { LastReversibleActionContext } from '../../reversals/financial-reversal.types';
import { buildExpenseReversalPreview } from '../../reversals/reversal-preview';
import {
  ExpenseReversalTargetResolver,
  ExpenseReversalSearchQuery,
} from '../../reversals/expense-reversal-target-resolver.service';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_SOURCE_LABELS } from './expense-category-resolver';
import { resolveExpenseCategory } from './expense-category-resolver';

export type ReverseExpenseClarify = {
  field: 'target' | 'amount' | 'category' | 'date';
  entityType: ContextEntityType;
  message: string;
  candidates: PresentedCandidate[];
  items: Array<Record<string, JsonValue>>;
  code?:
    | 'AMBIGUOUS_EXPENSE'
    | 'NO_MATCH'
    | 'ALREADY_REVERSED'
    | 'MISSING_AMOUNT'
    | 'NO_LAST_ACTION';
};

export type ReverseExpenseResolution =
  | { kind: 'READY'; entities: Record<string, JsonValue>; targetSource: 'last_action' | 'search' | 'picker' | 'selected' }
  | {
      kind: 'CLARIFY';
      entities: Record<string, JsonValue>;
      clarify: ReverseExpenseClarify;
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
  // Empty search filters → try last action first (caller decides).
  return false;
}

function hasSearchHints(entities: Record<string, JsonValue>): boolean {
  return Boolean(
    asNumber(entities.amount) != null ||
      asString(entities.category) ||
      asString(entities.concept) ||
      asString(entities.conceptContains) ||
      asString(entities.notes) ||
      asString(entities.effectiveDate) ||
      asString(entities.expenseDate) ||
      asString(entities.date) ||
      asString(entities.source) ||
      asString(entities.sourceAccount),
  );
}

/**
 * Trusted REVERSE_EXPENSE resolution (26C).
 * Never trusts provider expenseId / raw DB ids from the prompt.
 */
@Injectable()
export class ReverseExpenseEntityResolver {
  constructor(private readonly targets: ExpenseReversalTargetResolver) {}

  async resolve(args: {
    tenantId: string;
    conversationId: string;
    workspaceId: string;
    entities: Record<string, JsonValue>;
    lastReversibleAction?: LastReversibleActionContext | null;
  }): Promise<ReverseExpenseResolution> {
    const next: Record<string, JsonValue> = { ...args.entities };

    // Strip untrusted ids from provider / user.
    delete next.expenseId;
    delete next.targetId;
    delete next.operatingExpenseId;
    delete next.id;
    delete next.reversalIdempotencyKey;
    delete next.targetFingerprint;

    // Trusted picker / deictic selection (server-injected only).
    const selectedId =
      asString(next.selectedExpenseId) ??
      asString(next.trustedExpenseId) ??
      (asString(next.selectedEntityType) === 'OPERATING_EXPENSE'
        ? asString(next.selectedEntityId)
        : null);

    if (selectedId) {
      const resolved = await this.targets.resolveTrustedId(args.tenantId, selectedId);
      return this.mapResolve(next, resolved, 'picker');
    }

    const preferLast =
      looksLikeLastActionUndo(next) ||
      (!hasSearchHints(next) && Boolean(args.lastReversibleAction));

    if (preferLast || looksLikeLastActionUndo(next)) {
      const policy = evaluateLastReversibleAction({
        candidate: args.lastReversibleAction,
        tenantId: args.tenantId,
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
      });
      if (policy.kind === 'USE' && policy.context.capability === 'REVERSE_EXPENSE') {
        const resolved = await this.targets.resolveTrustedId(
          args.tenantId,
          policy.context.targetId,
        );
        if (resolved.kind === 'ALREADY_REVERSED') {
          return {
            kind: 'CLARIFY',
            entities: next,
            clarify: {
              field: 'target',
              entityType: 'OPERATING_EXPENSE',
              code: 'ALREADY_REVERSED',
              message: 'Ese gasto ya fue revertido.',
              candidates: [],
              items: [],
            },
          };
        }
        if (resolved.kind === 'TRUSTED') {
          // Prefer live fingerprint; reject if stored fingerprint drifted materially.
          if (
            policy.context.targetFingerprint &&
            policy.context.targetFingerprint !== resolved.target.targetFingerprint
          ) {
            // Still bind live target if still the same id and active — confirm will re-check.
            // Spec: stale fingerprint at confirm → STALE_PLAN. At preview, re-consult with live fp.
          }
          return this.mapResolve(next, resolved, 'last_action');
        }
        if (resolved.kind === 'NONE') {
          return {
            kind: 'CLARIFY',
            entities: next,
            clarify: {
              field: 'target',
              entityType: 'OPERATING_EXPENSE',
              code: 'NO_MATCH',
              message: 'No encontré un gasto activo que coincida con eso.',
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
            entityType: 'OPERATING_EXPENSE',
            code: 'NO_LAST_ACTION',
            message:
              'No tengo un gasto reciente en esta conversación para deshacer. ¿Cuál gasto quieres revertir?',
            candidates: [],
            items: [],
          },
        };
      }
    }

    const query = this.buildSearchQuery(next);
    if (
      query.amount == null &&
      !query.category &&
      !query.conceptContains &&
      !query.expenseDate &&
      !query.sourceAccount
    ) {
      return {
        kind: 'CLARIFY',
        entities: next,
        clarify: {
          field: 'amount',
          entityType: 'OPERATING_EXPENSE',
          code: 'MISSING_AMOUNT',
          message: '¿De cuánto fue el gasto que quieres revertir?',
          candidates: [],
          items: [],
        },
      };
    }

    const resolved = await this.targets.resolveSearch(args.tenantId, query);
    return this.mapResolve(next, resolved, 'search');
  }

  private buildSearchQuery(entities: Record<string, JsonValue>): ExpenseReversalSearchQuery {
    const amount = asNumber(entities.amount);
    const concept =
      asString(entities.conceptContains) ??
      asString(entities.concept) ??
      asString(entities.notes);
    const categoryRaw = asString(entities.category);
    let category: OperatingExpenseCategory | null = null;
    if (categoryRaw && (Object.keys(EXPENSE_CATEGORY_LABELS) as string[]).includes(categoryRaw)) {
      category = categoryRaw as OperatingExpenseCategory;
    } else if (concept || categoryRaw) {
      const cat = resolveExpenseCategory({
        category: categoryRaw,
        concept,
        notes: asString(entities.notes),
      });
      if (cat.kind === 'RESOLVED') category = cat.category;
    }

    const source =
      asString(entities.sourceAccount) ?? asString(entities.source);
    const sourceAccount =
      source === 'CASH' || source === 'BANK' || source === 'CESAR' ? source : null;

    const date =
      asString(entities.expenseDate) ??
      asString(entities.effectiveDate) ??
      asString(entities.date);
    const dateLabel = asString(entities.dateLabel);
    let expenseDate: string | Date | null = date;
    if (!expenseDate && dateLabel) {
      const now = new Date();
      const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      if (/hoy|today/i.test(dateLabel)) expenseDate = utc;
      else if (/ayer|yesterday/i.test(dateLabel)) {
        expenseDate = new Date(utc.getTime() - 24 * 60 * 60 * 1000);
      }
    }

    return {
      amount,
      category,
      sourceAccount,
      expenseDate,
      // Prefer category match; only soft-search notes when category unresolved.
      conceptContains: category ? null : concept,
    };
  }

  private mapResolve(
    entities: Record<string, JsonValue>,
    resolved: Awaited<ReturnType<ExpenseReversalTargetResolver['resolveTrustedId']>>,
    targetSource: 'last_action' | 'search' | 'picker' | 'selected',
  ): ReverseExpenseResolution {
    if (resolved.kind === 'NONE') {
      return {
        kind: 'CLARIFY',
        entities,
        clarify: {
          field: 'target',
          entityType: 'OPERATING_EXPENSE',
          code: 'NO_MATCH',
          message: 'No encontré un gasto activo que coincida con eso.',
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
          entityType: 'OPERATING_EXPENSE',
          code: 'ALREADY_REVERSED',
          message: 'Ese gasto ya fue revertido.',
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
      // ids stay in assistant payload for working-context candidate binding only —
      // provider context strips them via toProviderConversationContext.
      const items = candidates.map((c) => ({
        id: c.id,
        ordinal: c.ordinal,
        label: c.label,
        name: c.label,
      }));
      return {
        kind: 'CLARIFY',
        entities,
        clarify: {
          field: 'target',
          entityType: 'OPERATING_EXPENSE',
          code: 'AMBIGUOUS_EXPENSE',
          message: `Encontré ${candidates.length} gastos que coinciden. ¿Cuál quieres revertir?`,
          candidates,
          items,
        },
      };
    }

    const snap = resolved.target.targetSnapshot;
    if (snap.kind !== 'OPERATING_EXPENSE') {
      return {
        kind: 'CLARIFY',
        entities,
        clarify: {
          field: 'target',
          entityType: 'OPERATING_EXPENSE',
          code: 'NO_MATCH',
          message: 'No encontré un gasto activo que coincida con eso.',
          candidates: [],
          items: [],
        },
      };
    }
    const preview = buildExpenseReversalPreview(snap);
    const categoryLabel =
      EXPENSE_CATEGORY_LABELS[snap.category as keyof typeof EXPENSE_CATEGORY_LABELS] ??
      snap.category;
    const sourceLabel = snap.sourceAccount
      ? EXPENSE_SOURCE_LABELS[snap.sourceAccount] ?? snap.sourceAccount
      : null;

    return {
      kind: 'READY',
      targetSource,
      entities: {
        ...entities,
        targetId: resolved.target.targetId,
        trustedExpenseId: resolved.target.targetId,
        targetFingerprint: resolved.target.targetFingerprint,
        trustedTargetFingerprint: resolved.target.targetFingerprint,
        amount: snap.amount,
        currency: snap.currency,
        category: snap.category,
        categoryLabel,
        concept: snap.conceptLabel ?? categoryLabel,
        sourceAccount: snap.sourceAccount,
        sourceLabel,
        expenseDate: snap.expenseDate,
        legacyMode: preview.legacyMode,
        restoresLiquidity: preview.restoresLiquidity,
        hasCanonicalTreasuryOutflow: snap.hasCanonicalTreasuryOutflow,
        targetSafeLabel: preview.targetSafeLabel,
        reversalEffects: preview.reversalEffects as unknown as JsonValue,
        targetSource,
      },
    };
  }
}
