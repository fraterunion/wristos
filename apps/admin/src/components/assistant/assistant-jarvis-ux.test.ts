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
});
