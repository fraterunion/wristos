import { WriteIntent } from '../intent-adapter/intent-schema';

/**
 * The 10 WRITE capabilities the Operational Intent Router is allowed to
 * route to. A strict subset of WriteIntent — CREATE_CLIENT/UPDATE_CLIENT/
 * REVERSE_EXPENSE/REVERSE_TREASURY_TRANSFER/REGISTER_SETTLEMENT/crypto are
 * intentionally excluded (reversals already have their own deterministic
 * detectors that run earlier in precedence; the rest have no operational
 * verb lexicon in this router by design — see docs/ai/OPERATIONAL_INTENT_ROUTER.md).
 */
export const ROUTABLE_CAPABILITIES = [
  'REGISTER_SALE',
  'REGISTER_PURCHASE',
  'REGISTER_EXPENSE',
  'REGISTER_RECEIVABLE_PAYMENT',
  'REGISTER_PAYABLE_PAYMENT',
  'REGISTER_TREASURY_TRANSFER',
  'REGISTER_CAPITAL_CONTRIBUTION',
  'REGISTER_CAPITAL_DISTRIBUTION',
  'CREATE_RECEIVABLE',
  'CREATE_PAYABLE',
] as const satisfies readonly WriteIntent[];

export type RoutableCapability = (typeof ROUTABLE_CAPABILITIES)[number];

export type RouterEntityValue = string | number | boolean;
export type RouterEntities = Record<string, RouterEntityValue>;

/** Where in the normalized text a lexicon's verb phrase matched — used by negation-guard proximity. */
export interface VerbMatch {
  /** Index into the NORMALIZED text (see text-normalize.ts) where the verb phrase begins. */
  index: number;
  matchedText: string;
}

export interface LexiconMatchResult {
  verbMatch: VerbMatch;
  entities: RouterEntities;
  /**
   * When false, this capability match alone is not enough to claim
   * HIGH_CONFIDENCE_OPERATION — e.g. bare "Pagué 50 mil" with no category
   * word and no counterparty pattern. The router treats this as
   * AMBIGUOUS_OPERATION rather than silently picking a capability.
   */
  sufficientEvidence: boolean;
  /** Human-readable evidence trail for telemetry/debugging — never shown to the end user. */
  evidence: string[];
}

export interface CapabilityLexicon {
  capability: RoutableCapability;
  /**
   * Attempts to match this capability's verb lexicon against NORMALIZED text
   * (see text-normalize.ts) and extract whatever slots are safely available
   * from the ORIGINAL raw text. Returns null when this capability's lexicon
   * doesn't fire at all (not even ambiguously) — the router tries the next
   * lexicon in that case.
   */
  detect(normalizedText: string, rawText: string): LexiconMatchResult | null;
}

export type RouterVerdict =
  | { kind: 'HIGH_CONFIDENCE_OPERATION'; capability: RoutableCapability; entities: RouterEntities; evidence: string[] }
  | { kind: 'AMBIGUOUS_OPERATION'; reason: string; candidateCapabilities: RoutableCapability[] }
  | { kind: 'NO_OPERATION_MATCH' };

/**
 * The exact shape IntentAdapterService.interpretDeterministic() expects —
 * mirrors what a successful Claude tool-call would produce, so it can be fed
 * through the identical buildIntentCandidate() validation gate the provider
 * path uses. See intent-adapter/intent-candidate.ts.
 */
export interface RouterRawCandidateOutput {
  intent: RoutableCapability;
  entities: RouterEntities;
  missingEntities: [];
  ambiguities: [];
  confidence: 'HIGH';
  language: 'es';
}
