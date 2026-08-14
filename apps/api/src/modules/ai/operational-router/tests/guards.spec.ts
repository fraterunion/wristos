import { normalizeMessage } from '../text-normalize';
import { isQuestion } from '../guards/question-guard';
import { isNegatedBeforeIndex } from '../guards/negation-guard';
import { isHypotheticalBeforeIndex } from '../guards/tense-guard';

describe('question-guard', () => {
  it('detects ¿...? punctuated questions', () => {
    expect(isQuestion(normalizeMessage('¿Vendimos el Bruce Wayne?').folded)).toBe(true);
  });

  it('detects trailing ? without leading ¿', () => {
    expect(isQuestion(normalizeMessage('Vendimos el Bruce Wayne?').folded)).toBe(true);
  });

  it('detects unpunctuated interrogative openers', () => {
    expect(isQuestion(normalizeMessage('cuanto pague por el pepsi').folded)).toBe(true);
  });

  it('does NOT flag "ya me"/"ya le" openers — indistinguishable from declarative "Ya le pagué" without punctuation', () => {
    expect(isQuestion(normalizeMessage('ya me pago jose').folded)).toBe(false);
    expect(isQuestion(normalizeMessage('Ya le pagué 30 mil a Carlos por bancos.').folded)).toBe(false);
  });

  it('does not flag a plain completed-event statement', () => {
    expect(isQuestion(normalizeMessage('Vendí Bruce Wayne en 500k.').folded)).toBe(false);
  });
});

describe('negation-guard', () => {
  it('blocks a verb preceded by "no"', () => {
    const { folded } = normalizeMessage('No vendí el Bruce Wayne.');
    const verbIndex = folded.indexOf('vendi');
    expect(isNegatedBeforeIndex(folded, verbIndex)).toBe(true);
  });

  it('blocks a verb preceded by "todavia no"', () => {
    const { folded } = normalizeMessage('Todavía no le he pagado.');
    const verbIndex = folded.indexOf('pagado');
    expect(isNegatedBeforeIndex(folded, verbIndex)).toBe(true);
  });

  it('does not block a verb that precedes the negation marker', () => {
    const { folded } = normalizeMessage('vendi el bruce wayne, no el batman');
    const verbIndex = folded.indexOf('vendi');
    expect(isNegatedBeforeIndex(folded, verbIndex)).toBe(false);
  });

  it('does not false-positive on unrelated text with no negation marker', () => {
    const { folded } = normalizeMessage('Vendí Bruce Wayne en 500k.');
    const verbIndex = folded.indexOf('vendi');
    expect(isNegatedBeforeIndex(folded, verbIndex)).toBe(false);
  });
});

describe('tense-guard', () => {
  it('blocks "si vendo" as hypothetical', () => {
    const { folded } = normalizeMessage('Si vendo el Pepsi en 300 mil, avísame.');
    const verbIndex = folded.indexOf('vendo');
    expect(isHypotheticalBeforeIndex(folded, verbIndex)).toBe(true);
  });

  it('blocks a verb preceded by "voy a"', () => {
    const { folded } = normalizeMessage('voy a vender el bruce wayne en 500k');
    const verbIndex = folded.indexOf('vender');
    expect(isHypotheticalBeforeIndex(folded, verbIndex)).toBe(true);
  });

  it('blocks a verb preceded by "quiero"', () => {
    const { folded } = normalizeMessage('quiero comprar un daytona');
    const verbIndex = folded.indexOf('comprar');
    expect(isHypotheticalBeforeIndex(folded, verbIndex)).toBe(true);
  });

  it('does not flag a plain completed-event verb', () => {
    const { folded } = normalizeMessage('Vendí Bruce Wayne en 500k.');
    const verbIndex = folded.indexOf('vendi');
    expect(isHypotheticalBeforeIndex(folded, verbIndex)).toBe(false);
  });

  it('does not flag "cuando" far from the verb beyond the proximity window', () => {
    const { folded } = normalizeMessage(
      'cuando fui a la tienda me acorde de algo importante y vendo relojes desde hace anos',
    );
    const verbIndex = folded.indexOf('vendo');
    expect(isHypotheticalBeforeIndex(folded, verbIndex)).toBe(false);
  });
});
