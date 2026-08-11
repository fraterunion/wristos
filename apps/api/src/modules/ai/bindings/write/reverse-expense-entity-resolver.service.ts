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
    | 'WEAK_SEARCH'
    | 'NO_LAST_ACTION';
};

export type ReverseExpenseResolution =
  | { kind: 'READY'; entities: Record<string, JsonValue>; targetSource: 'last_action' | 'search' | 'picker' | 'selected' }
  | {
      kind: 'CLARIFY';
      entities: Record<string, JsonValue>;
      clarify: ReverseExpenseClarify;
    };

export type SearchDiscriminators = {
  amount: number | null;
  category: OperatingExpenseCategory | null;
  sourceAccount: 'CASH' | 'BANK' | 'CESAR' | null;
  expenseDate: string | Date | null;
  /** Soft notes filter — never sufficient alone. */
  conceptContains: string | null;
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
      asString(entities.category) ||
      asString(entities.concept) ||
      asString(entities.conceptContains) ||
      asString(entities.notes) ||
      asString(entities.effectiveDate) ||
      asString(entities.expenseDate) ||
      asString(entities.date) ||
      asString(entities.dateLabel) ||
      asString(entities.source) ||
      asString(entities.sourceAccount),
  );
}

/**
 * Trusted search requires a strong discriminator pair.
 * Priority (after last-action / selected):
 * 1. amount + date
 * 2. amount + category
 * 3. amount + source
 * 4. category + date
 * 5. category + source
 * conceptContains is never sufficient alone — only a soft filter with another key.
 */
export function isTrustedExpenseSearch(d: SearchDiscriminators): boolean {
  const hasAmount = d.amount != null;
  const hasDate = d.expenseDate != null;
  const hasCategory = d.category != null;
  const hasSource = d.sourceAccount != null;
  return (
    (hasAmount && hasDate) ||
    (hasAmount && hasCategory) ||
    (hasAmount && hasSource) ||
    (hasCategory && hasDate) ||
    (hasCategory && hasSource)
  );
}

export function buildExpenseSearchDiscriminators(
  entities: Record<string, JsonValue>,
): SearchDiscriminators {
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

  const source = asString(entities.sourceAccount) ?? asString(entities.source);
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

  // Soft notes filter only when category was NOT derived from the same concept text.
  // Never use conceptContains as the sole discriminator.
  const conceptContains =
    category && concept && !categoryRaw
      ? null
      : category
        ? null
        : concept;

  return {
    amount,
    category,
    sourceAccount,
    expenseDate,
    conceptContains,
  };
}

function weakSearchClarifyMessage(d: SearchDiscriminators): {
  field: ReverseExpenseClarify['field'];
  message: string;
} {
  if (d.category && !d.amount && !d.expenseDate && !d.sourceAccount) {
    const label =
      EXPENSE_CATEGORY_LABELS[d.category] ?? d.category.toLowerCase();
    return {
      field: 'amount',
      message: `¿De cuánto fue el gasto de ${label.toLowerCase()}, o de qué día?`,
    };
  }
  if (d.amount != null && !d.category && !d.expenseDate && !d.sourceAccount) {
    return {
      field: 'date',
      message: '¿De qué día fue ese gasto, o de qué categoría?',
    };
  }
  if (d.conceptContains && !d.amount && !d.category && !d.expenseDate && !d.sourceAccount) {
    return {
      field: 'amount',
      message: '¿De cuánto fue el gasto, o de qué día?',
    };
  }
  return {
    field: 'amount',
    message: '¿De cuánto fue el gasto que quieres revertir?',
  };
}

function ambiguousClarifyMessage(
  candidates: PresentedCandidate[],
  entities: Record<string, JsonValue>,
): string {
  const categoryLabel =
    asString(entities.categoryLabel) ??
    (asString(entities.category)
      ? EXPENSE_CATEGORY_LABELS[asString(entities.category)!] ?? null
      : null) ??
    asString(entities.concept);
  if (categoryLabel && candidates.length >= 2) {
    return `Encontré varios gastos de ${categoryLabel.toLowerCase()}. ¿Cuál quieres revertir?`;
  }
  if (candidates.length >= 2) {
    return 'Encontré varios gastos. ¿Cuál quieres revertir?';
  }
  return '¿Cuál gasto quieres revertir?';
}

/**
 * Trusted REVERSE_EXPENSE resolution (26C hardening).
 * Never trusts provider expenseId / raw DB ids from the prompt.
 * Never binds on concept-only or category-only search.
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

    // 1) Trusted picker / deictic selection (server-injected only).
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

    // 2) Trusted last reversible action (same conversation/workspace, bounded recency).
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

    // 3–7) Deterministic search with trusted discriminator pairs only.
    const discriminators = buildExpenseSearchDiscriminators(next);
    if (!isTrustedExpenseSearch(discriminators)) {
      const weak = weakSearchClarifyMessage(discriminators);
      return {
        kind: 'CLARIFY',
        entities: next,
        clarify: {
          field: weak.field,
          entityType: 'OPERATING_EXPENSE',
          code: 'WEAK_SEARCH',
          message: weak.message,
          candidates: [],
          items: [],
        },
      };
    }

    const query: ExpenseReversalSearchQuery = {
      amount: discriminators.amount,
      category: discriminators.category,
      sourceAccount: discriminators.sourceAccount,
      expenseDate: discriminators.expenseDate,
      // Soft notes only when another discriminator already made the search trusted.
      conceptContains: discriminators.conceptContains,
    };

    const resolved = await this.targets.resolveSearch(args.tenantId, query);
    return this.mapResolve(next, resolved, 'search');
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
          message: ambiguousClarifyMessage(candidates, entities),
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
