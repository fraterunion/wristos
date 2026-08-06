import { JsonValue, sha256Canonical } from './canonical-json';

export type IdempotencyInput = {
  tenantId: string;
  userId: string;
  intent: string;
  normalizedArguments: JsonValue;
};

export function createIdempotencyKey(input: IdempotencyInput): string {
  return `ai:${sha256Canonical({
    tenantId: input.tenantId,
    userId: input.userId,
    intent: input.intent,
    normalizedArguments: input.normalizedArguments,
  })}`;
}
