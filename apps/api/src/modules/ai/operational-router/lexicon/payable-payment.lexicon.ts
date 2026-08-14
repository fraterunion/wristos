import { afterSpan, captureAfterMarker, PERSON_STOP_MARKERS_RE } from '../extraction/phrase-segments';
import { findFirstMoneyMention } from '../extraction/money-shorthand';
import { detectCanonicalAccount, toCanonicalAccount } from '../extraction/account-alias';
import { CapabilityLexicon, LexiconMatchResult, RouterEntities, VerbMatch } from '../operational-intent-router.types';

/**
 * REGISTER_PAYABLE_PAYMENT — WE paid someone we owed. "le pagué a"/
 * "pagamos a"/"liquidé la cuenta de"/"le liquidé"/"ya le pagué"/"pagué la
 * deuda con". The counterparty follows the verb (via a/de/del/con), unlike
 * receivable-payment where the debtor precedes it — this asymmetry is the
 * main signal separating the two capabilities.
 */
// "pagamos" (not "pagamos a") — the counterparty marker "a" is matched
// separately below by COUNTERPARTY_MARKER_RE, same as every other verb here;
// baking "a" into the verb match itself would leave nothing for the marker
// search to find ("pagamos a jose" -> verb consumes "pagamos a", leaving
// just "jose" with no marker before it).
const PAYABLE_VERB_RE = /\b(le pague|pagamos|liquide la cuenta|le liquide|ya le pague|pague la deuda)\b/;

const COUNTERPARTY_MARKER_RE = /\ba\b|\bdel\b|\bde\b|\bcon\b/;

export const payablePaymentLexicon: CapabilityLexicon = {
  capability: 'REGISTER_PAYABLE_PAYMENT',
  detect(folded: string, raw: string): LexiconMatchResult | null {
    const verbExec = PAYABLE_VERB_RE.exec(folded);
    if (!verbExec) return null;

    const verbMatch: VerbMatch = { index: verbExec.index, matchedText: verbExec[0] };
    const evidence: string[] = [`verb:${verbExec[0]}`];
    const entities: RouterEntities = {};

    const afterVerbIndex = verbExec.index + verbExec[0].length;
    const counterpartySpan = captureAfterMarker(raw, folded, COUNTERPARTY_MARKER_RE, afterVerbIndex, PERSON_STOP_MARKERS_RE);
    if (counterpartySpan) {
      entities.counterpartyQuery = counterpartySpan.text;
      entities.customerQuery = counterpartySpan.text;
      evidence.push(`counterpartyQuery:${counterpartySpan.text}`);
    }

    const money = findFirstMoneyMention(folded.slice(afterVerbIndex));
    if (money) {
      entities.amount = money.amount;
      evidence.push(`amount:${money.amount}`);
    }
    // No `currency` here, by design: `currency` is NOT in REGISTER_PAYABLE_PAYMENT's
    // planner-required fields (business-actions.ts), and payable-payment-entity
    // -resolver.service.ts resolves it server-side from the matched open
    // payable's own row (`row.currency ?? 'MXN'`) — whatever the router
    // supplied would be irrelevant at best, a new default policy at worst.

    // Scoped past the counterparty's own name span — a counterparty named
    // "César" must never be misread as the CESAR treasury account.
    const account = detectCanonicalAccount(folded.slice(afterSpan(afterVerbIndex, counterpartySpan)));
    if (account) {
      entities.sourceAccount = toCanonicalAccount(account);
      evidence.push(`sourceAccount:${entities.sourceAccount}`);
    }

    const sufficientEvidence = Boolean(entities.amount) && Boolean(entities.counterpartyQuery);
    return { verbMatch, entities, sufficientEvidence, evidence };
  },
};

export { PAYABLE_VERB_RE };
