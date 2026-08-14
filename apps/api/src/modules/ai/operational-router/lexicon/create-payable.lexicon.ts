import { captureAfterMarker, PERSON_STOP_MARKERS_RE, stripLeadingArticle } from '../extraction/phrase-segments';
import { findFirstMoneyMention } from '../extraction/money-shorthand';
import { detectCurrencyAlias } from '../extraction/currency-alias';
import { CapabilityLexicon, LexiconMatchResult, RouterEntities, VerbMatch } from '../operational-intent-router.types';

/**
 * CREATE_PAYABLE — "le debemos"/"debemos pagarle"/"quedamos debiendo"/
 * "tenemos pendiente con"/"crea una cuenta por pagar". Verb-first; the
 * counterparty follows via "a" or "con" ("Le debemos 100 mil a Pepe.",
 * "Tenemos pendiente 50k con el relojero.").
 */
const PAYABLE_VERB_RE = /\b(le debemos|debemos pagarle|quedamos debiendo|tenemos pendiente|(crea|registra)(?:\s+\w+)*\s+cuenta por pagar)\b/;

const COUNTERPARTY_MARKER_RE = /\ba\b|\bcon\b/;

export const createPayableLexicon: CapabilityLexicon = {
  capability: 'CREATE_PAYABLE',
  detect(folded: string, raw: string): LexiconMatchResult | null {
    const verbExec = PAYABLE_VERB_RE.exec(folded);
    if (!verbExec) return null;

    const verbMatch: VerbMatch = { index: verbExec.index, matchedText: verbExec[0] };
    const evidence: string[] = [`verb:${verbExec[0]}`];
    const entities: RouterEntities = {};
    const afterVerbIndex = verbExec.index + verbExec[0].length;

    const counterpartySpan = captureAfterMarker(raw, folded, COUNTERPARTY_MARKER_RE, afterVerbIndex, PERSON_STOP_MARKERS_RE);
    if (counterpartySpan) {
      const counterpartyName = stripLeadingArticle(counterpartySpan.text);
      if (counterpartyName) {
        entities.counterpartyName = counterpartyName;
        entities.counterpartyQuery = counterpartyName;
        evidence.push(`counterpartyName:${counterpartyName}`);
      }
    }

    const money = findFirstMoneyMention(folded.slice(afterVerbIndex));
    if (money) {
      entities.amount = money.amount;
      evidence.push(`amount:${money.amount}`);
    }

    // Currency is a REQUIRED planner field for CREATE_PAYABLE
    // (business-actions.ts) — never invented. Only an explicit currency
    // word sets it; otherwise left absent so the planner asks.
    const currency = detectCurrencyAlias(folded);
    if (currency) {
      entities.currency = currency;
      evidence.push(`currency:${currency}`);
    }

    const sufficientEvidence = Boolean(entities.counterpartyName) && Boolean(entities.amount);
    return { verbMatch, entities, sufficientEvidence, evidence };
  },
};

export { PAYABLE_VERB_RE };
