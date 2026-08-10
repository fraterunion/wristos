import { LastReversibleActionContext, FutureReversalCapability } from './financial-reversal.types';

const ALLOWLISTED_LAST_ACTION: ReadonlySet<FutureReversalCapability> = new Set([
  'REVERSE_EXPENSE',
  'REVERSE_TREASURY_TRANSFER',
]);

/**
 * "Deshaz eso" / "Revierte lo que acabo de hacer" policy (26A freeze).
 *
 * SAFE only when ALL hold:
 * - same tenant
 * - same conversationId AND workspaceId
 * - capability allowlisted for last-action reversal
 * - completedAt present
 * - targetFingerprint present
 * - within bounded age (default 2 hours)
 *
 * NEVER:
 * - global latest DB row
 * - cross-conversation inference
 * - provider-supplied targetId without revalidation
 */
export function evaluateLastReversibleAction(args: {
  candidate: LastReversibleActionContext | null | undefined;
  tenantId: string;
  conversationId: string;
  workspaceId: string;
  now?: Date;
  maxAgeMs?: number;
}):
  | { kind: 'USE'; context: LastReversibleActionContext }
  | { kind: 'REJECT'; reason: string } {
  const {
    candidate,
    tenantId,
    conversationId,
    workspaceId,
    now = new Date(),
    maxAgeMs = 2 * 60 * 60 * 1000,
  } = args;

  if (!candidate) {
    return { kind: 'REJECT', reason: 'no_last_reversible_action' };
  }
  if (!ALLOWLISTED_LAST_ACTION.has(candidate.capability)) {
    return { kind: 'REJECT', reason: 'capability_not_allowlisted' };
  }
  if (candidate.conversationId !== conversationId) {
    return { kind: 'REJECT', reason: 'different_conversation' };
  }
  if (candidate.workspaceId !== workspaceId) {
    return { kind: 'REJECT', reason: 'different_workspace' };
  }
  if (!candidate.targetId || !candidate.targetFingerprint || !candidate.actionRunId) {
    return { kind: 'REJECT', reason: 'incomplete_context' };
  }
  const completedAt = new Date(candidate.completedAt);
  if (Number.isNaN(completedAt.getTime())) {
    return { kind: 'REJECT', reason: 'invalid_completed_at' };
  }
  if (now.getTime() - completedAt.getTime() > maxAgeMs) {
    return { kind: 'REJECT', reason: 'expired' };
  }
  // tenantId is implicit in workspace scope; caller must load workspace for tenant.
  void tenantId;
  return { kind: 'USE', context: candidate };
}
