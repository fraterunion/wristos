import { afterSpan, captureAfterMarker, captureUntilMarker, PERSON_STOP_MARKERS_RE, stripLeadingArticle, WATCH_STOP_MARKERS_RE } from '../extraction/phrase-segments';
import { findFirstMoneyMention } from '../extraction/money-shorthand';
import { detectCurrencyAlias } from '../extraction/currency-alias';
import { detectCanonicalAccount, toSaleDestination } from '../extraction/account-alias';
import { CapabilityLexicon, LexiconMatchResult, RouterEntities, VerbMatch } from '../operational-intent-router.types';

/**
 * REGISTER_SALE.
 *
 * Two evidence tiers, not one:
 *   - COMPLETED_VERB_RE: vendí/vendimos/se vendió/se fue/acabo de vender —
 *     unambiguous completed-event language.
 *   - PRESENT_TENSE_VERB_RE: bare "vendo" — genuinely ambiguous. "Vendo un
 *     Batman en 300 mil" may be an offer/listing, not a completed sale
 *     ("Estoy vendiendo" / ongoing-offer sense), unlike "Vendí" which only
 *     ever means the transaction already happened. Per product policy, a
 *     false WRITE is more dangerous than a missed deterministic routing, so
 *     a present-tense-only match NEVER claims sufficientEvidence, regardless
 *     of how much else resolves — it always falls to AMBIGUOUS_OPERATION
 *     (provider fallback), never HIGH_CONFIDENCE_OPERATION.
 */
const COMPLETED_VERB_RE = /\b(vendi|vendimos|se vendio|se fue|acabo de vender)\b/;
const PRESENT_TENSE_VERB_RE = /\b(vendo)\b/;

const PAID_MARKERS_RE = /\b(me pago|me pagaron|pago todo|de contado|al contado|pago completo)\b/;
const CREDIT_MARKERS_RE = /\b(a credito|credito|quedo debiendo|se quedo debiendo)\b/;
const PARTIAL_MARKERS_RE = /\bme dio\b.*\by\b.*\bdebe\b/;

function detectPaymentMode(folded: string): 'PAID' | 'CREDIT' | 'PARTIAL' | null {
  if (PARTIAL_MARKERS_RE.test(folded)) return 'PARTIAL';
  if (PAID_MARKERS_RE.test(folded)) return 'PAID';
  if (CREDIT_MARKERS_RE.test(folded)) return 'CREDIT';
  return null;
}

const CUSTOMER_MARKER_RE = /\ba\b/;

export const saleLexicon: CapabilityLexicon = {
  capability: 'REGISTER_SALE',
  detect(folded: string, raw: string): LexiconMatchResult | null {
    const completedExec = COMPLETED_VERB_RE.exec(folded);
    const presentExec = completedExec ? null : PRESENT_TENSE_VERB_RE.exec(folded);
    const verbExec = completedExec ?? presentExec;
    if (!verbExec) return null;

    const verbMatch: VerbMatch = { index: verbExec.index, matchedText: verbExec[0] };
    const evidence: string[] = [`verb:${verbExec[0]}`];
    const entities: RouterEntities = {};

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
      entities.price = money.amount;
      evidence.push(`price:${money.amount}`);
    }

    // Currency is a REQUIRED planner field for REGISTER_SALE
    // (business-actions.ts) — the router must never invent it. Only an
    // explicit currency word in the message sets it; otherwise it's left
    // absent so the planner asks ("¿Los 500 fueron en pesos o en
    // dólares?"), exactly as it already does for LLM-sourced candidates.
    const currency = detectCurrencyAlias(folded.slice(afterVerbIndex));
    if (currency) {
      entities.currency = currency;
      evidence.push(`currency:${currency}`);
    }

    const customerSpan = captureAfterMarker(raw, folded, CUSTOMER_MARKER_RE, afterVerbIndex, PERSON_STOP_MARKERS_RE);
    if (customerSpan) {
      const customerQuery = stripLeadingArticle(customerSpan.text);
      if (customerQuery) {
        entities.customerQuery = customerQuery;
        evidence.push(`customerQuery:${customerQuery}`);
      }
    }

    const paymentMode = detectPaymentMode(folded);
    if (paymentMode) {
      entities.paymentMode = paymentMode;
      evidence.push(`paymentMode:${paymentMode}`);
      if (paymentMode !== 'CREDIT') {
        // NOTE: entitySchemas.REGISTER_SALE (intent-schema.ts) does not
        // include `destination`/`bankChannel` as LLM-settable fields at all
        // — only business-actions.ts's planner layer knows them, reachable
        // solely via the closed-choice clarification flow. So even though
        // we compute it here, buildIntentCandidate's per-intent Zod
        // validation silently strips it (its .strip() drops unknown keys).
        // This is an existing architectural constraint, not a router bug —
        // a perfect LLM extraction would hit the identical limit. Left in
        // place (harmless, self-documenting) in case that boundary is ever
        // widened; until then the planner asks one targeted follow-up for
        // just this field, same as it would for a real Claude candidate.
        // Scoped to after the verb AND after any already-captured customer
        // name span, so a customer literally named "Efectivo"/"Banco"/
        // "César" is never mistaken for a payment account (the customer
        // name is captured earlier in this same substring, before the
        // payment-mode markers this scan is looking for).
        const account = detectCanonicalAccount(folded.slice(afterSpan(afterVerbIndex, customerSpan)));
        if (account) {
          entities.destination = toSaleDestination(account);
          evidence.push(`destination:${entities.destination}`);
        }
      }
    }

    // Present-tense "vendo" alone never claims HIGH confidence — see the
    // module doc comment. Completed-event verbs still require watch+price
    // (currency is intentionally NOT part of this bar — it's a real,
    // frequently-missing field the planner is supposed to ask about, not a
    // signal of routing confidence).
    const sufficientEvidence =
      Boolean(completedExec) && Boolean(entities.watchQuery) && Boolean(entities.price);

    return { verbMatch, entities, sufficientEvidence, evidence };
  },
};

// Re-exported so tests can assert the verb patterns directly without duplicating them.
export { COMPLETED_VERB_RE, PRESENT_TENSE_VERB_RE };
