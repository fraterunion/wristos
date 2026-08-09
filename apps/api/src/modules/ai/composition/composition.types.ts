import { createHash } from 'node:crypto';
import { z } from 'zod';
import { JsonValue } from '../domain/canonical-json';

/** Closed V1 composition graph — do not expand without a new commit. */
export const COMPOSITION_SCHEMA_VERSION = '1.0' as const;

export const COMPOSITION_PARENT_CAPABILITIES = ['REGISTER_PURCHASE', 'REGISTER_SALE'] as const;
export type CompositionParentCapability = (typeof COMPOSITION_PARENT_CAPABILITIES)[number];

export const COMPOSITION_DEPENDENCY_REASONS = ['PURCHASE_SELLER', 'SALE_CUSTOMER'] as const;
export type CompositionDependencyReason = (typeof COMPOSITION_DEPENDENCY_REASONS)[number];

export const COMPOSITION_STATES = [
  'DEPENDENCY_REQUIRED',
  'DEPENDENCY_PREVIEW',
  'DEPENDENCY_EXECUTING',
  'DEPENDENCY_COMPLETED',
  'PRIMARY_RESUMING',
  'CANCELLED',
] as const;
export type CompositionState = (typeof COMPOSITION_STATES)[number];

const draftEntityValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

export const compositionStateSchema = z
  .object({
    schemaVersion: z.literal(COMPOSITION_SCHEMA_VERSION),
    compositionId: z.string().min(8).max(64),
    state: z.enum(COMPOSITION_STATES),
    parentCapability: z.enum(COMPOSITION_PARENT_CAPABILITIES),
    dependencyReason: z.enum(COMPOSITION_DEPENDENCY_REASONS),
    dependencyQuery: z.string().min(1).max(160),
    /** Bounded parent draft — trusted scalars only; no provider clientId. */
    parentDraftEntities: z.record(z.string().max(64), draftEntityValue).refine(
      (obj) => Object.keys(obj).length <= 40,
      'parent draft too large',
    ),
    parentDraftHash: z.string().min(8).max(64),
    childCapability: z.literal('CREATE_CLIENT'),
    childActionRunId: z.string().min(1).max(128).optional(),
    resolvedClientId: z.string().min(1).max(128).optional(),
    resolvedClientLabel: z.string().min(1).max(160).optional(),
    resolvedKind: z.enum(['CLIENT_CREATED', 'CLIENT_REUSED']).optional(),
    createdAt: z.string().min(10).max(40),
    updatedAt: z.string().min(10).max(40),
  })
  .strict();

export type CompositionStateRecord = z.infer<typeof compositionStateSchema>;

export const ALLOWED_COMPOSITION_EDGES: ReadonlyArray<{
  parent: CompositionParentCapability;
  reason: CompositionDependencyReason;
  child: 'CREATE_CLIENT';
}> = [
  { parent: 'REGISTER_PURCHASE', reason: 'PURCHASE_SELLER', child: 'CREATE_CLIENT' },
  { parent: 'REGISTER_SALE', reason: 'SALE_CUSTOMER', child: 'CREATE_CLIENT' },
];

export function isAllowedCompositionEdge(
  parent: string,
  reason: string,
  child: string,
): boolean {
  return ALLOWED_COMPOSITION_EDGES.some(
    (e) => e.parent === parent && e.reason === reason && e.child === child,
  );
}

/** Max composition depth V1: one child write, then resume parent. */
export const COMPOSITION_MAX_DEPTH = 1;

export function hashParentDraft(entities: Record<string, JsonValue>): string {
  const keys = Object.keys(entities).sort();
  const stable = keys.map((k) => `${k}=${JSON.stringify(entities[k] ?? null)}`).join('|');
  return createHash('sha256').update(stable).digest('hex').slice(0, 32);
}

export function newCompositionId(): string {
  return createHash('sha256')
    .update(`${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 24);
}

/** Sentinel entity picker ids for composition CTAs (not CRM clients). */
export const COMPOSITION_CREATE_PREFIX = '__COMPOSITION_CREATE_CLIENT__|';
export const COMPOSITION_SEARCH_ID = '__COMPOSITION_SEARCH_CLIENT__';
export const COMPOSITION_CANCEL_ID = '__COMPOSITION_CANCEL__';

export function compositionCreateSentinel(name: string): string {
  return `${COMPOSITION_CREATE_PREFIX}${name.slice(0, 80)}`;
}

export function parseCompositionCreateSentinel(id: string): string | null {
  if (!id.startsWith(COMPOSITION_CREATE_PREFIX)) return null;
  const name = id.slice(COMPOSITION_CREATE_PREFIX.length).trim();
  return name || null;
}
