import { JsonValue, sha256Canonical } from './canonical-json';

export const createPlanFingerprint = (plan: JsonValue): string => sha256Canonical(plan);
