import { normalizeCustomerName } from '../../../../apps/api/src/modules/platform-migrations/wrist-caviar/normalization/customer-normalize';

/**
 * Exact normalized-name grouping only. No fuzzy auto-link.
 * WC_EXACT_NORMALIZED_CUSTOMER_CANONICALIZATION
 */
export function exactNormalizedCustomerKey(displayName: string): string {
  return normalizeCustomerName(displayName);
}

export type CustomerConflictClass =
  | 'exact_normalized_duplicate'
  | 'accent_only_variant'
  | 'whitespace_case_variant'
  | 'punctuation_only_variant'
  | 'abbreviation'
  | 'possible_typo'
  | 'multiple_destination_match'
  | 'no_destination_match';

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

function stripPunct(s: string): string {
  return s.replace(/[^\p{L}\p{N}\s]/gu, '');
}

/**
 * Classify how two display names relate after normalization.
 * Never auto-merges abbreviations or typos.
 */
export function classifyCustomerNamePair(
  a: string,
  b: string,
): Exclude<CustomerConflictClass, 'multiple_destination_match' | 'no_destination_match'> {
  const na = normalizeCustomerName(a);
  const nb = normalizeCustomerName(b);
  if (na === nb) return 'exact_normalized_duplicate';

  const wa = a.trim().toLowerCase().replace(/\s+/g, ' ');
  const wb = b.trim().toLowerCase().replace(/\s+/g, ' ');
  if (wa === wb) return 'whitespace_case_variant';

  if (stripAccents(na) === stripAccents(nb)) return 'accent_only_variant';

  if (stripPunct(na).replace(/\s+/g, '') === stripPunct(nb).replace(/\s+/g, '')) {
    return 'punctuation_only_variant';
  }

  // crude abbreviation: one is initials / short form of the other
  const partsA = na.split(' ').filter(Boolean);
  const partsB = nb.split(' ').filter(Boolean);
  if (
    (partsA.length >= 2 &&
      partsB.length === 1 &&
      partsA.some((p) => p.startsWith(partsB[0]!))) ||
    (partsB.length >= 2 &&
      partsA.length === 1 &&
      partsB.some((p) => p.startsWith(partsA[0]!)))
  ) {
    return 'abbreviation';
  }

  return 'possible_typo';
}
