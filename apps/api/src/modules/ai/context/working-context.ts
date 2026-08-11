import { createHash } from 'node:crypto';
import { z } from 'zod';
import { KnownIntent, KNOWN_INTENTS } from '../intent-adapter/intent-schema';
import { CONTEXT_ENTITY_TYPES, ContextEntityType } from './entity-types';

export { CONTEXT_ENTITY_TYPES, type ContextEntityType } from './entity-types';

export const WORKING_CONTEXT_SCHEMA_VERSION = '1.1' as const;

/** Candidate lists expire after 30 minutes from presentation. */
export const CANDIDATE_CONTEXT_TTL_MS = 30 * 60 * 1000;

const entityTypeSchema = z.enum(CONTEXT_ENTITY_TYPES);

const presentedCandidateSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(160),
    ordinal: z.number().int().min(1).max(10),
  })
  .strict();

export const assistantWorkingContextSchema = z
  .object({
    schemaVersion: z.literal(WORKING_CONTEXT_SCHEMA_VERSION),
    lastIntent: z.enum(KNOWN_INTENTS).optional(),
    lastResolvedEntities: z
      .object({
        watchId: z.string().min(1).max(128).optional(),
        clientId: z.string().min(1).max(128).optional(),
        accountEntryId: z.string().min(1).max(128).optional(),
        investorId: z.string().min(1).max(128).optional(),
        expenseId: z.string().min(1).max(128).optional(),
      })
      .strict()
      .optional(),
    lastSelectedEntity: z
      .object({
        type: entityTypeSchema,
        id: z.string().min(1).max(128),
        label: z.string().min(1).max(160),
      })
      .strict()
      .optional(),
    lastPresentedCandidates: z
      .object({
        type: entityTypeSchema,
        candidates: z.array(presentedCandidateSchema).max(10),
        presentedAt: z.string().min(10).max(40),
      })
      .strict()
      .optional(),
    pendingMissingFields: z.array(z.string().min(1).max(64)).max(20).optional(),
    pendingActionRunId: z.string().min(1).max(128).optional(),
    lastResponseType: z.string().min(1).max(64).optional(),
    contextUpdatedAt: z.string().min(10).max(40),
  })
  .strict();

export type AssistantWorkingContext = z.infer<typeof assistantWorkingContextSchema>;
export type PresentedCandidate = z.infer<typeof presentedCandidateSchema>;

/** Shell stored inside AIWorkspace.resolvedContext JSON. */
export interface ResolvedContextShell {
  entityVersions?: Record<string, string | number>;
  planFingerprint?: string;
  workingContext?: AssistantWorkingContext;
  [key: string]: unknown;
}

export function emptyWorkingContext(now = new Date()): AssistantWorkingContext {
  return {
    schemaVersion: WORKING_CONTEXT_SCHEMA_VERSION,
    contextUpdatedAt: now.toISOString(),
  };
}

export function parseResolvedContextShell(raw: unknown): ResolvedContextShell {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as ResolvedContextShell;
}

export function readWorkingContext(rawResolvedContext: unknown): AssistantWorkingContext | null {
  const shell = parseResolvedContextShell(rawResolvedContext);
  if (!shell.workingContext) return null;
  const parsed = assistantWorkingContextSchema.safeParse(shell.workingContext);
  return parsed.success ? parsed.data : null;
}

export function writeWorkingContext(
  rawResolvedContext: unknown,
  workingContext: AssistantWorkingContext,
): ResolvedContextShell {
  const shell = parseResolvedContextShell(rawResolvedContext);
  return {
    ...shell,
    workingContext,
  };
}

export function mergePlanCheckpointIntoResolvedContext(
  rawResolvedContext: unknown,
  planFields: { entityVersions?: Record<string, string | number>; planFingerprint: string },
): ResolvedContextShell {
  const shell = parseResolvedContextShell(rawResolvedContext);
  return {
    ...shell,
    entityVersions: planFields.entityVersions ?? shell.entityVersions ?? {},
    planFingerprint: planFields.planFingerprint,
    workingContext: shell.workingContext,
  };
}

export function isCandidateContextFresh(
  context: AssistantWorkingContext,
  now = new Date(),
): boolean {
  const presentedAt = context.lastPresentedCandidates?.presentedAt;
  if (!presentedAt) return false;
  const ts = Date.parse(presentedAt);
  if (!Number.isFinite(ts)) return false;
  return now.getTime() - ts <= CANDIDATE_CONTEXT_TTL_MS;
}

export function hashEntityId(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

export function intentToCandidateEntityType(intent: string | undefined): ContextEntityType | null {
  if (intent === 'SEARCH_CLIENT' || intent === 'GET_CLIENT_ACCOUNTS' || intent === 'GET_TOP_DEBTORS') {
    return 'CLIENT';
  }
  if (
    intent === 'SEARCH_INVENTORY' ||
    intent === 'GET_INVENTORY_AGING' ||
    intent === 'GET_TOP_INVENTORY_CAPITAL'
  ) {
    return 'WATCH';
  }
  if (intent === 'REGISTER_SALE' || intent === 'REGISTER_PURCHASE') return 'WATCH';
  if (
    intent === 'REGISTER_RECEIVABLE_PAYMENT' ||
    intent === 'REGISTER_PAYABLE_PAYMENT' ||
    intent === 'REGISTER_SETTLEMENT'
  ) {
    return 'ACCOUNT_ENTRY';
  }
  if (intent === 'REGISTER_CAPITAL_CONTRIBUTION' || intent === 'REGISTER_CAPITAL_DISTRIBUTION') {
    return 'INVESTOR';
  }
  if (intent === 'REVERSE_EXPENSE') return 'OPERATING_EXPENSE';
  return null;
}

export function extractPresentedCandidatesFromEntityList(payload: {
  intent: string;
  data: unknown;
  entityType?: unknown;
}): { type: ContextEntityType; candidates: PresentedCandidate[] } | null {
  const explicitType =
    payload.entityType === 'CLIENT' ||
    payload.entityType === 'WATCH' ||
    payload.entityType === 'ACCOUNT_ENTRY' ||
    payload.entityType === 'INVESTOR' ||
    payload.entityType === 'OPERATING_EXPENSE'
      ? payload.entityType
      : null;
  const type = explicitType ?? intentToCandidateEntityType(payload.intent);
  if (!type) return null;
  if (!payload.data || typeof payload.data !== 'object') return null;
  const data = payload.data as Record<string, unknown>;

  let items: unknown[] | null = Array.isArray(data.items) ? data.items : null;
  // Top debtors are nested by currency — prefer MXN then USD for ordinal follow-ups.
  if (!items && data.currencies && typeof data.currencies === 'object') {
    const currencies = data.currencies as Record<string, unknown>;
    const mxn = Array.isArray(currencies.MXN) ? currencies.MXN : [];
    const usd = Array.isArray(currencies.USD) ? currencies.USD : [];
    items = [...mxn, ...usd];
  }
  if (!items || items.length === 0) return null;

  const candidates: PresentedCandidate[] = [];
  for (let i = 0; i < Math.min(items.length, 10); i += 1) {
    const item = items[i];
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id =
      (typeof row.id === 'string' && row.id) ||
      (typeof row.watchId === 'string' && row.watchId) ||
      (typeof row.clientId === 'string' && row.clientId) ||
      null;
    if (!id) continue;
    const label =
      (typeof row.name === 'string' && row.name) ||
      (typeof row.clientLabel === 'string' && row.clientLabel) ||
      (typeof row.label === 'string' && row.label) ||
      (typeof row.displayName === 'string' && row.displayName) ||
      (typeof row.concept === 'string' && row.concept) ||
      [row.brand, row.model, row.reference].filter((v) => typeof v === 'string').join(' ').trim() ||
      id;
    candidates.push({ id, label: String(label).slice(0, 160), ordinal: candidates.length + 1 });
  }
  if (candidates.length === 0) return null;
  return { type, candidates };
}

export function applyPresentedCandidates(
  context: AssistantWorkingContext | null,
  presented: { type: ContextEntityType; candidates: PresentedCandidate[] },
  meta: { lastIntent?: KnownIntent; lastResponseType?: string; now?: Date },
): AssistantWorkingContext {
  const now = meta.now ?? new Date();
  const base = context ?? emptyWorkingContext(now);
  return {
    ...base,
    lastIntent: meta.lastIntent ?? base.lastIntent,
    lastPresentedCandidates: {
      type: presented.type,
      candidates: presented.candidates,
      presentedAt: now.toISOString(),
    },
    lastResponseType: meta.lastResponseType ?? base.lastResponseType,
    contextUpdatedAt: now.toISOString(),
  };
}

export function applySelectedEntity(
  context: AssistantWorkingContext | null,
  selected: { type: ContextEntityType; id: string; label: string },
  now = new Date(),
): AssistantWorkingContext {
  const base = context ?? emptyWorkingContext(now);
  const lastResolvedEntities = { ...(base.lastResolvedEntities ?? {}) };
  if (selected.type === 'CLIENT') lastResolvedEntities.clientId = selected.id;
  if (selected.type === 'WATCH') lastResolvedEntities.watchId = selected.id;
  if (selected.type === 'ACCOUNT_ENTRY') lastResolvedEntities.accountEntryId = selected.id;
  if (selected.type === 'INVESTOR') lastResolvedEntities.investorId = selected.id;
  if (selected.type === 'OPERATING_EXPENSE') lastResolvedEntities.expenseId = selected.id;
  return {
    ...base,
    lastSelectedEntity: selected,
    lastResolvedEntities,
    contextUpdatedAt: now.toISOString(),
  };
}
