import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { responseToConversationBlocks } from './response-to-conversation-blocks';
import type { StructuredAssistantResponse } from '@/lib/assistant-types';

function response(
  interactionState: StructuredAssistantResponse['interactionState'],
  responseType: StructuredAssistantResponse['responseType'],
  payload: StructuredAssistantResponse['payload'],
): StructuredAssistantResponse {
  return {
    requestId: 'req-1',
    conversationId: 'conv-1',
    workspaceId: 'ws-1',
    interactionState,
    responseType,
    payload,
    warnings: [],
    suggestedActions: [],
    traceId: 't1',
    createdAt: new Date().toISOString(),
  };
}

describe('conversational clarification blocks (26UX.2)', () => {
  it('renders one natural question with choices and no Continuar form fields dump', () => {
    const candidate = response('NEEDS_INPUT', 'MISSING_FIELDS_CARD', {
      message: '¿Los 500 fueron en pesos o en dólares?',
      clarificationField: 'currency',
      groups: [
        {
          id: 'required',
          label: 'Aclaración',
          fields: [
            {
              key: 'currency',
              question: '¿Los 500 fueron en pesos o en dólares?',
              choices: [
                { label: 'Pesos', value: 'MXN' },
                { label: 'Dólares', value: 'USD' },
              ],
            },
          ],
        },
      ],
    });
    const blocks = responseToConversationBlocks('REGISTER_EXPENSE', candidate);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.kind, 'question');
    const q = blocks[0] as {
      text: string;
      fields: unknown[];
      choices?: Array<{ label: string }>;
    };
    assert.match(q.text, /pesos/i);
    assert.equal(q.choices?.length, 2);
    assert.equal(q.text.includes('currency'), false);
    assert.equal(q.text.includes('CAD'), false);
  });

  it('sanitizes technical message copy to a safe fallback', () => {
    const candidate = response('NEEDS_INPUT', 'MISSING_FIELDS_CARD', {
      message: "Amount '500' has no currency specified. Could be USD, MXN, CAD.",
      groups: [
        {
          id: 'required',
          fields: [
            {
              key: 'currency',
              question: "Amount '500' has no currency specified. Could be USD, MXN, CAD.",
            },
          ],
        },
      ],
    });
    const blocks = responseToConversationBlocks('REGISTER_EXPENSE', candidate);
    const q = blocks[0] as { text: string };
    assert.equal(q.text.includes('Amount'), false);
    assert.equal(q.text.includes('CAD'), false);
    assert.match(q.text, /dato más|información|pesos/i);
  });
});
