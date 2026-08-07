/**
 * Optional, gated, LIVE evaluation script (Part 16). This calls the real
 * Claude provider — it costs money and is nondeterministic, so it is never
 * run by `npm test` or CI. It exists purely for manual, human-reviewed
 * calibration of prompt-policy.ts against the dataset in eval/dataset.ts.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... INTENT_ADAPTER_MODEL=claude-... \
 *     npx ts-node -P tsconfig.build.json src/modules/ai/intent-adapter/eval/live-eval.ts
 *
 * This script never asserts pass/fail — it prints a human-readable report
 * for manual review, since live model output is not guaranteed stable
 * across model versions.
 */
/* eslint-disable no-console */
import { IntentAdapterService } from '../intent-adapter.service';
import { ClaudeIntentProvider } from '../providers/claude-intent-provider';
import { decideConfidencePolicy } from '../safety';
import { EVAL_DATASET } from './dataset';

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.INTENT_ADAPTER_MODEL ?? process.env.ANTHROPIC_MODEL;
  if (!apiKey || !model) {
    console.error('Set ANTHROPIC_API_KEY and INTENT_ADAPTER_MODEL (or ANTHROPIC_MODEL) to run the live evaluation.');
    process.exitCode = 1;
    return;
  }

  const service = new IntentAdapterService(new ClaudeIntentProvider(apiKey, model));
  let mismatches = 0;

  for (const evalCase of EVAL_DATASET) {
    const outcome = await service.interpret({
      userText: evalCase.text,
      locale: 'es-MX',
      timezone: 'UTC',
      allowedIntents: [],
      currentDate: '2026-07-15',
      requestTraceId: 'live-eval',
    });

    if (outcome.kind !== 'CANDIDATE') {
      console.log(`[${evalCase.category}] "${evalCase.text}" -> PROVIDER_FAILURE/INVALID_OUTPUT (${outcome.kind})`);
      mismatches += 1;
      continue;
    }

    const { candidate } = outcome;
    const policy = decideConfidencePolicy(candidate);
    const intentMatch = candidate.intent === evalCase.expectedIntent;
    if (!intentMatch) mismatches += 1;

    console.log(
      `[${evalCase.category}] "${evalCase.text}"\n` +
        `  intent: ${candidate.intent} (expected ${evalCase.expectedIntent}) ${intentMatch ? 'OK' : 'MISMATCH'}\n` +
        `  confidence: ${candidate.confidence} | policy: ${policy.action} | latencyMs: ${outcome.latencyMs}\n` +
        `  entities: ${JSON.stringify(candidate.entities)}\n`,
    );
  }

  console.log(`\n${EVAL_DATASET.length - mismatches}/${EVAL_DATASET.length} intents matched expectations. Review mismatches manually — this script does not fail the build.`);
}

void main();
