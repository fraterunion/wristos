import { Injectable } from '@nestjs/common';
import { normalizeMessage } from './text-normalize';
import { isQuestion } from './guards/question-guard';
import { isNegatedBeforeIndex } from './guards/negation-guard';
import { isHypotheticalBeforeIndex } from './guards/tense-guard';
import {
  CapabilityLexicon,
  RouterEntities,
  RouterRawCandidateOutput,
  RouterVerdict,
  RoutableCapability,
} from './operational-intent-router.types';
import { saleLexicon } from './lexicon/sale.lexicon';
import { purchaseLexicon } from './lexicon/purchase.lexicon';
import { expenseLexicon } from './lexicon/expense.lexicon';
import { receivablePaymentLexicon } from './lexicon/receivable-payment.lexicon';
import { payablePaymentLexicon } from './lexicon/payable-payment.lexicon';
import { treasuryTransferLexicon } from './lexicon/treasury-transfer.lexicon';
import { capitalContributionLexicon } from './lexicon/capital-contribution.lexicon';
import { capitalDistributionLexicon } from './lexicon/capital-distribution.lexicon';
import { createReceivableLexicon } from './lexicon/create-receivable.lexicon';
import { createPayableLexicon } from './lexicon/create-payable.lexicon';

interface SurvivingMatch {
  capability: RoutableCapability;
  entities: RouterEntities;
  evidence: string[];
  sufficientEvidence: boolean;
}

/**
 * Tiered precedence, not a flat list: sale/purchase sentences routinely
 * embed payment language as a sub-clause ("...y me pagó por Bancos"), which
 * would otherwise also fire REGISTER_RECEIVABLE_PAYMENT's "me pagó" pattern
 * on the SAME message. Per the task's own composition rule (§23), a rich
 * one-turn sale is ONE operation, never split — so sale/purchase always take
 * precedence over the standalone payment-collection capabilities.
 *
 * Tiers are a PREFERENCE order, not a stop-at-first-match order: a tier only
 * wins outright when it produces a genuine HIGH-confidence match. A tier
 * that only produces an insufficient-evidence match (e.g. EXPENSE's weak
 * "pagué" verb firing as a substring of PAYABLE_PAYMENT's "le pagué") does
 * NOT block a later tier's clean HIGH match — every tier is scanned first;
 * AMBIGUOUS_OPERATION is only returned if NO tier anywhere produced a HIGH
 * match, using whatever weak matches were found along the way.
 */
const PRIORITY_TIERS: readonly (readonly CapabilityLexicon[])[] = [
  [saleLexicon, purchaseLexicon],
  [
    expenseLexicon,
    treasuryTransferLexicon,
    capitalContributionLexicon,
    capitalDistributionLexicon,
    createReceivableLexicon,
    createPayableLexicon,
  ],
  [receivablePaymentLexicon, payablePaymentLexicon],
];

@Injectable()
export class OperationalIntentRouterService {
  route(rawText: string): RouterVerdict {
    const { raw, folded } = normalizeMessage(rawText);

    if (isQuestion(folded)) {
      return { kind: 'NO_OPERATION_MATCH' };
    }

    const weakMatches: SurvivingMatch[] = [];

    for (const tier of PRIORITY_TIERS) {
      const survivors = this.runTier(tier, folded, raw);
      if (survivors.length === 0) continue;

      const highConfidence = survivors.filter((m) => m.sufficientEvidence);
      if (highConfidence.length === 1) {
        const winner = highConfidence[0];
        return {
          kind: 'HIGH_CONFIDENCE_OPERATION',
          capability: winner.capability,
          entities: winner.entities,
          evidence: winner.evidence,
        };
      }
      if (highConfidence.length > 1) {
        // Genuine same-tier capability conflict — never guess between them.
        return {
          kind: 'AMBIGUOUS_OPERATION',
          reason: 'multiple_high_confidence_capabilities',
          candidateCapabilities: highConfidence.map((m) => m.capability),
        };
      }
      // No HIGH match in this tier — remember the weak ones, but keep
      // scanning later tiers for a genuine match before giving up.
      weakMatches.push(...survivors);
    }

    if (weakMatches.length > 0) {
      return {
        kind: 'AMBIGUOUS_OPERATION',
        reason: 'insufficient_evidence',
        candidateCapabilities: weakMatches.map((m) => m.capability),
      };
    }

    return { kind: 'NO_OPERATION_MATCH' };
  }

  private runTier(tier: readonly CapabilityLexicon[], folded: string, raw: string): SurvivingMatch[] {
    const survivors: SurvivingMatch[] = [];
    for (const lexicon of tier) {
      const result = lexicon.detect(folded, raw);
      if (!result) continue;

      if (isNegatedBeforeIndex(folded, result.verbMatch.index)) continue;
      if (isHypotheticalBeforeIndex(folded, result.verbMatch.index)) continue;

      survivors.push({
        capability: lexicon.capability,
        entities: result.entities,
        evidence: result.evidence,
        sufficientEvidence: result.sufficientEvidence,
      });
    }
    return survivors;
  }
}

/**
 * Converts a HIGH_CONFIDENCE_OPERATION verdict into the raw candidate shape
 * IntentAdapterService.interpretDeterministic() expects — the same shape a
 * successful Claude tool-call produces (see intent-adapter/intent-schema.ts's
 * rawIntentCandidateSchema), so it goes through the identical validation gate.
 * Returns null for any other verdict kind (nothing to build).
 */
export function toRawCandidateOutput(verdict: RouterVerdict): RouterRawCandidateOutput | null {
  if (verdict.kind !== 'HIGH_CONFIDENCE_OPERATION') return null;
  return {
    intent: verdict.capability,
    entities: verdict.entities,
    missingEntities: [],
    ambiguities: [],
    confidence: 'HIGH',
    language: 'es',
  };
}
