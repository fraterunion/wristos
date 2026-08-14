import { afterSpan, captureAfterMarker, captureUntilMarker, PERSON_STOP_MARKERS_RE, stripLeadingArticle, WATCH_STOP_MARKERS_RE } from '../extraction/phrase-segments';
import { findFirstMoneyMention } from '../extraction/money-shorthand';
import { detectCurrencyAlias } from '../extraction/currency-alias';
import { detectCanonicalAccount, toCanonicalAccount } from '../extraction/account-alias';
import { CapabilityLexicon, LexiconMatchResult, RouterEntities, VerbMatch } from '../operational-intent-router.types';

/**
 * REGISTER_PURCHASE — "compré"/"compre"/"compramos"/"acabo de comprar".
 * "Agarré" is deliberately excluded — the task's own caveat ("only if
 * context strongly indicates a watch purchase") needs corroborating signal
 * this lexicon doesn't attempt to model; it's a documented gap, not a bug —
 * see docs/ai/OPERATIONAL_INTENT_ROUTER.md.
 */
const PURCHASE_VERB_RE = /\b(compre|compramos|acabo de comprar)\b/;

const SELLER_MARKER_RE = /\ba\b|\bde\b/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const purchaseLexicon: CapabilityLexicon = {
  capability: 'REGISTER_PURCHASE',
  detect(folded: string, raw: string): LexiconMatchResult | null {
    const verbExec = PURCHASE_VERB_RE.exec(folded);
    if (!verbExec) return null;
    const verbMatch: VerbMatch = { index: verbExec.index, matchedText: verbExec[0] };
    const evidence: string[] = [`verb:${verbExec[0]}`];
    const entities: RouterEntities = { acquiredAt: todayIso() };

    const afterVerbIndex = verbExec.index + verbExec[0].length;
    const watchSpan = captureUntilMarker(raw, folded, afterVerbIndex, WATCH_STOP_MARKERS_RE);
    if (watchSpan) {
      const watchQuery = stripLeadingArticle(watchSpan.text);
      if (watchQuery) {
        entities.watchQuery = watchQuery;
        evidence.push(`watchQuery:${watchQuery}`);
      }
    }

    const money = findFirstMoneyMention(folded.slice(afterVerbIndex));
    if (money) {
      entities.cost = money.amount;
      evidence.push(`cost:${money.amount}`);
    }

    // Currency is a REQUIRED planner field for REGISTER_PURCHASE
    // (business-actions.ts) — never invented. Only an explicit currency
    // word sets it; otherwise left absent so the planner asks.
    const currency = detectCurrencyAlias(folded.slice(afterVerbIndex));
    if (currency) {
      entities.currency = currency;
      evidence.push(`currency:${currency}`);
    }

    const sellerSpan = captureAfterMarker(raw, folded, SELLER_MARKER_RE, afterVerbIndex, PERSON_STOP_MARKERS_RE);
    if (sellerSpan) {
      const sellerQuery = stripLeadingArticle(sellerSpan.text);
      if (sellerQuery) {
        entities.sellerQuery = sellerQuery;
        evidence.push(`sellerQuery:${sellerQuery}`);
      }
    }

    const paidMatch = /\bpague\b/.test(folded);
    const creditMatch = /\bcredito\b/.test(folded);
    if (paidMatch && creditMatch) {
      entities.paymentMode = 'PARTIAL';
      evidence.push('paymentMode:PARTIAL');
    } else if (creditMatch) {
      entities.paymentMode = 'CREDIT';
      evidence.push('paymentMode:CREDIT');
    } else if (money) {
      // A stated cost with no credit language is treated as paid in full —
      // matches how REGISTER_SALE's "de contado" default reasoning works.
      entities.paymentMode = 'PAID';
      evidence.push('paymentMode:PAID');
    }

    // Scoped past the seller's own name span — a seller named "César" must
    // never be misread as the CESAR treasury account.
    const account = detectCanonicalAccount(folded.slice(afterSpan(afterVerbIndex, sellerSpan)));
    if (account) {
      entities.sourceAccount = toCanonicalAccount(account);
      evidence.push(`sourceAccount:${entities.sourceAccount}`);
    }

    const sufficientEvidence = Boolean(entities.watchQuery) && Boolean(entities.cost);
    return { verbMatch, entities, sufficientEvidence, evidence };
  },
};

export { PURCHASE_VERB_RE };
