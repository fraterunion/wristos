import { z } from 'zod';
import { CONTEXT_ENTITY_TYPES } from './entity-types';

/**
 * Optional reference structure on the raw intent candidate.
 * Never carries arbitrary entity IDs — only ordinals / relative kinds.
 */
export const intentReferenceSchema = z
  .object({
    kind: z.enum(['ORDINAL', 'LAST_SELECTED', 'SINGLE_PRESENTED', 'SAME_ENTITY']),
    ordinal: z.number().int().min(1).max(10).optional(),
    /** Prefer this over inventing a sentinel ordinal for "último". */
    position: z.enum(['LAST']).optional(),
    entityType: z.enum(CONTEXT_ENTITY_TYPES).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'ORDINAL' && value.ordinal === undefined && value.position !== 'LAST') {
      ctx.addIssue({ code: 'custom', message: 'ORDINAL reference requires ordinal or position=LAST', path: ['ordinal'] });
    }
  });

export type IntentReference = z.infer<typeof intentReferenceSchema>;
