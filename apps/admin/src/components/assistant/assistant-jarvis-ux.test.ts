import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { join } from 'node:path';

/**
 * Source-level guards for the 26UX Jarvis Assistant shell.
 * Ensures permanent dashboard chrome cannot silently return.
 */
describe('Assistant Jarvis UX (26UX) source guards', () => {
  const root = join(__dirname, '../../..');
  const pageSrc = readFileSync(
    join(root, 'src/app/(protected)/assistant/page.tsx'),
    'utf8',
  );
  const composerSrc = readFileSync(
    join(root, 'src/components/assistant/conversation-composer.tsx'),
    'utf8',
  );

  it('removes Solo lectura and permanent quick-action chrome', () => {
    assert.equal(pageSrc.includes('Solo lectura'), false);
    assert.equal(pageSrc.includes('Preparar acciones'), false);
    assert.equal(pageSrc.includes('Consultas rápidas'), false);
    assert.equal(pageSrc.includes('Ver liquidez'), false);
    assert.equal(pageSrc.includes('Ver utilidad'), false);
    assert.equal(pageSrc.includes('Buscar reloj'), false);
    assert.equal(pageSrc.includes('mobileSuggestionLabels'), false);
    assert.equal(pageSrc.includes('writeActionsOpen'), false);
    assert.ok(pageSrc.includes('assistant-empty-state'));
    assert.ok(pageSrc.includes('assistant-chat-shell'));
    assert.ok(pageSrc.includes('Escribe o habla'));
    assert.equal(pageSrc.includes('>Listo<'), false);
  });

  it('shows greeting only via emptyState (not as a permanent header)', () => {
    assert.ok(pageSrc.includes('Buenos días'));
    assert.ok(pageSrc.includes('emptyState={emptyState}'));
    assert.ok(pageSrc.includes('hasConversation'));
  });

  it('keeps confirmation path for all twelve WRITE capabilities', () => {
    for (const capability of [
      'REGISTER_SALE',
      'REGISTER_RECEIVABLE_PAYMENT',
      'REGISTER_EXPENSE',
      'REGISTER_PURCHASE',
      'CREATE_CLIENT',
      'UPDATE_CLIENT',
      'REGISTER_PAYABLE_PAYMENT',
      'REGISTER_TREASURY_TRANSFER',
      'REGISTER_CAPITAL_CONTRIBUTION',
      'REGISTER_CAPITAL_DISTRIBUTION',
      'CREATE_RECEIVABLE',
      'CREATE_PAYABLE',
    ]) {
      assert.ok(pageSrc.includes(`'${capability}'`), capability);
    }
  });

  it('wires browser speech recognition into the same composer submit pipeline', () => {
    assert.ok(
      composerSrc.includes('SpeechRecognition') ||
        composerSrc.includes('webkitSpeechRecognition'),
    );
    assert.ok(composerSrc.includes('Escuchando'));
    assert.equal(composerSrc.includes('confirmAssistantActionRun'), false);
  });

  it('composer is the hero surface with send/mic affordances', () => {
    assert.ok(composerSrc.includes('assistant-send'));
    assert.ok(composerSrc.includes('assistant-mic'));
    assert.ok(composerSrc.includes('min-h-[48px]'));
    assert.ok(composerSrc.includes('safe-area-inset-bottom'));
  });
});

describe('Assistant conversational clarifications (26UX.2) source guards', () => {
  const root = join(__dirname, '../../..');
  const blocksSrc = readFileSync(
    join(root, 'src/components/assistant/conversation-blocks.tsx'),
    'utf8',
  );
  const adapterSrc = readFileSync(
    join(root, 'src/components/assistant/response-to-conversation-blocks.ts'),
    'utf8',
  );

  it('removes mini-form Continuar clarification UI', () => {
    assert.equal(blocksSrc.includes('MissingFieldsForm'), false);
    assert.equal(blocksSrc.includes('>Continuar<'), false);
    assert.ok(adapterSrc.includes('looksTechnicalClarification'));
  });
});
