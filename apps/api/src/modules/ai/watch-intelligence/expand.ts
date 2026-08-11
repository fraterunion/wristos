import {
  BRAND_ABBREVIATIONS,
  FAMILY_ALIASES,
  WATCH_KNOWLEDGE_ENTRIES,
} from './catalog';
import {
  extractReferenceHints,
  normalizeWatchText,
  tokenizeWatchQuery,
  withinTypoDistance,
} from './normalize';
import type { NormalizedWatchQuery, WatchSearchConcept } from './types';

const ROLE_X_BRAND_TOKENS = ['Rolex', 'ROLEX', 'rlx'];

function brandInventoryTokensForCanonical(canonical: string): string[] {
  const hit = BRAND_ABBREVIATIONS.find(
    (b) => b.canonicalBrand.toLowerCase() === canonical.toLowerCase(),
  );
  if (hit) return hit.inventoryBrandTokens;
  if (canonical.toLowerCase() === 'rolex') return ROLE_X_BRAND_TOKENS;
  if (canonical.toLowerCase() === 'omega') return ['Omega', 'OMEGA'];
  if (canonical.toLowerCase() === 'tudor') return ['Tudor', 'TUDOR'];
  if (canonical.toLowerCase() === 'cartier') return ['Cartier', 'CARTIER'];
  return [canonical];
}

function resolveBrandHint(tokens: string[], normalized: string): {
  brandHint: string | null;
  brandInventoryTokens: string[];
} {
  // Abbreviation as whole token
  for (const abbr of BRAND_ABBREVIATIONS) {
    if (tokens.includes(abbr.abbrev.toLowerCase())) {
      return {
        brandHint: abbr.canonicalBrand,
        brandInventoryTokens: abbr.inventoryBrandTokens,
      };
    }
  }
  // Full / partial brand names + conservative typos
  const brandNames: Array<{ canonical: string; needles: string[] }> = [
    { canonical: 'Audemars Piguet', needles: ['audemars', 'piguet', 'audemar', 'audimar', 'audermars'] },
    { canonical: 'Patek Philippe', needles: ['patek', 'philippe', 'pateck'] },
    { canonical: 'Vacheron Constantin', needles: ['vacheron', 'constantin'] },
    { canonical: 'Rolex', needles: ['rolex'] },
    { canonical: 'Omega', needles: ['omega'] },
    { canonical: 'Richard Mille', needles: ['richard', 'mille'] },
    { canonical: 'Cartier', needles: ['cartier'] },
    { canonical: 'Tudor', needles: ['tudor'] },
    { canonical: 'IWC', needles: ['iwc'] },
    { canonical: 'Jaeger-LeCoultre', needles: ['jaeger', 'lecoultre', 'jlc'] },
  ];
  for (const b of brandNames) {
    for (const needle of b.needles) {
      if (tokens.includes(needle) || withinTypoDistance(normalized.split(' ')[0] ?? '', needle, 2)) {
        if (tokens.some((t) => t === needle || withinTypoDistance(t, needle, 2))) {
          return {
            brandHint: b.canonical,
            brandInventoryTokens: brandInventoryTokensForCanonical(b.canonical),
          };
        }
      }
    }
  }
  // Multi-word brand in normalized string
  if (normalized.includes('audemars') || withinTypoDistance(normalized, 'audemars piguet', 3)) {
    if (/aud[ei]?m?a?rs|audimar|audermars/.test(normalized)) {
      return {
        brandHint: 'Audemars Piguet',
        brandInventoryTokens: brandInventoryTokensForCanonical('Audemars Piguet'),
      };
    }
  }
  return { brandHint: null, brandInventoryTokens: [] };
}

function nicknameMatchesToken(nickname: string, tokens: string[], normalized: string): boolean {
  const nn = normalizeWatchText(nickname);
  if (!nn) return false;
  if (nn.includes(' ')) {
    return normalized.includes(nn) || withinTypoDistance(normalized, nn, 2);
  }
  return tokens.some((t) => t === nn || withinTypoDistance(t, nn, 1));
}

/**
 * Expand raw dealer language into normalized concepts for inventory search.
 * Deterministic — no LLM.
 */
export function normalizeWatchQuery(raw: string): NormalizedWatchQuery {
  const original = String(raw ?? '').trim();
  const normalized = normalizeWatchText(original);
  const tokens = tokenizeWatchQuery(normalized);
  const { brandHint, brandInventoryTokens } = resolveBrandHint(tokens, normalized);
  const referenceHints = extractReferenceHints(original);

  const nicknameHits: string[] = [];
  const familyHits: string[] = [];
  const knowledgeEntryIds: string[] = [];

  for (const entry of WATCH_KNOWLEDGE_ENTRIES) {
    let hit = false;
    for (const nick of entry.nicknames) {
      if (nicknameMatchesToken(nick, tokens, normalized)) {
        nicknameHits.push(nick);
        hit = true;
      }
    }
    for (const alias of entry.aliases) {
      const an = normalizeWatchText(alias);
      if (an && (normalized.includes(an) || tokens.includes(an))) {
        hit = true;
      }
    }
    for (const ref of entry.references ?? []) {
      const compact = ref.toUpperCase().replace(/[\s\-_]/g, '');
      if (referenceHints.some((h) => h === compact)) {
        hit = true;
      }
    }
    if (hit) knowledgeEntryIds.push(entry.id);
  }

  for (const fam of FAMILY_ALIASES) {
    for (const tok of fam.tokens) {
      const tn = normalizeWatchText(tok);
      if (tokens.includes(tn) || (tn.includes(' ') && normalized.includes(tn))) {
        familyHits.push(fam.family);
      }
    }
  }

  return {
    original,
    normalized,
    tokens,
    brandHint,
    brandInventoryTokens: brandInventoryTokens.length
      ? brandInventoryTokens
      : brandHint
        ? brandInventoryTokensForCanonical(brandHint)
        : [],
    nicknameHits: [...new Set(nicknameHits)],
    familyHits: [...new Set(familyHits)],
    referenceHints,
    knowledgeEntryIds: [...new Set(knowledgeEntryIds)],
  };
}

/**
 * Produce search concepts / expansion tokens for DB matching.
 */
export function expandWatchKnowledge(query: NormalizedWatchQuery): WatchSearchConcept {
  const brandTokens = new Set<string>(query.brandInventoryTokens);
  const modelTokens = new Set<string>();
  const references = new Set<string>(query.referenceHints);
  const nicknames = new Set<string>(query.nicknameHits);
  const knowledgeEntryIds = new Set<string>(query.knowledgeEntryIds);

  let boost = 0;
  if (query.brandHint) boost += 40;
  if (query.nicknameHits.length) boost += 30;
  if (query.referenceHints.length) boost += 50;
  if (query.familyHits.length) boost += 15;

  for (const id of query.knowledgeEntryIds) {
    const entry = WATCH_KNOWLEDGE_ENTRIES.find((e) => e.id === id);
    if (!entry) continue;
    for (const t of brandInventoryTokensForCanonical(entry.canonicalBrand)) {
      brandTokens.add(t);
    }
    if (entry.canonicalModel) {
      for (const part of normalizeWatchText(entry.canonicalModel).split(' ')) {
        if (part.length > 1) modelTokens.add(part);
      }
    }
    if (entry.family) {
      for (const part of normalizeWatchText(entry.family).split(' ')) {
        if (part.length > 1) modelTokens.add(part);
      }
    }
    for (const nick of entry.nicknames) {
      nicknames.add(nick);
      modelTokens.add(normalizeWatchText(nick));
    }
    for (const ref of entry.references ?? []) {
      references.add(ref.toUpperCase().replace(/[\s\-_]/g, ''));
    }
  }

  // Pass through non-brand query tokens as model search tokens (skip bare numeric ref prefixes).
  const brandSkip = new Set(
    [...brandTokens].map((b) => normalizeWatchText(b)).concat(
      BRAND_ABBREVIATIONS.map((a) => a.abbrev.toLowerCase()),
      ['ap', 'pp', 'vc', 'rm', 'jlc', 'iwc', 'rolex', 'omega', 'patek', 'audemars'],
    ),
  );
  for (const t of query.tokens) {
    if (brandSkip.has(t) || t.length <= 1) continue;
    if (/^\d{4,8}$/.test(t)) continue; // bare numeric prefix — not a model token
    modelTokens.add(t);
  }

  // If nickname-only with no brand, expand all matching knowledge brands
  if (!query.brandHint && query.nicknameHits.length) {
    for (const entry of WATCH_KNOWLEDGE_ENTRIES) {
      if (entry.nicknames.some((n) => query.nicknameHits.some((h) => normalizeWatchText(h) === normalizeWatchText(n)))) {
        for (const t of brandInventoryTokensForCanonical(entry.canonicalBrand)) {
          brandTokens.add(t);
        }
        knowledgeEntryIds.add(entry.id);
      }
    }
  }

  return {
    brandTokens: [...brandTokens],
    modelTokens: [...modelTokens].filter(Boolean),
    references: [...references],
    nicknames: [...nicknames],
    knowledgeEntryIds: [...knowledgeEntryIds],
    boost,
  };
}

/** Ambiguity level for knowledge-table tests. */
export function knowledgeAmbiguityLevel(query: NormalizedWatchQuery): 'unique_concept' | 'ambiguous' | 'brand_family' | 'none' {
  if (query.referenceHints.length) return 'unique_concept';
  const nickEntries = WATCH_KNOWLEDGE_ENTRIES.filter((e) =>
    e.nicknames.some((n) => query.nicknameHits.some((h) => normalizeWatchText(h) === normalizeWatchText(n))),
  );
  if (nickEntries.length > 1) return 'ambiguous';
  if (nickEntries.length === 1 && nickEntries[0].ambiguousNickname && !query.brandHint) {
    return 'ambiguous';
  }
  if (nickEntries.length === 1) return 'unique_concept';
  if (query.brandHint && query.familyHits.length) return 'brand_family';
  if (query.brandHint || query.familyHits.length) return 'brand_family';
  return 'none';
}
