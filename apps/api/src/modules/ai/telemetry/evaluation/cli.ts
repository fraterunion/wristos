#!/usr/bin/env node
/**
 * CLI entry for `pnpm assistant:evaluate`.
 */
import { runAssistantEvaluation } from './evaluate-runner';

async function main() {
  try {
    const report = await runAssistantEvaluation();
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          provider: report.provider,
          accuracy: report.accuracy,
          clarificationRate: report.clarificationRate,
          unknownRate: report.unknownRate,
          providerFailureRate: report.providerFailureRate,
          avgLatencyMs: report.avgLatencyMs,
          mismatches: report.mismatches.length,
          regressions: report.regressions ?? null,
        },
        null,
        2,
      ),
    );
    if (report.provider === 'fake' && report.accuracy < 0.7) {
      process.exitCode = 1;
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

void main();
