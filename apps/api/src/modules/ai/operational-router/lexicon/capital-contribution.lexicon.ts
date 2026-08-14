import { findFirstMoneyMention } from '../extraction/money-shorthand';
import { detectCanonicalAccount, toCapitalAccount } from '../extraction/account-alias';
import { CapabilityLexicon, LexiconMatchResult, RouterEntities, VerbMatch } from '../operational-intent-router.types';

/**
 * REGISTER_CAPITAL_CONTRIBUTION — "aportó"/"metió capital"/"puso capital"/
 * "hizo una aportación"/"ingresó capital". The investor is the SUBJECT,
 * stated before the verb: "César aportó 300 mil." Account is required by
 * the planner (business-actions.ts) but frequently unstated in casual
 * speech — when absent, the router still routes HIGH confidence and lets
 * the planner ask for just that one field, per the task's own example.
 */
const CONTRIBUTION_VERB_RE = /\b(aporto|metio capital|puso capital|hizo una aportacion|ingreso capital)\b/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const capitalContributionLexicon: CapabilityLexicon = {
  capability: 'REGISTER_CAPITAL_CONTRIBUTION',
  detect(folded: string, raw: string): LexiconMatchResult | null {
    const verbExec = CONTRIBUTION_VERB_RE.exec(folded);
    if (!verbExec) return null;

    const verbMatch: VerbMatch = { index: verbExec.index, matchedText: verbExec[0] };
    const evidence: string[] = [`verb:${verbExec[0]}`];
    const entities: RouterEntities = { contributedAt: todayIso() };

    const investorRaw = raw.slice(0, verbExec.index).trim();
    if (investorRaw) {
      entities.investorQuery = investorRaw;
      evidence.push(`investorQuery:${investorRaw}`);
    }

    const afterVerbIndex = verbExec.index + verbExec[0].length;
    const money = findFirstMoneyMention(folded.slice(afterVerbIndex));
    if (money) {
      entities.amount = money.amount;
      evidence.push(`amount:${money.amount}`);
      // NOT a router-invented default: register-capital-contribution.binding.ts's
      // receipt hardcodes `currency: 'MXN'` unconditionally — capital
      // contributions are canonically, always MXN by pre-existing product
      // design. `currency` is also absent from this capability's
      // planner-required list (business-actions.ts). Audited 2026-08 per
      // hardening review — see docs/ai/OPERATIONAL_INTENT_ROUTER.md.
      entities.currency = 'MXN';
    }

    // Scoped to after the verb — the investor's own name can otherwise
    // collide with the "Cuenta César" account alias (an investor literally
    // named César must never be misread as the CESAR treasury account).
    const account = detectCanonicalAccount(folded.slice(afterVerbIndex));
    if (account) {
      entities.account = toCapitalAccount(account);
      evidence.push(`account:${entities.account}`);
    }

    const sufficientEvidence = Boolean(entities.investorQuery) && Boolean(entities.amount);
    return { verbMatch, entities, sufficientEvidence, evidence };
  },
};

export { CONTRIBUTION_VERB_RE };
