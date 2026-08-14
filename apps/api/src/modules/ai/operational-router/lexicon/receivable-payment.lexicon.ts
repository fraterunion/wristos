import { afterSpan, captureAfterMarker, captureUntilMarker, PERSON_STOP_MARKERS_RE } from '../extraction/phrase-segments';
import { findFirstMoneyMention } from '../extraction/money-shorthand';
import { detectCanonicalAccount, toCanonicalAccount } from '../extraction/account-alias';
import { CapabilityLexicon, LexiconMatchResult, RouterEntities, VerbMatch } from '../operational-intent-router.types';

/**
 * REGISTER_RECEIVABLE_PAYMENT — someone paid US. Spanish allows the subject
 * either before OR after this verb group, both handled:
 *   1. Pre-verbal: "<debtor> me pagó/depositó/liquidó ..." ("José me pagó
 *      120 mil").
 *   2. Post-verbal: "me pagó/depositó/liquidó <debtor> ..." ("Me pagó César
 *      por Bancos.") — common in casual speech; without this, "Me pagó
 *      César" would silently extract an empty customerQuery.
 *   3. "cobré/entró el pago/cayó el pago (de <debtor>) ..." — verb-first,
 *      debtor (if stated) follows "de".
 * Never mistake a sale's embedded payment clause for this — the sale
 * lexicon is tried first in the orchestrator's fixed capability order (see
 * operational-intent-router.service.ts) specifically to avoid this collision.
 */
const SUBJECT_VERB_RE = /\b(me pago|me pagaron|me deposito|me depositaron|nos pago|nos pagaron|nos deposito|nos depositaron|me liquido|me liquidaron)\b/;
const VERB_FIRST_RE = /\b(cobre|cobramos|entro el pago|cayo el pago|me cayo el pago)\b/;

const DEBTOR_AFTER_MARKER_RE = /\bde\b/;

export const receivablePaymentLexicon: CapabilityLexicon = {
  capability: 'REGISTER_RECEIVABLE_PAYMENT',
  detect(folded: string, raw: string): LexiconMatchResult | null {
    const subjectVerbExec = SUBJECT_VERB_RE.exec(folded);
    const verbFirstExec = subjectVerbExec ? null : VERB_FIRST_RE.exec(folded);
    const verbExec = subjectVerbExec ?? verbFirstExec;
    if (!verbExec) return null;

    const verbMatch: VerbMatch = { index: verbExec.index, matchedText: verbExec[0] };
    const evidence: string[] = [`verb:${verbExec[0]}`];
    const entities: RouterEntities = {};
    const afterVerbIndex = verbExec.index + verbExec[0].length;

    // Tracks the furthest-right index any *name* span consumed, so the
    // account-alias scan below never re-reads a captured name — see
    // afterSpan()'s doc comment for why this matters (a counterparty named
    // "César" must never be misread as "Cuenta César").
    let nameSpanEnd = afterVerbIndex;

    if (subjectVerbExec) {
      const preVerbalSubject = raw.slice(0, subjectVerbExec.index).trim();
      if (preVerbalSubject) {
        entities.customerQuery = preVerbalSubject;
        evidence.push(`customerQuery:${preVerbalSubject}`);
      } else {
        // Post-verbal subject ("Me pagó César por Bancos.") — the verb sits
        // at (or near) the start of the message, so there's nothing before
        // it to capture; try immediately after instead.
        const postVerbalSpan = captureUntilMarker(raw, folded, afterVerbIndex, PERSON_STOP_MARKERS_RE);
        if (postVerbalSpan) {
          entities.customerQuery = postVerbalSpan.text;
          evidence.push(`customerQuery:${postVerbalSpan.text}`);
          nameSpanEnd = afterSpan(nameSpanEnd, postVerbalSpan);
        }
      }
    } else {
      const debtorSpan = captureAfterMarker(raw, folded, DEBTOR_AFTER_MARKER_RE, afterVerbIndex, PERSON_STOP_MARKERS_RE);
      if (debtorSpan) {
        entities.customerQuery = debtorSpan.text;
        evidence.push(`customerQuery:${debtorSpan.text}`);
        nameSpanEnd = afterSpan(nameSpanEnd, debtorSpan);
      }
    }

    const money = findFirstMoneyMention(folded.slice(afterVerbIndex)) ?? findFirstMoneyMention(folded);
    if (money) {
      entities.amount = money.amount;
      evidence.push(`amount:${money.amount}`);
    }
    // No `currency` here, by design: `currency` is NOT in REGISTER_RECEIVABLE_PAYMENT's
    // planner-required fields (business-actions.ts), and register-receivable-payment
    // -entity-resolver.service.ts resolves it server-side from the matched open
    // receivable's own row (`row.currency ?? 'MXN'`) — whatever the router
    // supplied would be irrelevant at best, a new default policy at worst.

    const account = detectCanonicalAccount(folded.slice(nameSpanEnd));
    if (account) {
      entities.destination = toCanonicalAccount(account);
      evidence.push(`destination:${entities.destination}`);
    }

    // Require an actual customerQuery — matching an SUBJECT_VERB_RE verb
    // alone (with no name found before OR after it) is not enough; without
    // a counterparty, accountId (required) can never be resolved anyway.
    const sufficientEvidence = Boolean(entities.amount) && Boolean(entities.customerQuery);
    return { verbMatch, entities, sufficientEvidence, evidence };
  },
};

export { SUBJECT_VERB_RE, VERB_FIRST_RE };
