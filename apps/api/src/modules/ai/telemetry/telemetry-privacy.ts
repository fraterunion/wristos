import { createHash } from 'crypto';
import { TELEMETRY_CHANNEL, TelemetryEmitInput, TelemetryEvent } from './telemetry.types';

const FORBIDDEN_KEY = /secret|password|token|jwt|authorization|api[_-]?key|database_url|connection_string|prompt|reasoning|payload|sql|Bearer/i;

export function hashId(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export function sanitizeMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    if (value == null) {
      out[key] = null;
      continue;
    }
    if (typeof value === 'string') {
      // Never keep long free text — truncate identifiers only.
      out[key] = value.length > 64 ? value.slice(0, 64) : value;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

let seq = 0;

export function toTelemetryEvent(input: TelemetryEmitInput): TelemetryEvent {
  seq += 1;
  const {
    tenantId,
    conversationId,
    requestId,
    actionRunId,
    workspaceId,
    meta,
    ...rest
  } = input;
  return {
    ...rest,
    at: new Date().toISOString(),
    seq,
    tenantHash: hashId(tenantId),
    conversationHash: hashId(conversationId),
    requestHash: hashId(requestId),
    actionRunHash: hashId(actionRunId),
    workspaceHash: hashId(workspaceId),
    meta: sanitizeMeta(meta as Record<string, unknown> | undefined),
  };
}

export function assertPrivacySafe(event: TelemetryEvent): string[] {
  const violations: string[] = [];
  const blob = JSON.stringify(event);
  if (/sk-ant-|BEGIN PRIVATE KEY|postgres(ql)?:\/\//i.test(blob)) {
    violations.push('secret_like_content');
  }
  if (/"systemPrompt"|"promptText"|"claudeReasoning"/i.test(blob)) {
    violations.push('prompt_or_reasoning');
  }
  for (const key of Object.keys(event.meta ?? {})) {
    if (FORBIDDEN_KEY.test(key)) violations.push(`forbidden_meta_key:${key}`);
  }
  if ((event as { channel?: string }).channel && (event as { channel?: string }).channel !== TELEMETRY_CHANNEL) {
    violations.push('unexpected_channel');
  }
  return violations;
}
