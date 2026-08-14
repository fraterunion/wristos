import { parseMoneyToken, findFirstMoneyMention } from '../extraction/money-shorthand';
import { detectCurrencyAlias } from '../extraction/currency-alias';
import { detectCanonicalAccount, toSaleDestination, toCapitalAccount, toCanonicalAccount } from '../extraction/account-alias';
import { captureUntilMarker, captureAfterMarker, stripLeadingArticle, PERSON_STOP_MARKERS_RE, WATCH_STOP_MARKERS_RE } from '../extraction/phrase-segments';
import { normalizeMessage } from '../text-normalize';

describe('money-shorthand', () => {
  it.each([
    ['500k', 500000],
    ['500 K', 500000],
    ['500 mil', 500000],
    ['500,000', 500000],
    ['$500,000', 500000],
    ['10k usd', 10000],
    ['415k mxn', 415000],
    ['1,500', 1500],
    ['1.5 millones', 1500000],
    ['300', 300],
    ['415 mil', 415000],
  ])('parses %s -> %d', (input, expected) => {
    expect(parseMoneyToken(input)).toBe(expected);
  });

  it('returns null for non-money text', () => {
    expect(parseMoneyToken('bruce wayne')).toBeNull();
  });

  it('finds the first money mention and its index in a longer string', () => {
    const text = 'bruce wayne en 500k mxn a abraham';
    const result = findFirstMoneyMention(text);
    expect(result?.amount).toBe(500000);
    // Index includes the regex's own leading \s* (matches at the space
    // before "500k", not the digit itself) — assert against indexOf rather
    // than a hand-counted literal to keep this robust to pattern tweaks.
    expect(result?.index).toBe(text.indexOf(' 500k') );
  });

  it('"millones" is never misread as "mil" + stray suffix (alternation-order regression)', () => {
    expect(parseMoneyToken('2 millones')).toBe(2000000);
    expect(parseMoneyToken('2 mil')).toBe(2000);
  });
});

describe('currency-alias', () => {
  it('detects MXN aliases', () => {
    expect(detectCurrencyAlias('500 pesos')).toBe('MXN');
    expect(detectCurrencyAlias('500 mxn')).toBe('MXN');
    expect(detectCurrencyAlias('moneda nacional')).toBe('MXN');
  });

  it('detects USD aliases', () => {
    expect(detectCurrencyAlias('10k usd')).toBe('USD');
    expect(detectCurrencyAlias('10k dolares')).toBe('USD');
    expect(detectCurrencyAlias('10k dlls')).toBe('USD');
    expect(detectCurrencyAlias('10k dls')).toBe('USD');
  });

  it('returns null when no currency word is present', () => {
    expect(detectCurrencyAlias('500k')).toBeNull();
  });
});

describe('account-alias', () => {
  it('detects CASH/BANK/CESAR aliases', () => {
    expect(detectCanonicalAccount('pago en efectivo')).toBe('CASH');
    expect(detectCanonicalAccount('por bancos')).toBe('BANK');
    expect(detectCanonicalAccount('a la cuenta cesar')).toBe('CESAR');
  });

  it('CESAR is checked before BANK/CASH (most specific first)', () => {
    expect(detectCanonicalAccount('cuenta de cesar')).toBe('CESAR');
  });

  it('remaps BANK to BANCOS for sale destination, leaves CASH/CESAR untouched', () => {
    expect(toSaleDestination('BANK')).toBe('BANCOS');
    expect(toSaleDestination('CASH')).toBe('CASH');
    expect(toSaleDestination('CESAR')).toBe('CESAR');
  });

  it('remaps CESAR to CESAR_ACCOUNT for capital, leaves CASH/BANK untouched', () => {
    expect(toCapitalAccount('CESAR')).toBe('CESAR_ACCOUNT');
    expect(toCapitalAccount('BANK')).toBe('BANK');
    expect(toCapitalAccount('CASH')).toBe('CASH');
  });

  it('canonical passthrough is the identity function', () => {
    expect(toCanonicalAccount('BANK')).toBe('BANK');
    expect(toCanonicalAccount('CASH')).toBe('CASH');
    expect(toCanonicalAccount('CESAR')).toBe('CESAR');
  });
});

describe('phrase-segments', () => {
  it('captureUntilMarker stops at the first marker word', () => {
    const { raw, folded } = normalizeMessage('bruce wayne en 500k a abraham');
    const span = captureUntilMarker(raw, folded, 0);
    expect(span?.text).toBe('bruce wayne');
  });

  it('captureAfterMarker finds the marker and captures what follows', () => {
    const { raw, folded } = normalizeMessage('vendi algo a abraham diaz por bancos');
    const span = captureAfterMarker(raw, folded, /\ba\b/, 0);
    expect(span?.text).toBe('abraham diaz');
  });

  it('PERSON_STOP_MARKERS_RE stops at a digit even with no marker word between name and amount', () => {
    const { raw, folded } = normalizeMessage('a jose 80 mil pesos');
    const span = captureAfterMarker(raw, folded, /\ba\b/, 0, PERSON_STOP_MARKERS_RE);
    expect(span?.text).toBe('jose');
  });

  it('WATCH_STOP_MARKERS_RE stops at a whitespace-then-digit boundary but not at a leading digit', () => {
    const { raw, folded } = normalizeMessage('bruce 500 bancos');
    const span = captureUntilMarker(raw, folded, 0, WATCH_STOP_MARKERS_RE);
    expect(span?.text).toBe('bruce');
  });

  it('stripLeadingArticle removes un/una/el/la/los/las', () => {
    expect(stripLeadingArticle('un Bruce Wayne')).toBe('Bruce Wayne');
    expect(stripLeadingArticle('el relojero')).toBe('relojero');
    expect(stripLeadingArticle('Bruce Wayne')).toBe('Bruce Wayne');
  });

  it('captureAfterMarker returns null when the marker is not found', () => {
    const { raw, folded } = normalizeMessage('vendi bruce wayne en 500k');
    const span = captureAfterMarker(raw, folded, /\bcon\b/, 0);
    expect(span).toBeNull();
  });
});
