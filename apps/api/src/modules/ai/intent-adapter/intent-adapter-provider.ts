import { KnownIntent } from './intent-schema';

/**
 * Bounded conversational context (Part 8). Deliberately a small, flat,
 * structured record — never a raw message transcript. Every field here is
 * either an id/enum (safe to pass) or already-sanitized text bounded to a
 * short length.
 */
export interface BoundedConversationContext {
  lastIntent?: KnownIntent;
  /** Already-sanitized (see safety.ts) — ids/enums/short scalars only. */
  lastResolvedEntities?: Record<string, string | number | boolean | null>;
  /** e.g. entity ids previously shown to the user as A/B/C choices, for "the first one" / "that one". */
  lastPresentedCandidateIds?: string[];
  /** Field names the previous turn was still waiting on. */
  pendingMissingFields?: string[];
  conversationLanguage?: string;
}

export interface IntentInterpretationInput {
  userText: string;
  locale: string;
  timezone: string;
  allowedIntents: readonly string[];
  conversationContext?: BoundedConversationContext;
  /** ISO date (YYYY-MM-DD), used only to resolve relative references like "este mes". */
  currentDate: string;
  requestTraceId: string;
}

/**
 * What a provider hands back BEFORE any validation. This is untrusted input
 * from the adapter's point of view — see intent-schema.ts's
 * rawIntentCandidateSchema, which is the only thing ever trusted downstream.
 */
export interface IntentInterpretationRawResult {
  /** Raw JSON the provider returned — validated by the caller, never trusted here. */
  output: unknown;
  provider: string;
  model: string;
  latencyMs: number;
  tokenUsage?: { inputTokens?: number; outputTokens?: number };
  /** Present only when the provider call itself failed (timeout, network, policy refusal, etc). */
  failure?: IntentProviderFailure;
}

export type IntentProviderFailureType =
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'INVALID_OUTPUT'
  | 'POLICY_VIOLATION'
  | 'RATE_LIMITED'
  | 'UNKNOWN_ERROR';

export interface IntentProviderFailure {
  type: IntentProviderFailureType;
  /** Safe, non-raw diagnostic summary — never the provider's raw error/message body. */
  detail?: string;
}

/**
 * Provider-neutral contract. A provider's ONLY job is
 * natural-language text -> a JSON object shaped like RawIntentCandidate.
 * It must never be handed tool definitions, database schemas, secrets, or
 * unbounded conversation history — see IntentInterpretationInput above for
 * the full allowed surface.
 */
export interface IntentAdapterProvider {
  readonly providerName: string;
  interpret(input: IntentInterpretationInput): Promise<IntentInterpretationRawResult>;
}
