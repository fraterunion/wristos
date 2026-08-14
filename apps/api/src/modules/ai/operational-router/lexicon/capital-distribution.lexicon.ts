import { afterSpan, captureAfterMarker, PERSON_STOP_MARKERS_RE } from '../extraction/phrase-segments';
import { findFirstMoneyMention } from '../extraction/money-shorthand';
import { detectCanonicalAccount, toCapitalAccount } from '../extraction/account-alias';
import { CapabilityLexicon, LexiconMatchResult, RouterEntities, VerbMatch } from '../operational-intent-router.types';

/**
 * REGISTER_CAPITAL_DISTRIBUTION — "le distribuí"/"distribución de
 * utilidad"/"le pagamos utilidad"/"retiró utilidad"/"reparto de utilidad".
 * Investor may precede the verb ("César retiró utilidad") or follow it via
 * "a" ("le distribuí a César") — both are tried.
 */
const DISTRIBUTION_VERB_RE = /\b(le distribui|distribucion de utilidad|le pagamos utilidad|retiro utilidad|reparto de utilidad)\b/;

const INVESTOR_AFTER_MARKER_RE = /\ba\b|\bpara\b/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const capitalDistributionLexicon: CapabilityLexicon = {
  capability: 'REGISTER_CAPITAL_DISTRIBUTION',
  detect(folded: string, raw: string): LexiconMatchResult | null {
    const verbExec = DISTRIBUTION_VERB_RE.exec(folded);
    if (!verbExec) return null;

    const verbMatch: VerbMatch = { index: verbExec.index, matchedText: verbExec[0] };
    const evidence: string[] = [`verb:${verbExec[0]}`];
    const entities: RouterEntities = { paidAt: todayIso() };

    const investorBefore = raw.slice(0, verbExec.index).trim();
    const afterVerbIndex = verbExec.index + verbExec[0].length;
    // Tracks the furthest-right index the investor's name span consumed, so
    // the account-alias scan below never re-reads it (an investor named
    // "César" must never be misread as the CESAR treasury account).
    let nameSpanEnd = afterVerbIndex;
    if (investorBefore) {
      entities.investorQuery = investorBefore;
      evidence.push(`investorQuery:${investorBefore}`);
    } else {
      const investorSpan = captureAfterMarker(raw, folded, INVESTOR_AFTER_MARKER_RE, afterVerbIndex, PERSON_STOP_MARKERS_RE);
      if (investorSpan) {
        entities.investorQuery = investorSpan.text;
        evidence.push(`investorQuery:${investorSpan.text}`);
        nameSpanEnd = afterSpan(nameSpanEnd, investorSpan);
      }
    }

    const money = findFirstMoneyMention(folded.slice(afterVerbIndex));
    if (money) {
      entities.amount = money.amount;
      evidence.push(`amount:${money.amount}`);
      // NOT a router-invented default: register-capital-distribution.binding.ts's
      // receipt hardcodes `currency: 'MXN'` unconditionally — capital
      // distributions are canonically, always MXN by pre-existing product
      // design. `currency` is also absent from this capability's
      // planner-required list (business-actions.ts). Audited 2026-08 per
      // hardening review — see docs/ai/OPERATIONAL_INTENT_ROUTER.md.
      entities.currency = 'MXN';
    }

    // Scoped past the investor's own name span — see capital-contribution
    // .lexicon.ts for why (investor names can collide with the CESAR
    // account alias otherwise); here the investor may be post-verbal, so
    // afterVerbIndex alone isn't enough — nameSpanEnd also accounts for that.
    const account = detectCanonicalAccount(folded.slice(nameSpanEnd));
    if (account) {
      entities.account = toCapitalAccount(account);
      evidence.push(`account:${entities.account}`);
    }

    const sufficientEvidence = Boolean(entities.investorQuery) && Boolean(entities.amount);
    return { verbMatch, entities, sufficientEvidence, evidence };
  },
};

export { DISTRIBUTION_VERB_RE };
