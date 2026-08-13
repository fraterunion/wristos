/**
 * ConversationDraft — the single source of truth for a write intent in
 * progress. Not "pending entities": a typed, self-describing document that
 * every message, picker, correction, and clarification answer PATCHES —
 * never rebuilds, never recreates.
 *
 * This is a representational upgrade over the flat entities bag this same
 * feature shipped with initially (context/working-context.ts's old
 * `pendingClarificationEntities: Record<string, unknown>`), not a new
 * architecture: the behavioral contract — one durable object per
 * conversation, patched in place, surviving until a terminal outcome — was
 * already correct. What was missing was a typed shape instead of ad hoc,
 * per-capability key names threaded by hand through every call site.
 *
 * Scope: `watch`/`customer`/`seller`/`investor`/`amount`/`payment` are
 * modeled explicitly because REGISTER_SALE and REGISTER_PURCHASE — the two
 * capabilities with this multi-field "living document" shape — are what
 * every correction/continuation example in this feature is about. Any
 * other capability's fields (REGISTER_EXPENSE's category, CREATE_RECEIVABLE's
 * dueDate, …) fall through to `metadata`, a plain bag that round-trips
 * losslessly via entitiesToDraftPatch()/draftToEntities() — so a capability
 * with no explicit CAPABILITY_DRAFT_MAPPING entry still gets a correct,
 * fully-functional Draft (just without named sub-fields), and can be
 * "graduated" into the typed shape later without a breaking change. This is
 * the deliberate seam for extending the model six months from now.
 *
 * Compatibility boundary: the planner, entity resolvers, ActionRun, and
 * WritePlanRunner are completely unaware this type exists — they still only
 * ever see the same flat `Record<string, JsonValue>` entities shape they
 * always have. draftToEntities()/entitiesToDraftPatch() are the ONLY two
 * functions that cross that boundary; nothing else in the planner/resolver
 * stack changed.
 */

import { JsonValue } from '../domain/canonical-json';

export type DraftEntityConfidence = 'RAW' | 'RESOLVED';

/** A person/watch reference at some point in its resolution lifecycle. */
export interface DraftEntityRef {
  /** Free text as typed/heard — "Bruce Wayne", "Abraham". Never trusted as an id. */
  raw?: string;
  /** A trusted id, set only once a resolver actually matched it against real data. */
  resolvedId?: string;
  /** Display label for the resolved entity (or the raw query, before resolution). */
  label?: string;
  confidence?: DraftEntityConfidence;
}

export interface DraftAmount {
  value?: string | number;
  currency?: string;
}

export interface DraftPayment {
  account?: string;
  mode?: string;
}

export type ConversationDraftStatus = 'ACTIVE' | 'FINALIZED' | 'CANCELLED';

export interface ConversationDraft {
  schemaVersion: '1';
  capability: string;
  watch?: DraftEntityRef;
  customer?: DraftEntityRef;
  seller?: DraftEntityRef;
  investor?: DraftEntityRef;
  amount?: DraftAmount;
  payment?: DraftPayment;
  issuedAt?: string;
  /** Everything this capability needs that doesn't have a named field above — round-trips losslessly. */
  metadata?: Record<string, JsonValue>;
  /**
   * Self-description only — the actual lifecycle (surviving until
   * SUCCESS/ERROR/CANCEL) is still enforced by StructuredAssistantPersistence
   * clearing the Draft from resolvedContext on those exact outcomes; this
   * field does not itself gate anything today. A Draft is always cleared,
   * never left around FINALIZED/CANCELLED, so in practice this reads ACTIVE
   * for a Draft's entire observable lifetime. Kept for forward
   * compatibility (e.g. a future audit trail) rather than removed.
   */
  status: ConversationDraftStatus;
  updatedAt: string;
}

type DraftPatchableFields = Pick<
  ConversationDraft,
  'watch' | 'customer' | 'seller' | 'investor' | 'amount' | 'payment' | 'issuedAt' | 'metadata'
>;

export function emptyDraft(capability: string, now = new Date()): ConversationDraft {
  return { schemaVersion: '1', capability, status: 'ACTIVE', updatedAt: now.toISOString() };
}

/**
 * PATCHes the Draft — never rebuilds it. Every top-level field in `patch`
 * (watch/customer/seller/investor/amount/payment/issuedAt) fully replaces
 * the corresponding field on the Draft; a field omitted from `patch`
 * survives untouched. `metadata` is the one exception: it merges key-by-key
 * (it's a bag of many unrelated capability-specific values, not a single
 * concept — replacing it wholesale on every patch would lose siblings a
 * correction never meant to touch).
 *
 * If `capability` differs from the Draft's own capability, this starts a
 * FRESH empty Draft instead of patching the old one — an abandoned draft's
 * leftover fields can never leak into an unrelated new write intent.
 */
export function applyDraftPatch(
  draft: ConversationDraft | null,
  patch: Partial<DraftPatchableFields>,
  capability: string,
  now = new Date(),
): ConversationDraft {
  const base = draft && draft.capability === capability ? draft : emptyDraft(capability, now);
  const { metadata: metadataPatch, ...rest } = patch;
  return {
    ...base,
    ...rest,
    ...(metadataPatch ? { metadata: { ...(base.metadata ?? {}), ...metadataPatch } } : {}),
    schemaVersion: '1',
    capability,
    status: 'ACTIVE',
    updatedAt: now.toISOString(),
  };
}

interface CapabilityDraftMapping {
  amountKey?: string;
  paymentKey?: string;
  party?: {
    slot: 'customer' | 'seller' | 'investor';
    /** First is the primary output key; the rest are aliases some resolver/binding also reads (e.g. REGISTER_SALE's customerId + clientId). */
    idKeys: string[];
    rawKey: string;
    labelKey: string;
  };
}

const CAPABILITY_DRAFT_MAPPING: Record<string, CapabilityDraftMapping> = {
  REGISTER_SALE: {
    amountKey: 'price',
    paymentKey: 'destination',
    party: { slot: 'customer', idKeys: ['customerId', 'clientId'], rawKey: 'customerQuery', labelKey: 'customerName' },
  },
  REGISTER_PURCHASE: {
    amountKey: 'cost',
    paymentKey: 'sourceAccount',
    party: { slot: 'seller', idKeys: ['sellerClientId'], rawKey: 'sellerQuery', labelKey: 'sellerLabel' },
  },
};

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}
function asAmountValue(v: unknown): string | number | undefined {
  return typeof v === 'string' || typeof v === 'number' ? v : undefined;
}
function firstDefinedStr(entities: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = asStr(entities[key]);
    if (v !== undefined) return v;
  }
  return undefined;
}
function refFrom(raw: string | undefined, resolvedId: string | undefined, label: string | undefined): DraftEntityRef | undefined {
  if (raw === undefined && resolvedId === undefined && label === undefined) return undefined;
  return { raw, resolvedId, label, confidence: resolvedId ? 'RESOLVED' : raw ? 'RAW' : undefined };
}

/**
 * Converts a flat entities bag (fresh NLP/router extraction, or a resolver's
 * returned entities) into a Draft patch. Bulk conversion — use this when
 * several related fields might legitimately be present together (a first
 * extraction naming watch+price+currency+customer all at once). For a
 * single-field CORRECTION where siblings must survive untouched, build the
 * patch directly instead (spread the Draft's current sub-object, override
 * just the one leaf) — see NaturalLanguageAssistantService.applyDraftCorrection.
 */
export function entitiesToDraftPatch(
  capability: string,
  entities: Record<string, unknown>,
): Partial<DraftPatchableFields> {
  const mapping = CAPABILITY_DRAFT_MAPPING[capability];
  const consumed = new Set<string>();
  const patch: Partial<DraftPatchableFields> = {};

  const watchRef = refFrom(asStr(entities.watchQuery), asStr(entities.watchId), asStr(entities.watchLabel));
  if (watchRef) {
    patch.watch = watchRef;
    consumed.add('watchQuery');
    consumed.add('watchId');
    consumed.add('watchLabel');
  }

  if (mapping?.party) {
    const { slot, idKeys, rawKey, labelKey } = mapping.party;
    const id = firstDefinedStr(entities, idKeys);
    const partyRef = refFrom(asStr(entities[rawKey]), id, asStr(entities[labelKey]));
    if (partyRef) {
      patch[slot] = partyRef;
      idKeys.forEach((k) => consumed.add(k));
      consumed.add(rawKey);
      consumed.add(labelKey);
    }
  }

  const amountVal = mapping?.amountKey ? asAmountValue(entities[mapping.amountKey]) : undefined;
  const currencyVal = asStr(entities.currency);
  if (amountVal !== undefined || currencyVal !== undefined) {
    patch.amount = { value: amountVal, currency: currencyVal };
    if (mapping?.amountKey) consumed.add(mapping.amountKey);
    consumed.add('currency');
  }

  const accountVal = mapping?.paymentKey ? asStr(entities[mapping.paymentKey]) : undefined;
  const modeVal = asStr(entities.paymentMode);
  if (accountVal !== undefined || modeVal !== undefined) {
    patch.payment = { account: accountVal, mode: modeVal };
    if (mapping?.paymentKey) consumed.add(mapping.paymentKey);
    consumed.add('paymentMode');
  }

  const metadata: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(entities)) {
    if (consumed.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      metadata[key] = value;
    }
  }
  if (Object.keys(metadata).length) patch.metadata = metadata;

  return patch;
}

/**
 * Converts the Draft back into the flat entities shape the planner/entity
 * resolvers/bindings have always consumed — called exactly once, right
 * before StructuredAssistantService.executeClaimed(). Nothing downstream of
 * that call knows a ConversationDraft exists.
 */
export function draftToEntities(draft: ConversationDraft): Record<string, string | number | boolean> {
  const mapping = CAPABILITY_DRAFT_MAPPING[draft.capability];
  const out: Record<string, string | number | boolean> = {};

  if (draft.watch?.resolvedId !== undefined) out.watchId = draft.watch.resolvedId;
  if (draft.watch?.raw !== undefined) out.watchQuery = draft.watch.raw;
  if (draft.watch?.label !== undefined) out.watchLabel = draft.watch.label;

  if (mapping?.party) {
    const party = draft[mapping.party.slot];
    if (party?.resolvedId !== undefined) {
      for (const idKey of mapping.party.idKeys) out[idKey] = party.resolvedId;
    }
    if (party?.raw !== undefined) out[mapping.party.rawKey] = party.raw;
    if (party?.label !== undefined) out[mapping.party.labelKey] = party.label;
  }

  if (mapping?.amountKey && draft.amount?.value !== undefined) out[mapping.amountKey] = draft.amount.value;
  if (draft.amount?.currency !== undefined) out.currency = draft.amount.currency;

  if (mapping?.paymentKey && draft.payment?.account !== undefined) out[mapping.paymentKey] = draft.payment.account;
  if (draft.payment?.mode !== undefined) out.paymentMode = draft.payment.mode;

  if (draft.metadata) {
    for (const [key, value] of Object.entries(draft.metadata)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    }
  }

  return out;
}
