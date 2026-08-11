export { WATCH_KNOWLEDGE_VERSION } from './types';
export type {
  NormalizedWatchQuery,
  ScoredWatchCandidate,
  WatchInventoryResolveResult,
  WatchKnowledgeEntry,
  WatchSearchConcept,
} from './types';
export {
  BRAND_ABBREVIATIONS,
  FAMILY_ALIASES,
  WATCH_KNOWLEDGE_ENTRIES,
} from './catalog';
export {
  extractReferenceHints,
  normalizeReference,
  normalizeWatchText,
  referencesEqual,
  tokenizeWatchQuery,
  withinTypoDistance,
} from './normalize';
export {
  expandWatchKnowledge,
  knowledgeAmbiguityLevel,
  normalizeWatchQuery,
} from './expand';
export { MIN_BIND_SCORE, rankAndResolveCandidates, scoreWatchCandidate } from './score';
export { WatchInventoryResolver } from './watch-inventory-resolver.service';
export type { WatchEligibility } from './watch-inventory-resolver.service';
