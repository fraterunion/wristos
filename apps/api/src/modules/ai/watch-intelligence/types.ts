/**
 * Watch Intelligence V1 — knowledge types.
 * Knowledge never invents watchId. Inventory owns trusted identity.
 */

export const WATCH_KNOWLEDGE_VERSION = '1.0.0' as const;

export type WatchBrandAbbrev = {
  abbrev: string;
  canonicalBrand: string;
  /** Alternate spellings stored in tenant DBs (e.g. AP, ROLEX, PATEK). */
  inventoryBrandTokens: string[];
};

export type WatchKnowledgeEntry = {
  id: string;
  canonicalBrand: string;
  family?: string;
  canonicalModel?: string;
  references?: string[];
  nicknames: string[];
  aliases: string[];
  descriptors?: string[];
  /** When true, nickname alone must not imply a single global concept. */
  ambiguousNickname?: boolean;
};

export type NormalizedWatchQuery = {
  original: string;
  normalized: string;
  tokens: string[];
  brandHint: string | null;
  brandInventoryTokens: string[];
  nicknameHits: string[];
  familyHits: string[];
  referenceHints: string[];
  knowledgeEntryIds: string[];
};

export type WatchSearchConcept = {
  brandTokens: string[];
  modelTokens: string[];
  references: string[];
  nicknames: string[];
  knowledgeEntryIds: string[];
  boost: number;
};

export type WatchCandidateScore =
  | 'EXACT_REFERENCE'
  | 'BRAND_NICKNAME'
  | 'BRAND_FAMILY'
  | 'NICKNAME_ONLY'
  | 'FUZZY'
  | 'REJECT';

export type ScoredWatchCandidate = {
  id: string;
  brand: string;
  model: string;
  reference: string | null;
  status: string;
  label: string;
  score: number;
  scoreKind: WatchCandidateScore;
};

export type WatchInventoryResolveResult =
  | {
      kind: 'UNIQUE';
      watchId: string;
      watchLabel: string;
      candidate: ScoredWatchCandidate;
    }
  | {
      kind: 'PICKER';
      message: string;
      candidates: ScoredWatchCandidate[];
    }
  | { kind: 'NO_MATCH'; reason: string; message: string };
