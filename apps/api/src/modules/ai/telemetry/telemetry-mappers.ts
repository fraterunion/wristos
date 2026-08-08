import { ClarificationType, FailureTaxonomy } from './telemetry.types';

export function mapFailureTaxonomy(raw: string | undefined | null): FailureTaxonomy {
  const s = String(raw ?? '').toUpperCase();
  if (s.includes('UNKNOWN')) return 'UNKNOWN_INTENT';
  if (s.includes('LOW_CONFIDENCE') || s.includes('CONFIDENCE')) return 'LOW_CONFIDENCE';
  if (s.includes('NOT_FOUND') || s.includes('ENTITY_NOT_FOUND')) return 'ENTITY_NOT_FOUND';
  if (s.includes('AMBIGUOUS')) return 'ENTITY_AMBIGUOUS';
  if (s.includes('SCHEMA') || s.includes('INVALID_OUTPUT')) return 'SCHEMA_INVALID';
  if (s.includes('STALE')) return 'STALE_PLAN';
  if (s.includes('FINGERPRINT')) return 'FINGERPRINT_CHANGED';
  if (s.includes('TIMEOUT')) return 'PROVIDER_TIMEOUT';
  if (s.includes('UNAVAILABLE') || s.includes('PROVIDER')) return 'PROVIDER_UNAVAILABLE';
  if (s.includes('RECOVERY')) return 'RECOVERY_FAILURE';
  if (s.includes('INVARIANT') || s.includes('CANONICAL_')) return 'INVARIANT_FAILURE';
  if (s.includes('DOMAIN') || s.includes('CONFLICT') || s.includes('FORBIDDEN')) return 'DOMAIN_FAILURE';
  return 'OTHER';
}

export function mapClarificationType(entityOrReason: string | undefined | null): ClarificationType {
  const s = String(entityOrReason ?? '').toLowerCase();
  if (s.includes('amount') || s.includes('price') || s.includes('cost')) return 'MISSING_AMOUNT';
  if (s.includes('customer') || s.includes('client')) return 'MISSING_CUSTOMER';
  if (s.includes('destination')) return 'MISSING_DESTINATION';
  if (s.includes('source')) return 'MISSING_SOURCE';
  if (s.includes('category') || s.includes('concept')) return 'MISSING_CATEGORY';
  if (s.includes('ambiguous') || s.includes('picker')) return 'ENTITY_AMBIGUITY';
  if (s.includes('reference')) return 'UNKNOWN_REFERENCE';
  if (s.includes('no_context') || s.includes('no context')) return 'NO_CONTEXT';
  if (s.includes('expired') || s.includes('ttl')) return 'EXPIRED_CONTEXT';
  if (s.includes('unsupported')) return 'UNSUPPORTED';
  if (s) return 'MISSING_FIELD';
  return 'OTHER';
}
