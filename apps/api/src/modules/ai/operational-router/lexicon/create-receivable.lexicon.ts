import { captureAfterMarker, PERSON_STOP_MARKERS_RE } from '../extraction/phrase-segments';
import { findFirstMoneyMention } from '../extraction/money-shorthand';
import { detectCurrencyAlias } from '../extraction/currency-alias';
import { CapabilityLexicon, LexiconMatchResult, RouterEntities, VerbMatch } from '../operational-intent-router.types';

/**
 * CREATE_RECEIVABLE — two shapes:
 *   1. "<debtor> nos debe/me debe/quedó debiendo ..." — debtor is the
 *      SUBJECT, stated before the verb ("Abraham nos debe 100 mil").
 *   2. "Crea/registra una cuenta por cobrar a <debtor> por <amount>" —
 *      verb-first, debtor follows "a".
 */
const SUBJECT_BEFORE_VERB_RE = /\b(nos debe|me debe|quedo debiendo|se quedo debiendo)\b/;
const VERB_FIRST_RE = /\b((crea|registra)(?:\s+\w+)*\s+cuenta por cobrar)\b/;

const DEBTOR_AFTER_MARKER_RE = /\ba\b/;

export const createReceivableLexicon: CapabilityLexicon = {
  capability: 'CREATE_RECEIVABLE',
  detect(folded: string, raw: string): LexiconMatchResult | null {
    const subjectExec = SUBJECT_BEFORE_VERB_RE.exec(folded);
    const verbFirstExec = subjectExec ? null : VERB_FIRST_RE.exec(folded);
    const verbExec = subjectExec ?? verbFirstExec;
    if (!verbExec) return null;

    const verbMatch: VerbMatch = { index: verbExec.index, matchedText: verbExec[0] };
    const evidence: string[] = [`verb:${verbExec[0]}`];
    const entities: RouterEntities = {};
    const afterVerbIndex = verbExec.index + verbExec[0].length;

    if (subjectExec) {
      const counterpartyRaw = raw.slice(0, subjectExec.index).trim();
      if (counterpartyRaw) {
        entities.counterpartyName = counterpartyRaw;
        entities.counterpartyQuery = counterpartyRaw;
        evidence.push(`counterpartyName:${counterpartyRaw}`);
      }
    } else {
      const debtorSpan = captureAfterMarker(raw, folded, DEBTOR_AFTER_MARKER_RE, afterVerbIndex, PERSON_STOP_MARKERS_RE);
      if (debtorSpan) {
        entities.counterpartyName = debtorSpan.text;
        entities.counterpartyQuery = debtorSpan.text;
        evidence.push(`counterpartyName:${debtorSpan.text}`);
      }
    }

    const money = findFirstMoneyMention(folded.slice(afterVerbIndex)) ?? findFirstMoneyMention(folded);
    if (money) {
      entities.amount = money.amount;
      evidence.push(`amount:${money.amount}`);
    }

    // Currency is a REQUIRED planner field for CREATE_RECEIVABLE
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

export { SUBJECT_BEFORE_VERB_RE, VERB_FIRST_RE };
