import { HttpStatus } from '@nestjs/common';
import { structuredAssistantHttpStatus } from './assistant-http-status';
import { StructuredAssistantResponse } from './structured-assistant.types';

const response = (interactionState: StructuredAssistantResponse['interactionState'], errorType?: string): StructuredAssistantResponse => ({
  requestId: 'request-1', conversationId: '', workspaceId: '', interactionState,
  responseType: interactionState === 'COMPLETED' ? 'METRIC_BREAKDOWN' : 'ERROR_RECOVERY_CARD',
  payload: errorType ? { errorType, message: 'Safe message' } : {}, warnings: [], suggestedActions: [], traceId: 'trace-1', createdAt: '2026-08-06T00:00:00.000Z',
});

describe('structuredAssistantHttpStatus', () => {
  it.each([
    ['NOT_FOUND', HttpStatus.NOT_FOUND],
    ['PERMISSION_DENIED', HttpStatus.FORBIDDEN],
    ['CONFLICT', HttpStatus.CONFLICT],
    ['CLIENT_EXACT_DUPLICATE', HttpStatus.CONFLICT],
    ['CLIENT_DELETED_MATCH', HttpStatus.CONFLICT],
    ['CLIENT_IDENTITY_CONFLICT', HttpStatus.CONFLICT],
    ['READ_EXECUTION_FAILED', HttpStatus.INTERNAL_SERVER_ERROR],
  ])('maps trusted failure type %s to HTTP %s', (failureType, status) => {
    expect(structuredAssistantHttpStatus(response('FAILED', failureType))).toBe(status);
  });

  it('maps legacy replay payload code without changing stored responses', () => {
    const legacy = response('FAILED');
    legacy.payload = { code: 'NOT_FOUND', message: 'No se encontró el recurso solicitado.' };
    expect(structuredAssistantHttpStatus(legacy)).toBe(HttpStatus.NOT_FOUND);
  });

  it('keeps the current 201 contract for success, clarification and write previews', () => {
    expect(structuredAssistantHttpStatus(response('COMPLETED'))).toBeNull();
    expect(structuredAssistantHttpStatus({ ...response('NEEDS_INPUT'), responseType: 'MISSING_FIELDS_CARD' })).toBeNull();
    expect(structuredAssistantHttpStatus({ ...response('READY_FOR_CONFIRMATION'), responseType: 'ACTION_PREVIEW_CARD' })).toBeNull();
  });

  it('uses typed interaction-state fallbacks without parsing messages', () => {
    expect(structuredAssistantHttpStatus(response('STALE_PLAN'))).toBe(HttpStatus.CONFLICT);
    expect(structuredAssistantHttpStatus(response('PERMISSION_BLOCKED'))).toBe(HttpStatus.FORBIDDEN);
    expect(structuredAssistantHttpStatus(response('FAILED'))).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('does not map expected language-policy rejects to HTTP 500', () => {
    for (const code of ['UNKNOWN_INTENT', 'LOW_CONFIDENCE', 'ENTITY_SCHEMA_INVALID', 'INVALID_OUTPUT_SHAPE', 'REJECT_UNKNOWN', 'REJECT_LOW_CONFIDENCE']) {
      const soft = response('FAILED');
      soft.payload = { code, message: 'No entendí la indicación con suficiente claridad.' };
      expect(structuredAssistantHttpStatus(soft)).toBeNull();
    }
  });

  it('maps true provider unavailability to 503 and unknown provider errors to 500', () => {
    const timeout = response('FAILED');
    timeout.payload = { code: 'TIMEOUT', message: 'unavailable' };
    expect(structuredAssistantHttpStatus(timeout)).toBe(HttpStatus.SERVICE_UNAVAILABLE);

    const unknown = response('FAILED');
    unknown.payload = { code: 'UNKNOWN_ERROR', message: 'boom' };
    expect(structuredAssistantHttpStatus(unknown)).toBe(HttpStatus.INTERNAL_SERVER_ERROR);

    const readFail = response('FAILED', 'READ_EXECUTION_FAILED');
    expect(structuredAssistantHttpStatus(readFail)).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});
