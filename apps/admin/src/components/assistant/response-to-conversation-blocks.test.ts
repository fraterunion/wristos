import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateAssistantResponse } from '@/lib/assistant-response-validation';
import type { StructuredAssistantResponse } from '@/lib/assistant-types';
import { manualCtaLabel, responseToConversationBlocks } from './response-to-conversation-blocks';

function response(
  interactionState: string,
  responseType: string,
  payload: Record<string, unknown> = {},
  warnings: Array<{ code: string; message: string }> = [],
): StructuredAssistantResponse {
  return {
    requestId: 'req-1',
    conversationId: 'conv-1',
    workspaceId: 'ws-1',
    interactionState: interactionState as StructuredAssistantResponse['interactionState'],
    responseType: responseType as StructuredAssistantResponse['responseType'],
    payload,
    warnings,
    suggestedActions: [],
    traceId: 'trace-1',
    createdAt: '2026-08-06T12:00:00.000Z',
  } as StructuredAssistantResponse;
}

describe('responseToConversationBlocks', () => {
  it('maps a liquidity METRIC_BREAKDOWN into intro, summary, and a compact breakdown', () => {
    const candidate = response('COMPLETED', 'METRIC_BREAKDOWN', {
      data: {
        cashMxn: '480000.00',
        bankMxn: '3000000.00',
        cryptoMxn: '1053792.00',
        cesarMxn: '4000000.00',
        totalLiquidityMxn: '8533792.00',
        cryptoPriceStatus: 'FRESH',
        cryptoOldestPriceCapturedAt: null,
        warnings: [],
      },
      summary: 'Total liquidity MXN 8533792.00',
    });
    const blocks = responseToConversationBlocks('GET_LIQUIDITY', candidate);
    assert.equal(blocks[0].kind, 'text');
    assert.equal((blocks[0] as { text: string }).text, 'Tu liquidez total es:');
    assert.equal(blocks[1].kind, 'summary');
    assert.equal((blocks[1] as { value: string }).value, '$8,533,792 MXN');
    assert.equal(blocks[2].kind, 'breakdown');
    const items = (blocks[2] as { items: Array<{ label: string; value: string }> }).items;
    assert.deepEqual(items.map((item) => item.label), ['Efectivo', 'Bancos', 'Crypto', 'Cuenta César']);
    assert.equal(items[0].value, '$480,000 MXN');
    // The backend's English summary string must never leak into the UI.
    assert.equal(JSON.stringify(blocks).includes('Total liquidity'), false);
  });

  it('maps monthly profit into a labeled Spanish breakdown', () => {
    const candidate = response('COMPLETED', 'METRIC_BREAKDOWN', {
      data: {
        period: '2026-07', salesMxn: '500000.00', cogsMxn: '300000.00',
        bankCommissionsMxn: '5000.00', operatingExpensesMxn: '20000.00',
        netProfitMxn: '175000.00', saleCount: 4,
      },
    });
    const blocks = responseToConversationBlocks('GET_MONTHLY_PROFIT', candidate);
    assert.equal((blocks[0] as { text: string }).text, 'La utilidad de 2026-07 es:');
    assert.equal((blocks[1] as { value: string }).value, '$175,000 MXN');
    const items = (blocks[2] as { items: Array<{ label: string; value: string }> }).items;
    assert.equal(items.some((item) => item.label === 'Ventas registradas' && item.value === '4'), true);
  });

  it('turns an ENTITY_LIST of clients into a conversational count plus choice chips with pending-balance context', () => {
    const candidate = response('COMPLETED', 'ENTITY_LIST', {
      data: {
        items: [
          { id: 'c1', name: 'José Hernández', openReceivableCount: 1, openReceivableTotalByCurrency: { MXN: '225000.00', USD: '0.00' } },
          { id: 'c2', name: 'José Pérez', openReceivableCount: 0, openReceivableTotalByCurrency: { MXN: '0.00', USD: '0.00' } },
        ],
      },
    });
    const blocks = responseToConversationBlocks('SEARCH_CLIENT', candidate);
    assert.equal((blocks[0] as { text: string }).text, 'Encontré 2 clientes.');
    const choices = blocks.find((block) => block.kind === 'choices') as { options: Array<{ id: string; label: string; context?: string }>; allowOther: boolean };
    assert.ok(choices);
    assert.equal(choices.options[0].label, 'José Hernández');
    assert.equal(choices.options[0].context, '$225,000 MXN pendiente');
    assert.equal(choices.options[1].context, undefined);
    assert.equal(choices.allowOther, true);
  });

  it('turns inventory ENTITY_LIST results into a compact list, not chips', () => {
    const candidate = response('COMPLETED', 'ENTITY_LIST', {
      data: { items: [{ id: 'w1', brand: 'Rolex', model: 'GMT-Master II', reference: '126710BLRO', status: 'AVAILABLE', cost: '350000.00' }] },
    });
    const blocks = responseToConversationBlocks('SEARCH_INVENTORY', candidate);
    assert.equal((blocks[0] as { text: string }).text, 'Encontré 1 reloj.');
    assert.equal(blocks.some((block) => block.kind === 'choices'), false);
    const list = blocks.find((block) => block.kind === 'list') as { items: Array<{ label: string }> };
    assert.equal(list.items[0].label, 'Rolex GMT-Master II (126710BLRO)');
  });

  it('presents MISSING_FIELDS_CARD as one conversational question (first field only)', () => {
    const candidate = response('NEEDS_INPUT', 'MISSING_FIELDS_CARD', {
      groups: [{ id: 'required', label: 'Datos requeridos', fields: [
        { key: 'clientId', question: '¿Quién compró el reloj?' },
        { key: 'currency', question: '¿En qué moneda fue la venta?' },
      ] }],
      message: '¿Quién compró el reloj?',
    });
    const blocks = responseToConversationBlocks('REGISTER_SALE', candidate);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, 'question');
    const question = blocks[0] as { text: string; fields: Array<{ key: string; question: string }> };
    assert.equal(question.text, '¿Quién compró el reloj?');
    assert.deepEqual(question.fields.map((field) => field.key), ['clientId']);
  });

  it('maps non-executable ACTION_PREVIEW_CARD to a manual-module CTA (never bare "Confirmar")', () => {
    const candidate = response('READY_FOR_CONFIRMATION', 'ACTION_PREVIEW_CARD', {
      preview: {
        title: 'Venta', category: 'SALE', confirmationTier: 'STANDARD',
        fields: [{ label: 'Reloj', value: 'Rolex GMT Batman' }, { label: 'Precio', value: '350000' }],
        warnings: [],
        estimatedEffects: [{ area: 'INVENTORY', description: 'El reloj saldría del inventario disponible.' }],
      },
      message: 'Esta acción todavía no está habilitada para ejecución desde el asistente.',
    });
    const blocks = responseToConversationBlocks('REGISTER_SALE', candidate);
    const preview = blocks[0] as { kind: string; intro: string; ctaLabel: string; ctaKind: string; fields: Array<{ label: string; value: string }>; effects: string[] };
    assert.equal(preview.kind, 'preview');
    assert.equal(preview.intro, 'Perfecto. Esto es lo que voy a preparar:');
    assert.equal(preview.ctaLabel, 'Abrir Ventas');
    assert.equal(preview.ctaKind, 'MANUAL_MODULE');
    assert.notEqual(preview.ctaLabel, 'Confirmar');
    assert.equal(preview.fields[0].label, 'Reloj');
    assert.equal(preview.effects[0], 'El reloj saldría del inventario disponible.');
    const flat = JSON.stringify(blocks);
    for (const forbidden of ['Listo', 'Registrado', 'Completado', 'Venta realizada', 'Pago registrado']) {
      assert.equal(flat.includes(forbidden), false, `preview blocks must not say "${forbidden}"`);
    }
  });

  it('maps executable REGISTER_SALE preview to Registrar venta CTA', () => {
    const candidate = response('READY_FOR_CONFIRMATION', 'ACTION_PREVIEW_CARD', {
      executable: true,
      planFingerprint: 'a'.repeat(64),
      preview: {
        title: 'Register Sale',
        fields: [{ label: 'Reloj', value: 'Batman' }],
        warnings: [],
        estimatedEffects: [{ area: 'Inventory', description: 'Inventario: AVAILABLE → SOLD.' }],
      },
    });
    (candidate as { actionRunId?: string }).actionRunId = 'run-1';
    const blocks = responseToConversationBlocks('REGISTER_SALE', candidate);
    const preview = blocks[0] as { ctaLabel: string; ctaKind: string; intro: string };
    assert.equal(preview.ctaLabel, 'Registrar venta');
    assert.equal(preview.ctaKind, 'CONFIRM_SALE');
    assert.equal(preview.intro, 'Perfecto. Esto es lo que voy a registrar:');
  });

  it('maps executable REGISTER_RECEIVABLE_PAYMENT preview to Registrar pago CTA', () => {
    const candidate = response('READY_FOR_CONFIRMATION', 'ACTION_PREVIEW_CARD', {
      executable: true,
      planFingerprint: 'b'.repeat(64),
      preview: {
        title: 'Register Receivable Payment',
        fields: [
          { label: 'Cliente', value: 'José' },
          { label: 'Pago', value: '$35,000 MXN' },
          { label: 'Destino', value: 'Bancos' },
        ],
        warnings: [],
        estimatedEffects: [{ area: 'CxC', description: 'CxC $100,000 → $65,000' }],
      },
    });
    (candidate as { actionRunId?: string }).actionRunId = 'run-pay';
    const blocks = responseToConversationBlocks('REGISTER_RECEIVABLE_PAYMENT', candidate);
    const preview = blocks[0] as { ctaLabel: string; ctaKind: string; intro: string };
    assert.equal(preview.ctaLabel, 'Registrar pago');
    assert.equal(preview.ctaKind, 'CONFIRM_PAYMENT');
    assert.equal(preview.intro, 'Voy a registrar este pago:');
  });

  it('maps executable REGISTER_EXPENSE preview to Registrar gasto CTA', () => {
    const candidate = response('READY_FOR_CONFIRMATION', 'ACTION_PREVIEW_CARD', {
      executable: true,
      planFingerprint: 'c'.repeat(64),
      preview: {
        title: 'Register Expense',
        fields: [
          { label: 'Concepto', value: 'Gasolina' },
          { label: 'Categoría', value: 'Gasolina' },
          { label: 'Monto', value: '$2,500 MXN' },
          { label: 'Pagado desde', value: 'Efectivo' },
        ],
        warnings: [],
        estimatedEffects: [{ area: 'Gastos', description: 'Gastos del mes: +$2,500 MXN' }],
      },
    });
    (candidate as { actionRunId?: string }).actionRunId = 'run-exp';
    const blocks = responseToConversationBlocks('REGISTER_EXPENSE', candidate);
    const preview = blocks[0] as { ctaLabel: string; ctaKind: string; intro: string };
    assert.equal(preview.ctaLabel, 'Registrar gasto');
    assert.equal(preview.ctaKind, 'CONFIRM_EXPENSE');
    assert.equal(preview.intro, 'Voy a registrar este gasto:');
  });

  it('maps executable REGISTER_PURCHASE preview to Registrar compra CTA', () => {
    const candidate = response('READY_FOR_CONFIRMATION', 'ACTION_PREVIEW_CARD', {
      executable: true,
      planFingerprint: 'd'.repeat(64),
      preview: {
        title: 'Register Purchase',
        fields: [
          { label: 'Reloj', value: 'Rolex GMT-Master II Batman' },
          { label: 'Costo', value: '$280,000 MXN' },
        ],
        warnings: [],
        estimatedEffects: [{ area: 'Inventario', description: '+1 reloj' }],
      },
    });
    (candidate as { actionRunId?: string }).actionRunId = 'run-purchase';
    const blocks = responseToConversationBlocks('REGISTER_PURCHASE', candidate);
    const preview = blocks[0] as { ctaLabel: string; ctaKind: string; intro: string };
    assert.equal(preview.ctaLabel, 'Registrar compra');
    assert.equal(preview.ctaKind, 'CONFIRM_PURCHASE');
    assert.equal(preview.intro, 'Voy a registrar esta compra:');
  });

  it('maps executable CREATE_RECEIVABLE preview to Crear cuenta por cobrar CTA', () => {
    const candidate = response('READY_FOR_CONFIRMATION', 'ACTION_PREVIEW_CARD', {
      executable: true,
      executableWrite: true,
      capability: 'CREATE_RECEIVABLE',
      actionRunId: 'ar-cxc',
      planFingerprint: 'fp-cxc',
      preview: { title: 'Cuenta por cobrar', fields: [], warnings: [], estimatedEffects: [] },
    });
    const blocks = responseToConversationBlocks('CREATE_RECEIVABLE', candidate);
    const preview = blocks[0] as { ctaLabel: string; ctaKind: string };
    assert.equal(preview.ctaLabel, 'Crear cuenta por cobrar');
    assert.equal(preview.ctaKind, 'CONFIRM_RECEIVABLE');
  });

  it('maps executable CREATE_PAYABLE preview to Crear cuenta por pagar CTA', () => {
    const candidate = response('READY_FOR_CONFIRMATION', 'ACTION_PREVIEW_CARD', {
      executable: true,
      executableWrite: true,
      capability: 'CREATE_PAYABLE',
      actionRunId: 'ar-cxp',
      planFingerprint: 'fp-cxp',
      preview: { title: 'Cuenta por pagar', fields: [], warnings: [], estimatedEffects: [] },
    });
    const blocks = responseToConversationBlocks('CREATE_PAYABLE', candidate);
    const preview = blocks[0] as { ctaLabel: string; ctaKind: string };
    assert.equal(preview.ctaLabel, 'Crear cuenta por pagar');
    assert.equal(preview.ctaKind, 'CONFIRM_PAYABLE');
  });

  it('maps executable CREATE_CLIENT preview to Crear cliente CTA', () => {
    const candidate = response('READY_FOR_CONFIRMATION', 'ACTION_PREVIEW_CARD', {
      executable: true,
      planFingerprint: 'e'.repeat(64),
      preview: {
        title: 'Create Client',
        fields: [
          { label: 'Nombre', value: 'José Hernández' },
          { label: 'Correo', value: '—' },
          { label: 'Teléfono', value: '—' },
        ],
        warnings: [],
        estimatedEffects: [
          { area: 'CRM', description: '+1 cliente' },
          { area: 'Finanzas', description: 'Sin movimientos financieros' },
        ],
      },
    });
    (candidate as { actionRunId?: string }).actionRunId = 'run-client';
    const blocks = responseToConversationBlocks('CREATE_CLIENT', candidate);
    const preview = blocks[0] as { ctaLabel: string; ctaKind: string; intro: string };
    assert.equal(preview.ctaLabel, 'Crear cliente');
    assert.equal(preview.ctaKind, 'CONFIRM_CLIENT');
    assert.equal(preview.intro, 'Voy a crear este cliente:');
  });

  it('every unbound write intent has a truthful non-"Confirmar" CTA label', () => {
    const intents = [
      'REGISTER_SETTLEMENT', 'REGISTER_CRYPTO_POSITION', 'REGISTER_CRYPTO_PRICE',
    ] as const;
    for (const intent of intents) {
      const label = manualCtaLabel(intent);
      assert.notEqual(label, 'Confirmar');
      assert.notEqual(label, 'Confirmar venta');
      assert.notEqual(label, 'Confirmar pago');
      assert.notEqual(label, 'Confirmar gasto');
      assert.notEqual(label, 'Confirmar compra');
      assert.notEqual(label, 'Crear cliente');
      assert.ok(label.length > 0);
    }
  });

  it('renders ERROR_RECOVERY_CARD as a short conversational error block', () => {
    const candidate = response('FAILED', 'ERROR_RECOVERY_CARD', {
      message: 'No fue posible completar la consulta.',
      unchanged: 'No se modificaron datos de negocio.',
    });
    const blocks = responseToConversationBlocks('GET_LIQUIDITY', candidate);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, 'error');
    assert.equal((blocks[0] as { text: string }).text, 'No fue posible completar la consulta.');
  });

  it('produces stable, unique, position-based ids on every call', () => {
    const candidate = response('COMPLETED', 'METRIC_BREAKDOWN', { data: { cashMxn: '100.00' } });
    const first = responseToConversationBlocks('GET_LIQUIDITY', candidate);
    const second = responseToConversationBlocks('GET_LIQUIDITY', candidate);
    assert.deepEqual(first.map((block) => block.id), second.map((block) => block.id));
    assert.equal(new Set(first.map((block) => block.id)).size, first.length);
  });

  it('appends warnings and the unchanged note after the main content, for non-error responses', () => {
    const candidate = response(
      'READY_FOR_CONFIRMATION',
      'ACTION_PREVIEW_CARD',
      { preview: { title: 'Venta', fields: [], warnings: [], estimatedEffects: [] }, unchanged: 'No se ejecutó ni modificó ningún dato de negocio.' },
      [{ code: 'BELOW_COST', message: 'El precio está cerca del costo de adquisición.' }],
    );
    const blocks = responseToConversationBlocks('REGISTER_SALE', candidate);
    assert.equal(blocks[blocks.length - 2].kind, 'warning');
    assert.equal(blocks[blocks.length - 1].kind, 'note');
  });

  it('only ever runs on responses that validateAssistantResponse has already accepted', () => {
    // A malformed/blocked candidate must fail closed before it ever reaches the adapter.
    const malicious = response('COMPLETED', 'SUCCESS_RECEIPT', { message: 'Venta realizada y registrada' });
    const validation = validateAssistantResponse('REGISTER_SALE', malicious);
    assert.equal(validation.kind, 'FAIL_CLOSED');
    // The safety copy never contains backend-supplied text, regardless of the adapter.
    if (validation.kind === 'FAIL_CLOSED') {
      assert.equal(JSON.stringify(validation).includes('Venta realizada'), false);
    }
  });
});
