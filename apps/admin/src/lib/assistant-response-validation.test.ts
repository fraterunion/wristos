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

  it('blocks malformed REGISTER_SALE success and other write COMPLETED responses', () => {
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
        assert.equal(JSON.stringify(result).includes('<script>'), false);
        assert.equal(result.manualHref, '/ventas');
      }
    }
  });

  it('accepts canonical REGISTER_SALE SUCCESS_RECEIPT after execution', () => {
    const candidate = response('COMPLETED', 'SUCCESS_RECEIPT', {
      message: 'Listo. La venta quedó registrada.',
      executableWrite: true,
      capability: 'REGISTER_SALE',
      receipt: {
        dealId: 'deal-1',
        watchLabel: 'Rolex Batman',
        amount: '350000.00',
        currency: 'MXN',
        paymentMode: 'PAID',
        destination: 'BANCOS',
        remainingReceivable: '0.00',
      },
    });
    const result = validateAssistantResponse('REGISTER_SALE', candidate);
    assert.equal(result.kind, 'VALID');
    if (result.kind === 'VALID') assert.equal(result.response, candidate as unknown as StructuredAssistantResponse);
  });

  it('accepts canonical REGISTER_RECEIVABLE_PAYMENT SUCCESS_RECEIPT after execution', () => {
    const candidate = response('COMPLETED', 'SUCCESS_RECEIPT', {
      message: 'Listo. El pago quedó registrado.',
      executableWrite: true,
      capability: 'REGISTER_RECEIVABLE_PAYMENT',
      receipt: {
        kind: 'RECEIVED_MONEY',
        paymentId: 'pay-1',
        receivableEntryId: 'entry-1',
        amount: '35000.00',
        currency: 'MXN',
        destination: 'BANK',
        remainingReceivable: '65000.00',
      },
    });
    const result = validateAssistantResponse('REGISTER_RECEIVABLE_PAYMENT', candidate);
    assert.equal(result.kind, 'VALID');
  });

  it('blocks malformed REGISTER_RECEIVABLE_PAYMENT success', () => {
    const result = validateAssistantResponse(
      'REGISTER_RECEIVABLE_PAYMENT',
      response('COMPLETED', 'SUCCESS_RECEIPT', {
        message: 'Listo',
        executableWrite: true,
        receipt: { amount: '1' },
      }),
    );
    assert.equal(result.kind, 'FAIL_CLOSED');
  });

  it('accepts canonical REGISTER_EXPENSE SUCCESS_RECEIPT after execution', () => {
    const candidate = response('COMPLETED', 'SUCCESS_RECEIPT', {
      message: 'Listo. El gasto quedó registrado.',
      executableWrite: true,
      capability: 'REGISTER_EXPENSE',
      receipt: {
        expenseId: 'exp-1',
        category: 'GASOLINE',
        sourceAccount: 'CASH',
        amount: '2500.00',
        currency: 'MXN',
      },
    });
    const result = validateAssistantResponse('REGISTER_EXPENSE', candidate);
    assert.equal(result.kind, 'VALID');
  });

  it('rejects malformed REGISTER_EXPENSE SUCCESS_RECEIPT', () => {
    const result = validateAssistantResponse(
      'REGISTER_EXPENSE',
      response('COMPLETED', 'SUCCESS_RECEIPT', {
        message: 'Listo',
        executableWrite: true,
        receipt: { amount: '1' },
      }),
    );
    assert.equal(result.kind, 'FAIL_CLOSED');
  });

  it('still blocks COMPLETED for unbound write intents', () => {
    const candidate = response('COMPLETED', 'SUCCESS_RECEIPT', {
      message: 'Listo',
      receipt: { dealId: 'x', paymentMode: 'PAID', amount: '1' },
      executableWrite: true,
    });
    const result = validateAssistantResponse('REGISTER_PURCHASE', candidate);
    assert.equal(result.kind, 'FAIL_CLOSED');
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
