/**
 * Assistant telemetry event model (Commit 16).
 * Append-only ephemeral taxonomy for tests/dev sinks.
 *
 * Production source of truth is durable AIRequest / AIActionRun / AIAuditEvent.
 * Many of these names are DERIVED at query time — do not duplicate-append them
 * into a second shadow store.
 *
 * Outcomes apply to AIRequest / AIActionRun / capability attempts —
 * NOT to resumable conversations.
 */

export const TELEMETRY_CHANNEL = 'assistant.telemetry.v1' as const;

export type TelemetryEventName =
  | 'ConversationStarted'
  | 'ConversationFinished'
  | 'ProviderStarted'
  | 'ProviderCompleted'
  | 'PlannerStarted'
  | 'PlannerCompleted'
  | 'ClarificationShown'
  | 'ClarificationAnswered'
  | 'ClarificationAbandoned'
  | 'PreviewShown'
  | 'PreviewEdited'
  | 'PreviewCancelled'
  | 'PreviewConfirmed'
  | 'ExecutionStarted'
  | 'ExecutionRecovered'
  | 'ExecutionCompleted'
  | 'ExecutionFailed'
  | 'ReplayServed';

export type ConversationOutcome =
  | 'SUCCESS'
  | 'FAILED'
  | 'ABANDONED'
  | 'CANCELLED'
  | 'RECOVERED'
  | 'REPLAYED';

/** @deprecated Name kept for ephemeral tests — prefer request/action-run outcomes in durable reports. */

export type FailureTaxonomy =
  | 'UNKNOWN_INTENT'
  | 'LOW_CONFIDENCE'
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_AMBIGUOUS'
  | 'SCHEMA_INVALID'
  | 'STALE_PLAN'
  | 'FINGERPRINT_CHANGED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'DOMAIN_FAILURE'
  | 'RECOVERY_FAILURE'
  | 'INVARIANT_FAILURE'
  | 'OTHER';

export type ClarificationType =
  | 'MISSING_AMOUNT'
  | 'MISSING_CUSTOMER'
  | 'MISSING_DESTINATION'
  | 'MISSING_SOURCE'
  | 'MISSING_CATEGORY'
  | 'MISSING_FIELD'
  | 'ENTITY_AMBIGUITY'
  | 'UNKNOWN_REFERENCE'
  | 'NO_CONTEXT'
  | 'EXPIRED_CONTEXT'
  | 'UNSUPPORTED'
  | 'OTHER';

export type TelemetryEvent = {
  /** Stable event name. */
  event: TelemetryEventName;
  /** ISO timestamp when emitted. */
  at: string;
  /** Monotonic sequence within process (ordering aid). */
  seq: number;
  /** Tenant hash (sha256 prefix), never raw tenantId in exports when hashed. */
  tenantHash?: string;
  /** Hashed conversation / request / action-run / workspace ids. */
  conversationHash?: string;
  requestHash?: string;
  actionRunHash?: string;
  workspaceHash?: string;
  /** Capability / intent labels (allowlisted strings). */
  capability?: string;
  providerIntent?: string;
  normalizedIntent?: string;
  plannerIntent?: string;
  /** Latency slices in ms (independent). */
  providerLatencyMs?: number;
  plannerLatencyMs?: number;
  bindingLatencyMs?: number;
  domainLatencyMs?: number;
  totalLatencyMs?: number;
  /** Clarification. */
  clarificationReason?: string;
  clarificationType?: ClarificationType;
  answered?: boolean;
  answerLatencyMs?: number;
  abandoned?: boolean;
  /** Preview / execution flags — never inferred; only explicit emitters. */
  shown?: boolean;
  edited?: boolean;
  cancelled?: boolean;
  confirmed?: boolean;
  completed?: boolean;
  failed?: boolean;
  recovered?: boolean;
  replayed?: boolean;
  recoveryReason?: string;
  recoveryDurationMs?: number;
  idempotentReplay?: boolean;
  /** Provider. */
  provider?: string;
  model?: string;
  timeout?: boolean;
  schemaValidationFailure?: boolean;
  tokenInput?: number;
  tokenOutput?: number;
  /** Entity resolution. */
  candidateCount?: number;
  uniqueResolution?: boolean;
  multipleCandidates?: boolean;
  zeroCandidates?: boolean;
  entityPickerUsed?: boolean;
  ordinalUsed?: boolean;
  deicticUsed?: boolean;
  /** Failure / outcome. */
  failureType?: FailureTaxonomy;
  outcome?: ConversationOutcome;
  /** Dangerous-write funnel stage marker. */
  funnelStage?: 'intent' | 'preview' | 'confirmation' | 'execution' | 'receipt' | 'completed';
  /** Free-form safe metadata (already sanitized). */
  meta?: Record<string, string | number | boolean | null>;
};

export type TelemetryEmitInput = Omit<TelemetryEvent, 'at' | 'seq'> & {
  tenantId?: string;
  conversationId?: string;
  requestId?: string;
  actionRunId?: string;
  workspaceId?: string;
};
