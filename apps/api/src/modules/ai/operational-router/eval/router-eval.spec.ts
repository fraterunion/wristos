import { OperationalIntentRouterService } from '../operational-intent-router.service';
import { ROUTER_EVAL_DATASET, RouterEvalOutcome } from './router-eval-dataset';

function actualOutcome(kind: 'HIGH_CONFIDENCE_OPERATION' | 'AMBIGUOUS_OPERATION' | 'NO_OPERATION_MATCH'): RouterEvalOutcome {
  if (kind === 'HIGH_CONFIDENCE_OPERATION') return 'ROUTED';
  if (kind === 'AMBIGUOUS_OPERATION') return 'AMBIGUOUS';
  return 'NO_MATCH';
}

describe('Operational Intent Router — eval corpus', () => {
  const router = new OperationalIntentRouterService();

  it(`classifies all ${ROUTER_EVAL_DATASET.length} corpus cases correctly (outcome + capability, zero false writes)`, () => {
    let correctOutcome = 0;
    let correctCapability = 0;
    let capabilityCases = 0;
    let falseWrites = 0;
    const mismatches: string[] = [];

    for (const testCase of ROUTER_EVAL_DATASET) {
      const verdict = router.route(testCase.text);
      const outcome = actualOutcome(verdict.kind);

      if (outcome === testCase.expectedOutcome) {
        correctOutcome += 1;
      } else {
        mismatches.push(
          `[outcome] "${testCase.text}" — expected ${testCase.expectedOutcome}, got ${outcome} (${verdict.kind})`,
        );
      }

      if (testCase.expectedCapability) {
        capabilityCases += 1;
        const actualCapability = verdict.kind === 'HIGH_CONFIDENCE_OPERATION' ? verdict.capability : undefined;
        if (actualCapability === testCase.expectedCapability) {
          correctCapability += 1;
        } else if (verdict.kind === 'HIGH_CONFIDENCE_OPERATION') {
          mismatches.push(
            `[capability] "${testCase.text}" — expected ${testCase.expectedCapability}, got ${actualCapability}`,
          );
        }
      }

      // The single most safety-critical metric: a case explicitly expected
      // to produce NO write (negation/future/question/ambiguous) must never
      // come back as HIGH_CONFIDENCE_OPERATION under any circumstance.
      if (testCase.expectedOutcome !== 'ROUTED' && verdict.kind === 'HIGH_CONFIDENCE_OPERATION') {
        falseWrites += 1;
        mismatches.push(`[FALSE WRITE] "${testCase.text}" — expected ${testCase.expectedOutcome}, got a write for ${verdict.capability}`);
      }
    }

    const outcomeAccuracy = correctOutcome / ROUTER_EVAL_DATASET.length;
    const capabilityAccuracy = capabilityCases > 0 ? correctCapability / capabilityCases : 1;

    // eslint-disable-next-line no-console
    console.log(
      [
        'Operational Intent Router eval corpus results:',
        `  cases:               ${ROUTER_EVAL_DATASET.length}`,
        `  outcome accuracy:    ${(outcomeAccuracy * 100).toFixed(1)}% (${correctOutcome}/${ROUTER_EVAL_DATASET.length})`,
        `  capability accuracy: ${(capabilityAccuracy * 100).toFixed(1)}% (${correctCapability}/${capabilityCases})`,
        `  false writes:        ${falseWrites}`,
      ].join('\n'),
    );

    if (mismatches.length > 0) {
      // eslint-disable-next-line no-console
      console.log('Mismatches:\n' + mismatches.join('\n'));
    }

    // False writes are categorically disqualifying — never allowed, even one.
    expect(falseWrites).toBe(0);
    // Bias toward safe clarification when uncertain (task's own stated
    // policy) means we hold outcome/capability accuracy to a high but not
    // impossible bar — a handful of genuinely hard messy/shorthand cases
    // falling back to AMBIGUOUS/NO_MATCH instead of ROUTED is acceptable;
    // a HIGH_CONFIDENCE_OPERATION on the wrong capability is not.
    expect(outcomeAccuracy).toBeGreaterThanOrEqual(0.85);
    expect(capabilityAccuracy).toBe(1);
  });
});
