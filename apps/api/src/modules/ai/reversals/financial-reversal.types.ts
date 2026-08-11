/**
 * Commit 26A — Financial Reversal Safety Framework (pure types).
 *
 * Shared contracts ONLY. No generic mutation service.
 * Domain economics stay in ExpenseRegistrationService / TreasuryTransferService.
 *
 * 26C: REVERSE_EXPENSE is AI-bound (WRITE #13).
 * 26D: REVERSE_TREASURY_TRANSFER is AI-bound (WRITE #14).
 */

import type { ExpenseReversalEconomicClass } from './expense-reversal-classification';

export type { ExpenseReversalEconomicClass };

export const REVERSAL_FRAMEWORK_VERSION = '1.0.0';

/** All reversal capabilities in the framework (bound + unbound). */
export const REVERSAL_CAPABILITIES = [
  'REVERSE_EXPENSE',
  'REVERSE_TREASURY_TRANSFER',
] as const;

export type ReversalCapability = (typeof REVERSAL_CAPABILITIES)[number];

/** Future unbound reversals — must not appear in WriteCapabilityBindingRegistry yet. */
export const FUTURE_REVERSAL_CAPABILITIES = [] as const;

export type FutureReversalCapability = ReversalCapability;

export type ReversalTargetType = 'OPERATING_EXPENSE' | 'TREASURY_TRANSFER';

/**
 * Server-trusted reversal target. Provider/user must NEVER supply targetId.
 * Injected only after deterministic server-side resolution.
 */
export type TrustedReversalTarget = {
  capability: ReversalCapability;
  targetType: ReversalTargetType;
  targetId: string;
  tenantId: string;
  /** Material economics fingerprint — revalidated at confirm. */
  targetFingerprint: string;
  /** Safe UI snapshot (no raw DB IDs exposed to the model). */
  targetSnapshot: ReversalTargetSnapshot;
  observedAt: string;
};

export type ExpenseReversalSnapshot = {
  kind: 'OPERATING_EXPENSE';
  amount: string;
  currency: 'MXN' | 'USD';
  category: string;
  sourceAccount: 'CASH' | 'BANK' | 'CESAR' | null;
  expenseDate: string | null;
  conceptLabel: string | null;
  /** True only for CANONICAL_VALID with an active OUTFLOW leg. */
  hasCanonicalTreasuryOutflow: boolean;
  active: boolean;
  /** 26C.1 positive classification — never infer legacy from a missing active leg alone. */
  economicClass: ExpenseReversalEconomicClass;
};

export type TransferReversalSnapshot = {
  kind: 'TREASURY_TRANSFER';
  amount: string;
  currency: 'MXN';
  sourceAccount: 'CASH' | 'BANK' | 'CESAR';
  destinationAccount: 'CASH' | 'BANK' | 'CESAR';
  transferDate: string | null;
  active: boolean;
  pairComplete: boolean;
};

export type ReversalTargetSnapshot = ExpenseReversalSnapshot | TransferReversalSnapshot;

export type ReversalRiskTier = 'HIGH';

export type ReversalPreviewContract = {
  targetCapability: ReversalCapability;
  targetSafeLabel: string;
  originalAmount: string;
  originalDate: string | null;
  reversalEffects: Array<{ area: string; description: string }>;
  restoresLiquidity: boolean;
  changesPnl: boolean;
  changesCapital: boolean;
  legacyMode: boolean;
  riskTier: ReversalRiskTier;
};

export type ReversalReceiptContract = {
  reversedTargetId: string;
  reversedCapability: ReversalCapability;
  reversedAt: string;
  restoredLiquidity: boolean;
  pnlChanged: boolean;
  capitalChanged: boolean;
  legacyMode: boolean;
  recovered: boolean;
  causality: 'APPLIED' | 'SAME_COMMAND' | 'EXTERNAL';
  rollbackPossible: false;
};

/**
 * Bounded last-action referent for "Deshaz eso" — workspace JSON only.
 * Never trust without DB freshness + fingerprint revalidation.
 */
export type LastReversibleActionContext = {
  capability: ReversalCapability;
  targetType: ReversalTargetType;
  /** Hashed / internal id — not shown to LLM as authoritative. */
  targetId: string;
  targetFingerprint: string;
  actionRunId: string;
  safeLabel: string;
  completedAt: string;
  conversationId: string;
  workspaceId: string;
};

export type ReversalRecoveryClassification =
  | { kind: 'MATCH'; causality: 'SAME_COMMAND'; recovered: true }
  | { kind: 'EXTERNAL_ALREADY_REVERSED'; causality: 'EXTERNAL' }
  | { kind: 'MISSING' }
  | { kind: 'INVARIANT'; code: string }
  | { kind: 'STALE_TARGET'; code: string };

/** Server-owned reverse command key — never from provider. */
export function reversalCommandKey(actionRunId: string): string {
  return `ai-action-run:${actionRunId}`;
}
