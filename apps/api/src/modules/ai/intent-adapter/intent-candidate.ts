import { createHash } from 'node:crypto';
import { normalizeEntities } from './normalization';
import {
  Ambiguity,
  ConfidenceLevel,
  entitySchemas,
  IntentCandidateIntent,
  isReadIntent,
  isWriteIntent,
  KnownIntent,
  rawIntentCandidateSchema,
} from './intent-schema';

/**
 * The fully validated, normalized result of interpreting one message. This
 * is the ONLY shape natural-language-assistant.service.ts is allowed to act
 * on — it is never constructed except by buildIntentCandidate below.
 */
export interface StructuredIntentCandidate {
  intent: IntentCandidateIntent;
  entities: Record<string, string | number | boolean>;
  missingEntities: string[];
  ambiguities: Ambiguity[];
  confidence: ConfidenceLevel;
  language: string;
  normalizedUserText?: string;
  isReadIntent: boolean;
  isWriteIntent: boolean;
  /** Stable hash of the candidate's own content — used for audit, never for security decisions. */
  candidateHash: string;
}

export type IntentCandidateFailureReason =
  | 'INVALID_OUTPUT_SHAPE'
  | 'ENTITY_SCHEMA_INVALID';

export type IntentCandidateResult =
  | { kind: 'VALID'; candidate: StructuredIntentCandidate }
  | { kind: 'FAILED'; reason: IntentCandidateFailureReason; issueCount: number; issuePaths: string[] };

function hashCandidate(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Validates raw provider output against the strict candidate schema, then
 * normalizes and re-validates its entities against the matching per-intent
 * schema. Nothing here ever calls a tool, a domain service, or Prisma —
 * it is pure data transformation over the provider's own JSON output.
 */
export function buildIntentCandidate(rawOutput: unknown, currentDate: string): IntentCandidateResult {
  const parsed = rawIntentCandidateSchema.safeParse(rawOutput);
  if (!parsed.success) {
    return {
      kind: 'FAILED',
      reason: 'INVALID_OUTPUT_SHAPE',
      issueCount: parsed.error.issues.length,
      issuePaths: parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 10),
    };
  }
  const raw = parsed.data;

  if (raw.intent === 'UNKNOWN') {
    return {
      kind: 'VALID',
      candidate: {
        intent: 'UNKNOWN',
        entities: {},
        missingEntities: [],
        ambiguities: raw.ambiguities,
        confidence: raw.confidence,
        language: raw.language,
        normalizedUserText: raw.normalizedUserText,
        isReadIntent: false,
        isWriteIntent: false,
        candidateHash: hashCandidate(raw),
      },
    };
  }

  const intent = raw.intent as KnownIntent;
  const normalizedEntities = normalizeEntities({ intent, entities: raw.entities }, { currentDate });
  const entitySchema = entitySchemas[intent];
  const entityResult = entitySchema.safeParse(normalizedEntities);
  if (!entityResult.success) {
    return {
      kind: 'FAILED',
      reason: 'ENTITY_SCHEMA_INVALID',
      issueCount: entityResult.error.issues.length,
      issuePaths: entityResult.error.issues.map((issue) => issue.path.join('.')).slice(0, 10),
    };
  }

  // Only entities that survived per-intent validation are "resolved" —
  // anything the model claimed but that failed type/format checks is
  // treated as not provided at all (never partially trusted).
  const resolvedEntities = entityResult.data as Record<string, string | number | boolean>;
  const missingEntities = raw.missingEntities.filter((field) => !(field in resolvedEntities));

  const candidate: StructuredIntentCandidate = {
    intent,
    entities: resolvedEntities,
    missingEntities,
    ambiguities: raw.ambiguities,
    confidence: raw.confidence,
    language: raw.language,
    normalizedUserText: raw.normalizedUserText,
    isReadIntent: isReadIntent(intent),
    isWriteIntent: isWriteIntent(intent),
    candidateHash: hashCandidate({ intent, entities: resolvedEntities, missingEntities, confidence: raw.confidence }),
  };
  return { kind: 'VALID', candidate };
}
