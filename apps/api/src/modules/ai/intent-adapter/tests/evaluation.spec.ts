import { IntentAdapterService } from '../intent-adapter.service';
import { FakeIntentProvider } from '../providers/fake-intent-provider';
import { decideConfidencePolicy } from '../safety';
import { EVAL_DATASET } from '../eval/dataset';

/**
 * Deterministic contract evaluation (Part 16/17) run against FakeIntentProvider
 * — a fixed heuristic, never a live model — so this is fully reproducible in
 * CI. It exercises the whole adapter pipeline (schema validation,
 * normalization, confidence policy) the same way production traffic will,
 * without any network call or nondeterminism. See eval/live-eval.ts for the
 * optional, gated, real-Claude counterpart (never run in CI).
 */
describe('evaluation dataset: deterministic adapter-pipeline contract', () => {
  const service = new IntentAdapterService(new FakeIntentProvider());

  it.each(EVAL_DATASET.map((evalCase) => [evalCase.category, evalCase.text, evalCase] as const))(
    '[%s] "%s"',
    async (_category, _text, evalCase) => {
      const outcome = await service.interpret({
        userText: evalCase.text,
        locale: 'es-MX',
        timezone: 'UTC',
        allowedIntents: [],
        currentDate: '2026-07-15',
        requestTraceId: 'eval',
      });

      expect(outcome.kind).toBe('CANDIDATE');
      if (outcome.kind !== 'CANDIDATE') return;
      const { candidate } = outcome;

      expect(candidate.intent).toBe(evalCase.expectedIntent);
      expect(evalCase.allowedConfidence).toContain(candidate.confidence);

      for (const key of evalCase.expectedEntityKeys ?? []) {
        expect(candidate.entities).toHaveProperty(key);
      }
      for (const field of evalCase.expectedMissingIncludes ?? []) {
        expect(candidate.missingEntities).toContain(field);
      }

      // Write intents may never carry a fabricated *Id field.
      if (candidate.isWriteIntent) {
        for (const key of Object.keys(candidate.entities)) {
          expect(key.endsWith('Id')).toBe(false);
        }
      }

      const policy = decideConfidencePolicy(candidate);
      expect(policy.action === 'PROCEED').toBe(evalCase.mayProceedToOrchestrator);

      if (evalCase.executionMustBeImpossible) {
        // Even when PROCEED, a write candidate never carries the *Id fields
        // the planner requires for READY_FOR_CONFIRMATION -> it can only
        // ever reach NEEDS_CLARIFICATION, never execute.
        if (policy.action === 'PROCEED' && candidate.isWriteIntent) {
          expect(Object.keys(candidate.entities).some((key) => key.endsWith('Id'))).toBe(false);
        }
      }
    },
  );

  it('every ADVERSARIAL case resolves to UNKNOWN and never to a real business intent', () => {
    const adversarial = EVAL_DATASET.filter((c) => c.category === 'ADVERSARIAL');
    expect(adversarial.length).toBeGreaterThan(0);
    for (const evalCase of adversarial) expect(evalCase.expectedIntent).toBe('UNKNOWN');
  });

  it('every WRITE_DETECTION_ONLY case is flagged executionMustBeImpossible', () => {
    const writes = EVAL_DATASET.filter((c) => c.category === 'WRITE_DETECTION_ONLY');
    expect(writes.length).toBeGreaterThan(0);
    for (const evalCase of writes) expect(evalCase.executionMustBeImpossible).toBe(true);
  });
});
