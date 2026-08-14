import { findFirstMoneyMention } from '../extraction/money-shorthand';
import { detectCurrencyAlias } from '../extraction/currency-alias';
import { detectCanonicalAccount, toCanonicalAccount } from '../extraction/account-alias';
import { CapabilityLexicon, LexiconMatchResult, RouterEntities, VerbMatch } from '../operational-intent-router.types';

/**
 * REGISTER_EXPENSE — "gasté"/"gastamos" unambiguously mean an operating
 * expense (sufficientEvidence on their own). "pagué"/"fueron"/"salieron"/
 * "metí" are shared with other capabilities (payable payment, purchase) —
 * they only count as sufficient evidence when a recognized expense category
 * word is also present, per the task's own example: "Pagué 50 mil." alone
 * must stay AMBIGUOUS, never silently become REGISTER_EXPENSE.
 */
const STRONG_VERB_RE = /\b(gaste|gastamos)\b/;
const WEAK_VERB_RE = /\b(pague|pagamos|fueron|salieron|meti)\b/;

const CATEGORY_WORDS: Array<[RegExp, string]> = [
  [/gasolina|combustible|gas\b/, 'GASOLINE'],
  [/caseta|casetas|peaje|peajes/, 'TOLLS'],
  [/relojero|watchmaker/, 'WATCHMAKER'],
  [/estacionamiento|parking/, 'PARKING'],
  [/comida|almuerzo|cena|restaurante/, 'MEALS'],
  [/vuelo|vuelos|avion|boleto de avion/, 'FLIGHTS'],
  [/viaje|hotel|viaticos/, 'TRAVEL'],
  [/publicidad|marketing|anuncios|ads\b/, 'MARKETING'],
  [/comision|comisiones/, 'COMMISSIONS'],
];

function detectCategory(folded: string): string | null {
  for (const [re, category] of CATEGORY_WORDS) {
    if (re.test(folded)) return category;
  }
  return null;
}

export const expenseLexicon: CapabilityLexicon = {
  capability: 'REGISTER_EXPENSE',
  detect(folded: string): LexiconMatchResult | null {
    const strongExec = STRONG_VERB_RE.exec(folded);
    const weakExec = strongExec ? null : WEAK_VERB_RE.exec(folded);
    const verbExec = strongExec ?? weakExec;
    if (!verbExec) return null;

    const verbMatch: VerbMatch = { index: verbExec.index, matchedText: verbExec[0] };
    const evidence: string[] = [`verb:${verbExec[0]}`];
    const entities: RouterEntities = {};

    const afterVerbIndex = verbExec.index + verbExec[0].length;
    const money = findFirstMoneyMention(folded);
    if (money) {
      entities.amount = money.amount;
      evidence.push(`amount:${money.amount}`);
    }

    // Currency is a REQUIRED planner field for REGISTER_EXPENSE
    // (business-actions.ts) — never invented. "Gasté 500 en gasolina." (no
    // currency word) must still trigger the existing conversational
    // clarification ("¿Los 500 fueron en pesos o en dólares?"); only an
    // explicit currency word ("Gasté 500 pesos...") resolves it here.
    const currency = detectCurrencyAlias(folded);
    if (currency) {
      entities.currency = currency;
      evidence.push(`currency:${currency}`);
    }

    const category = detectCategory(folded);
    if (category) {
      entities.category = category;
      evidence.push(`category:${category}`);
    }

    // Scoped to after the verb so nothing said earlier in the sentence can
    // be mistaken for a treasury account (matters more once multi-clause
    // messages are supported — see docs/ai/OPERATIONAL_INTENT_ROUTER.md).
    const account = detectCanonicalAccount(folded.slice(afterVerbIndex));
    if (account) {
      entities.source = toCanonicalAccount(account);
      evidence.push(`source:${entities.source}`);
    }

    // Capability confidence and field-completeness are separate: "Pagué
    // gasolina" (no amount stated) is still strong EXPENSE evidence — the
    // planner asks for the missing amount, same as any other genuinely
    // missing field. Only the ambiguous bare-"pagué" case (no category, no
    // strong verb) must fall through to AMBIGUOUS_OPERATION.
    const sufficientEvidence = Boolean(strongExec) || Boolean(category);
    return { verbMatch, entities, sufficientEvidence, evidence };
  },
};

export { STRONG_VERB_RE, WEAK_VERB_RE };
