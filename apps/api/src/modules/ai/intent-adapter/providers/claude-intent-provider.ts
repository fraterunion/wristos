import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  IntentAdapterProvider,
  IntentInterpretationInput,
  IntentInterpretationRawResult,
  IntentProviderFailureType,
} from '../intent-adapter-provider';
import { buildSystemPrompt, buildUserPrompt } from '../prompt-policy';
import { rawIntentCandidateSchema } from '../intent-schema';

const CLASSIFY_INTENT_TOOL_NAME = 'classify_intent';

const CLASSIFY_INTENT_TOOL: Anthropic.Tool = {
  name: CLASSIFY_INTENT_TOOL_NAME,
  description: 'Classifies one operator message into a structured intent candidate. This is the ONLY allowed response — never respond with plain text.',
  input_schema: z.toJSONSchema(rawIntentCandidateSchema) as Anthropic.Tool.InputSchema,
};

function resolveTimeoutMs(): number {
  const raw = process.env.INTENT_ADAPTER_TIMEOUT_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12_000;
}

function resolveMaxTokens(): number {
  const raw = process.env.INTENT_ADAPTER_MAX_TOKENS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024;
}

/** Recursively strips explicit nulls before schema validation (models emit null for omitted optionals). */
function stripNullsDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => item !== null).map(stripNullsDeep);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== null) result[key] = stripNullsDeep(item);
    }
    return result;
  }
  return value;
}

function classifyFailure(err: unknown): { type: IntentProviderFailureType; detail?: string } {
  const status = (err as { status?: number } | undefined)?.status;
  const isTimeout =
    (err instanceof Error && (err.name === 'APIConnectionTimeoutError' || /timed? ?out/i.test(err.message))) || status === 408;
  if (isTimeout) return { type: 'TIMEOUT', detail: 'provider request timed out' };
  if (status === 429) return { type: 'RATE_LIMITED', detail: 'provider rate limit' };
  if (typeof status === 'number' && status >= 500) return { type: 'UNAVAILABLE', detail: `provider ${status}` };
  return { type: 'UNKNOWN_ERROR', detail: 'provider call failed' };
}

/**
 * Claude-backed IntentAdapterProvider. Uses a forced tool call
 * (tool_choice: {type:'tool', name: classify_intent}) so the model can only
 * ever respond with one structured object — never free text, never a
 * different tool. The Zod re-validation in intent-candidate.ts is still the
 * actual trust boundary; this is defense-in-depth, matching the pattern
 * already used by ClaudeExtractionProvider.
 */
export class ClaudeIntentProvider implements IntentAdapterProvider {
  readonly providerName = 'claude';

  private readonly logger = new Logger(ClaudeIntentProvider.name);
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly timeoutMs = resolveTimeoutMs();
  private readonly maxTokens = resolveMaxTokens();

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async interpret(input: IntentInterpretationInput): Promise<IntentInterpretationRawResult> {
    const startedAt = Date.now();
    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system: buildSystemPrompt(),
          tools: [CLASSIFY_INTENT_TOOL],
          tool_choice: { type: 'tool', name: CLASSIFY_INTENT_TOOL_NAME },
          messages: [{ role: 'user', content: buildUserPrompt(input) }],
        },
        { timeout: this.timeoutMs, maxRetries: 0 },
      );

      const latencyMs = Date.now() - startedAt;

      if (response.stop_reason === 'max_tokens') {
        return {
          output: null,
          provider: this.providerName,
          model: this.model,
          latencyMs,
          failure: { type: 'INVALID_OUTPUT', detail: 'output truncated at max_tokens' },
        };
      }

      const toolBlock = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === CLASSIFY_INTENT_TOOL_NAME,
      );
      if (!toolBlock) {
        return {
          output: null,
          provider: this.providerName,
          model: this.model,
          latencyMs,
          failure: { type: 'INVALID_OUTPUT', detail: 'no classify_intent tool call in response' },
        };
      }

      return {
        output: stripNullsDeep(toolBlock.input),
        provider: this.providerName,
        model: this.model,
        latencyMs,
        tokenUsage: { inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens },
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      // Full diagnostics stay server-side in logs only — never returned/persisted.
      this.logger.error(`[intent-adapter] provider call failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      const failure = classifyFailure(err);
      return { output: null, provider: this.providerName, model: this.model, latencyMs, failure };
    }
  }
}
