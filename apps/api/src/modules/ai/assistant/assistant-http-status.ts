import { HttpStatus } from '@nestjs/common';
import { StructuredAssistantResponse } from './structured-assistant.types';

export type AssistantFailureType = 'NOT_FOUND' | 'PERMISSION_DENIED' | 'CONFLICT' | 'READ_EXECUTION_FAILED';

/**
 * Soft / expected product outcomes from the natural-language intent adapter.
 * These must NOT surface as HTTP 500 — they are typed assistant responses
 * (UNKNOWN, low confidence, schema-invalid provider output, etc.).
 *
 * Status matrix (assistant/message + structured):
 *
 * | Condition                         | HTTP                         |
 * |-----------------------------------|------------------------------|
 * | COMPLETED / NEEDS_INPUT / preview | default success (201 POST)   |
 * | UNKNOWN_INTENT / LOW_CONFIDENCE   | default success (201 POST)   |
 * | ENTITY_SCHEMA_INVALID / INVALID_* | default success (201 POST)   |
 * | CLARIFY_AMBIGUITY                 | default success (201 POST)   |
 * | NOT_FOUND                         | 404                          |
 * | PERMISSION_DENIED                 | 403                          |
 * | CONFLICT / STALE_PLAN             | 409                          |
 * | TIMEOUT / UNAVAILABLE             | 503                          |
 * | RATE_LIMITED (via this mapper)    | 429                          |
 * | READ_EXECUTION_FAILED             | 500                          |
 * | UNKNOWN_ERROR / unmapped FAILED   | 500                          |
 */
const SOFT_ASSISTANT_FAILURE_CODES = new Set([
  'UNKNOWN_INTENT',
  'LOW_CONFIDENCE',
  'ENTITY_SCHEMA_INVALID',
  'INVALID_OUTPUT_SHAPE',
  'INVALID_OUTPUT',
  'REJECT_UNKNOWN',
  'REJECT_LOW_CONFIDENCE',
  'CLARIFY_AMBIGUITY',
]);

function failureType(response: StructuredAssistantResponse): string | null {
  const value = response.payload.errorType ?? response.payload.code;
  return typeof value === 'string' ? value : null;
}

export function structuredAssistantHttpStatus(response: StructuredAssistantResponse): HttpStatus | null {
  const code = failureType(response);

  if (code && SOFT_ASSISTANT_FAILURE_CODES.has(code)) {
    return null;
  }

  switch (code) {
    case 'NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'PERMISSION_DENIED':
      return HttpStatus.FORBIDDEN;
    case 'CONFLICT':
    case 'CLIENT_EXACT_DUPLICATE':
    case 'CLIENT_DELETED_MATCH':
    case 'CLIENT_IDENTITY_CONFLICT':
    case 'CLIENT_STALE':
    case 'AMBIGUOUS_RECOVERY':
      return HttpStatus.CONFLICT;
    case 'READ_EXECUTION_FAILED':
      return HttpStatus.INTERNAL_SERVER_ERROR;
    case 'TIMEOUT':
    case 'UNAVAILABLE':
      return HttpStatus.SERVICE_UNAVAILABLE;
    case 'RATE_LIMITED':
      return HttpStatus.TOO_MANY_REQUESTS;
    case 'UNKNOWN_ERROR':
      return HttpStatus.INTERNAL_SERVER_ERROR;
    default:
      if (response.interactionState === 'STALE_PLAN') return HttpStatus.CONFLICT;
      if (response.interactionState === 'PERMISSION_BLOCKED') return HttpStatus.FORBIDDEN;
      if (response.interactionState === 'FAILED') return HttpStatus.INTERNAL_SERVER_ERROR;
      return null;
  }
}
