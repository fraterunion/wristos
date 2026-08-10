import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildConversationalMissingFieldsPayload,
  mapClarificationAnswer,
  presentClarification,
  presentPolicyAmbiguities,
} from './clarification-presenter';

describe('ClarificationPresenter', () => {
  it('asks currency first for expense with amount+source missing, one question only', () => {
    const presented = presentClarification({
      capability: 'REGISTER_EXPENSE',
      missing: [
        { entity: 'source', question: 'No treasury account specified for the expense outflow.' },
        { entity: 'currency', question: "Amount '500' has no currency specified. Could be USD, MXN, CAD." },
      ],
      entities: { amount: '500', concept: 'gasolina' },
    });
    assert.ok(presented);
    assert.equal(presented!.field, 'currency');
    assert.match(presented!.question, /pesos/i);
    assert.match(presented!.question, /d[oó]lares/i);
    assert.equal(presented!.question.includes('currency'), false);
    assert.equal(presented!.question.includes('Amount'), false);
    assert.equal(presented!.question.includes('CAD'), false);
    assert.equal(presented!.question.includes('treasury'), false);
    assert.deepEqual(
      presented!.choices?.map((c) => c.label),
      ['Pesos', 'Dólares'],
    );
    assert.deepEqual(presented!.remainingFields, ['source']);
  });

  it('asks treasury account next after currency is known', () => {
    const presented = presentClarification({
      capability: 'REGISTER_EXPENSE',
      missing: [{ entity: 'source', question: 'cashAccount required' }],
      entities: { amount: '500', currency: 'MXN', concept: 'gasolina' },
    });
    assert.ok(presented);
    assert.equal(presented!.field, 'source');
    assert.match(presented!.question, /Efectivo/);
    assert.match(presented!.question, /Bancos/);
    assert.equal(presented!.question.includes('cashAccount'), false);
  });

  it('sanitizes policy ambiguity technical English', () => {
    const presented = presentPolicyAmbiguities({
      capability: 'REGISTER_EXPENSE',
      ambiguities: [
        {
          field: 'currency',
          reason: "Amount '500' has no currency specified. Could be USD, MXN, CAD.",
          candidates: ['USD', 'MXN', 'CAD'],
        },
        {
          field: 'cashAccount',
          reason: 'No treasury account specified for the expense outflow.',
        },
      ],
      entities: { amount: 500 },
    });
    assert.ok(presented);
    assert.equal(presented!.field, 'currency');
    assert.match(presented!.question, /500/);
    assert.equal(/CAD|treasury|cashAccount|Amount '/i.test(presented!.question), false);
  });

  it('maps closed answers deterministically', () => {
    assert.deepEqual(mapClarificationAnswer('currency', 'Pesos'), { field: 'currency', value: 'MXN' });
    assert.deepEqual(mapClarificationAnswer('currency', 'dólares'), { field: 'currency', value: 'USD' });
    assert.deepEqual(mapClarificationAnswer('source', 'Bancos'), { field: 'source', value: 'BANK' });
    assert.deepEqual(mapClarificationAnswer('paymentMode', 'A crédito'), {
      field: 'paymentMode',
      value: 'CREDIT',
    });
  });

  it('builds payload with a single field group and choices', () => {
    const payload = buildConversationalMissingFieldsPayload({
      capability: 'REGISTER_EXPENSE',
      missing: [
        { entity: 'currency', question: 'What currency applies?' },
        { entity: 'source', question: 'Which account?' },
      ],
      entities: { amount: '500' },
    });
    assert.equal(payload.groups.length, 1);
    assert.equal(payload.groups[0]!.fields.length, 1);
    assert.equal(payload.clarificationField, 'currency');
    assert.ok(payload.groups[0]!.fields[0]!.choices?.length);
    assert.equal(payload.message.includes('What currency'), false);
  });

  it('uses safe fallback for unknown technical fields', () => {
    const presented = presentClarification({
      capability: 'REGISTER_SALE',
      missing: [{ entity: 'weirdInternalField', question: 'Provide weirdInternalField.' }],
    });
    assert.ok(presented);
    assert.equal(presented!.usedFallback, true);
    assert.match(presented!.question, /dato más|información/i);
    assert.equal(presented!.question.includes('weirdInternalField'), false);
  });

  it('asks transfer source before destination', () => {
    const presented = presentClarification({
      capability: 'REGISTER_TREASURY_TRANSFER',
      missing: [
        { entity: 'destinationAccount' },
        { entity: 'sourceAccount' },
      ],
      entities: { amount: '100000' },
    });
    assert.ok(presented);
    assert.equal(presented!.field, 'sourceAccount');
    assert.match(presented!.question, /sale/i);
  });
});
