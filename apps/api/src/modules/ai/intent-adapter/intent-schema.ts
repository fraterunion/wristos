import { z } from 'zod';

/**
 * The LLM's ONLY allowed output shape. Nothing outside this schema ever
 * reaches the planner or orchestrator — an LLM response that doesn't parse
 * against `rawIntentCandidateSchema` is treated as a provider failure, never
 * as partial trusted input.
 */

export const READ_INTENTS = [
  'GET_LIQUIDITY',
  'GET_MONTHLY_PROFIT',
  'SEARCH_INVENTORY',
  'SEARCH_CLIENT',
  'GET_CLIENT_ACCOUNTS',
] as const;

export const WRITE_INTENTS = [
  'REGISTER_SALE',
  'REGISTER_RECEIVABLE_PAYMENT',
  'REGISTER_PURCHASE',
  'REGISTER_EXPENSE',
  'REGISTER_SETTLEMENT',
  'REGISTER_CRYPTO_POSITION',
  'REGISTER_CRYPTO_PRICE',
] as const;

export const KNOWN_INTENTS = [...READ_INTENTS, ...WRITE_INTENTS] as const;

/** The complete allowlist the provider's structured output is constrained to. */
export const INTENT_CANDIDATE_VALUES = [...KNOWN_INTENTS, 'UNKNOWN'] as const;

export type ReadIntent = (typeof READ_INTENTS)[number];
export type WriteIntent = (typeof WRITE_INTENTS)[number];
export type KnownIntent = (typeof KNOWN_INTENTS)[number];
export type IntentCandidateIntent = (typeof INTENT_CANDIDATE_VALUES)[number];

export function isReadIntent(intent: string): intent is ReadIntent {
  return (READ_INTENTS as readonly string[]).includes(intent);
}

export function isWriteIntent(intent: string): intent is WriteIntent {
  return (WRITE_INTENTS as readonly string[]).includes(intent);
}

export const CONFIDENCE_VALUES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_VALUES)[number];

// Entity values coming straight off the provider are intentionally loosely
// typed (string | number | boolean | null) — per-intent schemas below narrow
// and coerce them. No nested objects/arrays are ever accepted here, which
// forecloses an entire class of injection/structure-smuggling attempts.
const rawEntityValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

export const ambiguitySchema = z
  .object({
    field: z.string().min(1).max(64),
    reason: z.string().min(1).max(280),
    candidates: z.array(z.string().min(1).max(120)).max(10).optional(),
  })
  .strict();

export type Ambiguity = z.infer<typeof ambiguitySchema>;

/**
 * The exact JSON shape the provider must return. `.strict()` rejects any
 * extra top-level key outright — a model trying to smuggle a `toolName`,
 * `sql`, `systemPrompt`, or similar field fails schema validation instead of
 * silently passing through.
 */
export const rawIntentCandidateSchema = z
  .object({
    intent: z.enum(INTENT_CANDIDATE_VALUES),
    entities: z.record(z.string().max(64), rawEntityValue).default({}),
    missingEntities: z.array(z.string().max(64)).max(20).default([]),
    ambiguities: z.array(ambiguitySchema).max(10).default([]),
    confidence: z.enum(CONFIDENCE_VALUES),
    language: z.string().min(2).max(10).default('es'),
    normalizedUserText: z.string().max(2000).optional(),
  })
  .strict();

export type RawIntentCandidate = z.infer<typeof rawIntentCandidateSchema>;

// ─── Per-intent entity schemas (Part 4) ────────────────────────────────────
// These validate/coerce the *normalized* entity bag (see normalization.ts).
// Unknown keys are dropped (not `.strict()`) — the raw candidate schema
// above is the hard allowlist boundary; here we're just being defensive
// about a model attaching noise to a field bag we already trust the shape
// of. Every field is optional at this layer: presence/absence is exactly
// what the existing PlannerService already uses to compute missing fields —
// duplicating a "required" concept here would drift from that single source
// of truth.

const currency = z.enum(['MXN', 'USD']);
// Mirrors apps/api's existing money convention (see tools/read/read-tools.ts:
// `z.string().regex(/^-?\d+\.\d{2}$/)`), produced only after normalization.
const money = z.string().regex(/^-?\d+\.\d{2}$/, 'Expected a normalized 2-decimal amount string');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date (YYYY-MM-DD)');
const query = z.string().trim().min(1).max(120);

export const entitySchemas = {
  GET_LIQUIDITY: z.object({}).strip(),

  GET_MONTHLY_PROFIT: z
    .object({
      year: z.number().int().min(2000).max(2200).optional(),
      month: z.number().int().min(1).max(12).optional(),
    })
    .strip(),

  SEARCH_INVENTORY: z
    .object({
      query,
      status: z.enum(['AVAILABLE', 'RESERVED', 'ALL']).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strip(),

  SEARCH_CLIENT: z
    .object({
      query,
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strip(),

  GET_CLIENT_ACCOUNTS: z
    .object({
      // A real clientId is never fabricated by the LLM — it may only ever
      // appear here if it was echoed back from bounded conversation context
      // (see prompt-policy.ts / context.ts), never invented from free text.
      clientId: z.string().min(1).max(128).optional(),
      clientQuery: query.optional(),
      type: z.enum(['RECEIVABLE', 'PAYABLE', 'ALL']).optional(),
      status: z.enum(['OPEN', 'PARTIAL', 'PAID', 'ALL']).optional(),
    })
    .strip(),

  // Write intents: detection-only. None of these ever carry a real
  // <entity>Id — only *Query fields, which the existing planner's
  // requiredEntities (watchId, customerId, accountId, ...) can never treat
  // as satisfied. This is what structurally forces every write candidate
  // into NEEDS_CLARIFICATION rather than READY_FOR_CONFIRMATION.
  REGISTER_SALE: z
    .object({
      watchQuery: query.optional(),
      customerQuery: query.optional(),
      price: money.optional(),
      currency: currency.optional(),
      effectiveDate: isoDate.optional(),
      paymentMode: z.enum(['PAID', 'CREDIT', 'PARTIAL']).optional(),
    })
    .strip(),

  REGISTER_RECEIVABLE_PAYMENT: z
    .object({
      customerQuery: query.optional(),
      amount: money.optional(),
      currency: currency.optional(),
      destination: z.enum(['CASH', 'BANK', 'CESAR', 'CRYPTO']).optional(),
      effectiveDate: isoDate.optional(),
    })
    .strip(),

  REGISTER_PURCHASE: z
    .object({
      watchQuery: query.optional(),
      supplierQuery: query.optional(),
      cost: money.optional(),
      currency: currency.optional(),
      effectiveDate: isoDate.optional(),
      serial: z.string().trim().max(64).optional(),
    })
    .strip(),

  REGISTER_EXPENSE: z
    .object({
      concept: z.string().trim().min(1).max(160).optional(),
      amount: money.optional(),
      currency: currency.optional(),
      effectiveDate: isoDate.optional(),
    })
    .strip(),

  REGISTER_SETTLEMENT: z
    .object({
      sourceQuery: query.optional(),
      destinationQuery: query.optional(),
      amount: money.optional(),
      currency: currency.optional(),
      effectiveDate: isoDate.optional(),
    })
    .strip(),

  REGISTER_CRYPTO_POSITION: z
    .object({
      asset: z.string().trim().min(1).max(20).optional(),
      quantity: z.string().regex(/^\d+(\.\d+)?$/).optional(),
      cost: money.optional(),
      currency: currency.optional(),
      effectiveDate: isoDate.optional(),
    })
    .strip(),

  REGISTER_CRYPTO_PRICE: z
    .object({
      asset: z.string().trim().min(1).max(20).optional(),
      unitPrice: money.optional(),
      currency: currency.optional(),
      effectiveDate: isoDate.optional(),
    })
    .strip(),
} as const satisfies Record<KnownIntent, z.ZodTypeAny>;

export type EntitiesFor<T extends KnownIntent> = z.infer<(typeof entitySchemas)[T]>;
