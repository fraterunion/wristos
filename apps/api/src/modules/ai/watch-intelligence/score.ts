import { normalizeReference, normalizeWatchText, referencesEqual } from './normalize';
import type {
  NormalizedWatchQuery,
  ScoredWatchCandidate,
  WatchCandidateScore,
  WatchSearchConcept,
} from './types';

export type InventoryWatchRow = {
  id: string;
  brand: string;
  model: string;
  referenceNumber: string | null;
  status: string;
  year?: number | null;
};

const MIN_BIND_SCORE = 55;

function derivedAliases(row: InventoryWatchRow): string {
  const brand = row.brand ?? '';
  const model = row.model ?? '';
  const parts = [brand, model, `${brand} ${model}`];
  const b = normalizeWatchText(brand);
  // Abbreviation echoes
  if (b.includes('audemars') || b === 'ap') {
    parts.push(`AP ${model}`, `ROO ${model}`, `RO ${model}`);
  }
  if (b.includes('patek') || b === 'pp' || b === 'patek') {
    parts.push(`PP ${model}`);
  }
  if (b.includes('vacheron') || b === 'vc') {
    parts.push(`VC ${model}`);
  }
  if (b.includes('rolex') || b === 'rolex') {
    parts.push(`Rolex ${model}`);
  }
  return normalizeWatchText(parts.join(' '));
}

function brandMatches(rowBrand: string, brandTokens: string[]): boolean {
  if (!brandTokens.length) return true; // no brand constraint
  const rb = normalizeWatchText(rowBrand);
  return brandTokens.some((t) => {
    const nt = normalizeWatchText(t);
    return rb === nt || rb.includes(nt) || nt.includes(rb);
  });
}

function modelHaystack(row: InventoryWatchRow): string {
  return normalizeWatchText(`${row.model} ${row.brand} ${row.referenceNumber ?? ''}`);
}

/**
 * Score a single inventory row against expanded knowledge concepts.
 * Exact reference outranks nickname/fuzzy.
 */
export function scoreWatchCandidate(
  row: InventoryWatchRow,
  query: NormalizedWatchQuery,
  concept: WatchSearchConcept,
): ScoredWatchCandidate | null {
  let score = 0;
  let scoreKind: WatchCandidateScore = 'REJECT';
  const hay = modelHaystack(row);
  const aliases = derivedAliases(row);
  const ref = row.referenceNumber;

  // VERY HIGH: exact reference — only from user-typed reference hints (never catalog expansion).
  if (query.referenceHints.length && ref) {
    for (const hint of query.referenceHints) {
      if (referencesEqual(hint, ref) || normalizeReference(ref) === hint) {
        score = 100;
        scoreKind = 'EXACT_REFERENCE';
        return toCandidate(row, score, scoreKind);
      }
    }
  }

  const brandConstraintTokens =
    query.brandHint && query.brandInventoryTokens.length > 0
      ? query.brandInventoryTokens
      : concept.brandTokens;
  const brandOk = brandMatches(row.brand, brandConstraintTokens);
  const hasBrandConstraint = Boolean(query.brandHint);

  // Nickname / model token hits
  const nickHits = concept.nicknames.filter((n) => {
    const nn = normalizeWatchText(n);
    return nn.length > 1 && (hay.includes(nn) || aliases.includes(nn));
  });
  const modelTokenHits = concept.modelTokens.filter((t) => t.length > 2 && (hay.includes(t) || aliases.includes(t)));

  if (hasBrandConstraint && !brandOk) {
    // Brand was explicit but row doesn't match — reject unless exact ref already handled
    return null;
  }

  // Catalog reference family: soft boost when inventory ref is in expanded set (not EXACT).
  let catalogRefHit = false;
  if (
    !query.referenceHints.length &&
    Boolean(ref) &&
    concept.references.some((r) => referencesEqual(r, ref)) &&
    brandOk
  ) {
    catalogRefHit = true;
    score = 80;
    scoreKind = 'BRAND_FAMILY';
  }

  if (brandOk && nickHits.length) {
    score = 85 + Math.min(10, nickHits.length * 3);
    scoreKind = 'BRAND_NICKNAME';
    if (!query.brandHint && concept.brandTokens.length > 1) {
      // nickname alone — still strong if model contains nickname
      score = 70 + Math.min(10, nickHits.length * 2);
      scoreKind = 'NICKNAME_ONLY';
    }
  } else if (brandOk && query.familyHits.some((f) => hay.includes(normalizeWatchText(f).split(' ')[0] ?? ''))) {
    score = Math.max(score, 65);
    scoreKind = scoreKind === 'REJECT' ? 'BRAND_FAMILY' : scoreKind;
  } else if (nickHits.length && brandOk) {
    score = 68;
    scoreKind = 'NICKNAME_ONLY';
  } else if (nickHits.length && !query.brandHint) {
    score = 62;
    scoreKind = 'NICKNAME_ONLY';
  } else if (modelTokenHits.length >= 2 && brandOk) {
    score = 58;
    scoreKind = 'FUZZY';
  } else if (modelTokenHits.length === 1 && brandOk && query.tokens.length <= 3) {
    score = 56;
    scoreKind = 'FUZZY';
  } else if (
    query.normalized.length >= 3 &&
    (hay.includes(query.normalized) || aliases.includes(query.normalized))
  ) {
    score = 60;
    scoreKind = 'FUZZY';
  } else if (
    query.tokens.length &&
    query.tokens.every((t) => t.length <= 2 || hay.includes(t) || aliases.includes(t)) &&
    query.tokens.some((t) => t.length > 2)
  ) {
    score = 50;
    scoreKind = 'FUZZY';
  } else if (!catalogRefHit) {
    return null;
  }

  // Composition boost: brand + nickname
  if (query.brandHint && nickHits.length) {
    score = Math.max(score, 88);
    scoreKind = 'BRAND_NICKNAME';
  }

  // If user used a nickname, require that nickname to appear on the row
  // (prevents "Rolex Panda" binding an unrelated Rolex Daytona via family tokens).
  if (query.nicknameHits.length > 0 && nickHits.length === 0) {
    return null;
  }

  if (score < MIN_BIND_SCORE && scoreKind === 'FUZZY') {
    return null;
  }

  return toCandidate(row, score, scoreKind);
}

function toCandidate(
  row: InventoryWatchRow,
  score: number,
  scoreKind: WatchCandidateScore,
): ScoredWatchCandidate {
  const ref = row.referenceNumber?.trim() || null;
  const year = row.year ? ` ${row.year}` : '';
  const label = `${row.brand} ${row.model}${ref ? ` (${ref})` : ''}${year}`.trim();
  return {
    id: row.id,
    brand: row.brand,
    model: row.model,
    reference: ref,
    status: row.status,
    label,
    score,
    scoreKind,
  };
}

export function rankAndResolveCandidates(
  scored: ScoredWatchCandidate[],
): { unique: ScoredWatchCandidate | null; picker: ScoredWatchCandidate[]; rejectWeak: boolean } {
  const sorted = [...scored].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const strong = sorted.filter((c) => c.score >= MIN_BIND_SCORE);
  if (!strong.length) return { unique: null, picker: [], rejectWeak: true };
  if (strong.length === 1) return { unique: strong[0], picker: [], rejectWeak: false };
  // Near-ties → picker
  const top = strong[0].score;
  const tied = strong.filter((c) => top - c.score <= 8);
  if (tied.length === 1) return { unique: tied[0], picker: [], rejectWeak: false };
  return { unique: null, picker: tied.slice(0, 8), rejectWeak: false };
}

export { MIN_BIND_SCORE };
