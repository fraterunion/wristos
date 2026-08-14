import { captureAfterMarker } from '../extraction/phrase-segments';
import { findFirstMoneyMention } from '../extraction/money-shorthand';
import { detectCanonicalAccount, toCanonicalAccount } from '../extraction/account-alias';
import { foldDiacritics } from '../text-normalize';
import { CapabilityLexicon, LexiconMatchResult, RouterEntities, VerbMatch } from '../operational-intent-router.types';

/**
 * REGISTER_TREASURY_TRANSFER — "pasa"/"pásale"/"mueve"/"transfiere"/"manda".
 * Source and destination can appear in either order ("de X a Y" or "a Y
 * desde X"), so source/destination are each captured independently via their
 * own marker ("de"/"desde" vs "a") rather than assuming a fixed sequence.
 */
const TRANSFER_VERB_RE = /\b(pasale|pasa|mueve|transfiere|manda)\b/;

const SOURCE_MARKER_RE = /\bdesde\b|\bde\b/;
const DESTINATION_MARKER_RE = /\ba\b/;

export const treasuryTransferLexicon: CapabilityLexicon = {
  capability: 'REGISTER_TREASURY_TRANSFER',
  detect(folded: string, raw: string): LexiconMatchResult | null {
    const verbExec = TRANSFER_VERB_RE.exec(folded);
    if (!verbExec) return null;

    const verbMatch: VerbMatch = { index: verbExec.index, matchedText: verbExec[0] };
    const evidence: string[] = [`verb:${verbExec[0]}`];
    const entities: RouterEntities = {};

    const afterVerbIndex = verbExec.index + verbExec[0].length;

    const money = findFirstMoneyMention(folded.slice(afterVerbIndex));
    if (money) {
      entities.amount = money.amount;
      evidence.push(`amount:${money.amount}`);
    }
    // NOT a router-invented default: register-treasury-transfer.binding.ts's
    // receipt hardcodes `currency: 'MXN'` unconditionally (not `?? 'MXN'`) —
    // treasury transfers are canonically, always MXN by pre-existing product
    // design, verified in the binding itself. `currency` is also absent from
    // this capability's planner-required list (business-actions.ts), so the
    // planner never asks about it either way. Audited 2026-08 per hardening
    // review — see docs/ai/OPERATIONAL_INTENT_ROUTER.md.
    entities.currency = 'MXN';

    const sourceSpan = captureAfterMarker(raw, folded, SOURCE_MARKER_RE, afterVerbIndex);
    if (sourceSpan) {
      const sourceAccount = detectCanonicalAccount(foldDiacritics(sourceSpan.text).toLowerCase());
      if (sourceAccount) {
        entities.sourceAccount = toCanonicalAccount(sourceAccount);
        evidence.push(`sourceAccount:${entities.sourceAccount}`);
      }
    }

    const destinationSpan = captureAfterMarker(raw, folded, DESTINATION_MARKER_RE, afterVerbIndex);
    if (destinationSpan) {
      const destinationAccount = detectCanonicalAccount(foldDiacritics(destinationSpan.text).toLowerCase());
      if (destinationAccount) {
        entities.destinationAccount = toCanonicalAccount(destinationAccount);
        evidence.push(`destinationAccount:${entities.destinationAccount}`);
      }
    }

    const sufficientEvidence =
      Boolean(entities.amount) && Boolean(entities.sourceAccount) && Boolean(entities.destinationAccount);
    return { verbMatch, entities, sufficientEvidence, evidence };
  },
};

export { TRANSFER_VERB_RE };
