/**
 * Commit 26A — Financial Reversal Safety Framework (pure types).
 *
 * Shared contracts ONLY. No generic mutation service.
 * Domain economics stay in ExpenseRegistrationService / TreasuryTransferService.
 *
 * REVERSE_EXPENSE and REVERSE_TREASURY_TRANSFER remain AI-UNBOUND in 26A.
 */

export const REVERSAL_FRAMEWORK_VERSION = '1.0.0';

/** Future AI write capabilities — NOT registered in WriteCapabilityBindingRegistry yet. */
export const FUTURE_REVERSAL_CAPABILITIES = [
  'REVERSE_EXPENSE',
  'REVERSE_TREASURY_TRANSFER',
] as const;

export type FutureReversalCapability = (typeof FUTURE_REVERSAL_CAPABILITIES)[number];

export type ReversalTargetType = 'OPERATING_EXPENSE' | 'TREASURY_TRANSFER';

/**
 * Server-trusted reversal target. Provider/user must NEVER supply targetId.
 * Injected only after deterministic server-side resolution.
 */
export type TrustedReversalTarget = {
  capability: FutureReversalCapability;
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
  hasCanonicalTreasuryOutflow: boolean;
  active: boolean;
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
  targetCapability: FutureReversalCapability;
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
  reversedCapability: FutureReversalCapability;
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
  capability: FutureReversalCapability;
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
