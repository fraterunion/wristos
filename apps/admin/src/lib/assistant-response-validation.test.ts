import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateAssistantResponse } from './assistant-response-validation';
import type { StructuredAssistantResponse } from './assistant-types';

const response = (
  interactionState: string,
  responseType: string | undefined,
  payload: Record<string, unknown> = {},
) => ({
  requestId: 'request-1', conversationId: 'conversation-1', workspaceId: 'workspace-1',
  interactionState, responseType, payload, warnings: [], suggestedActions: [],
  traceId: 'trace-1', createdAt: '2026-08-06T00:00:00.000Z',
});

describe('assistant response safety validation', () => {
  it('fails closed for unknown or missing response types and unknown states', () => {
    for (const candidate of [
      response('COMPLETED', 'CUSTOM_COMPONENT'),
      response('COMPLETED', undefined),
      response('MADE_UP', 'ENTITY_LIST'),
    ]) {
      const result = validateAssistantResponse('GET_LIQUIDITY', candidate);
      assert.equal(result.kind, 'FAIL_CLOSED');
      if (result.kind === 'FAIL_CLOSED') {
        assert.equal(result.title.includes('Consulta completada'), false);
        assert.equal(result.message, 'No se realizó ningún cambio.');
      }
    }
  });

  it('blocks completed and success-receipt write responses without trusting copy', () => {
    for (const candidate of [
      response('COMPLETED', 'ACTION_PREVIEW_CARD'),
      response('READY_FOR_CONFIRMATION', 'SUCCESS_RECEIPT'),
      response('COMPLETED', 'SUCCESS_RECEIPT', {
        message: 'Registrado y completado', html: '<script>execute()</script>',
      }),
    ]) {
      const result = validateAssistantResponse('REGISTER_SALE', candidate);
      assert.equal(result.kind, 'FAIL_CLOSED');
      if (result.kind === 'FAIL_CLOSED') {
        assert.equal(result.title, 'Esta operación no se ejecutó.');
        assert.equal(result.message.includes('todavía no está habilitada'), true);
        assert.equal(JSON.stringify(result).includes('Registrado'), false);
        assert.equal(JSON.stringify(result).includes('<script>'), false);
        assert.equal(result.manualHref, '/ventas');
      }
    }
  });

  it('accepts only compatible preview, clarification, and error write responses', () => {
    const valid = [
      response('READY_FOR_CONFIRMATION', 'ACTION_PREVIEW_CARD'),
      response('NEEDS_INPUT', 'MISSING_FIELDS_CARD'),
      response('FAILED', 'ERROR_RECOVERY_CARD'),
    ];
    for (const candidate of valid) {
      assert.equal(validateAssistantResponse('REGISTER_EXPENSE', candidate).kind, 'VALID');
    }
  });

  it('preserves valid completed read responses', () => {
    const candidate = response('COMPLETED', 'METRIC_BREAKDOWN', { total: '10.00' });
    const result = validateAssistantResponse('GET_LIQUIDITY', candidate);
    assert.equal(result.kind, 'VALID');
    if (result.kind === 'VALID') assert.equal(result.response, candidate as unknown as StructuredAssistantResponse);
  });
});
