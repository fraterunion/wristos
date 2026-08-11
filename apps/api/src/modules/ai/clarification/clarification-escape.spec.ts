import {
  detectHighConfidenceTopicChange,
  looksLikeClarificationCancel,
} from './clarification-escape';

describe('clarification-escape', () => {
  describe('looksLikeClarificationCancel', () => {
    it.each([
      'Cancela.',
      'Olvídalo.',
      'Ya no.',
      'Mejor no.',
      'Déjalo.',
      'No importa.',
      'no',
      'cancelar',
    ])('detects cancel: %s', (text) => {
      expect(looksLikeClarificationCancel(text)).toBe(true);
    });

    it.each(['Pesos', 'Bruce Wayne', 'Registra un gasto de 500 pesos.', 'el primero'])(
      'does not cancel: %s',
      (text) => {
        expect(looksLikeClarificationCancel(text)).toBe(false);
      },
    );
  });

  describe('detectHighConfidenceTopicChange', () => {
    it('detects expense command while sale clarification is pending', () => {
      const hit = detectHighConfidenceTopicChange(
        'Registra un gasto de 500 pesos.',
        'REGISTER_SALE',
      );
      expect(hit).toEqual({ kind: 'TOPIC_CHANGE', hintedIntent: 'REGISTER_EXPENSE' });
    });

    it('does not treat watch names or vague replies as topic changes', () => {
      expect(detectHighConfidenceTopicChange('Pepsi', 'REGISTER_SALE')).toBeNull();
      expect(detectHighConfidenceTopicChange('Bruce Wayne', 'REGISTER_SALE')).toBeNull();
      expect(detectHighConfidenceTopicChange('Pesos', 'REGISTER_EXPENSE')).toBeNull();
      expect(detectHighConfidenceTopicChange('Bancos', 'REGISTER_TREASURY_TRANSFER')).toBeNull();
    });

    it('detects sale restart while expense is pending', () => {
      const hit = detectHighConfidenceTopicChange('Vendí Batman a Juan.', 'REGISTER_EXPENSE');
      expect(hit?.kind).toBe('TOPIC_CHANGE');
      expect(hit?.hintedIntent).toBe('REGISTER_SALE');
    });
  });
});
