import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildIntentCandidate, IntentCandidateFailureReason, StructuredIntentCandidate } from './intent-candidate';
import { IntentAdapterProvider, IntentInterpretationInput, IntentProviderFailureType } from './intent-adapter-provider';
import { assertWithinTextLimit, sanitizeConversationContext, MAX_USER_TEXT_LENGTH } from './safety';
import { INTENT_SCHEMA_VERSION } from './prompt-policy';

export const INTENT_ADAPTER_PROVIDER = Symbol('INTENT_ADAPTER_PROVIDER');

interface OutcomeMeta {
  provider: string;
  model: string;
  latencyMs: number;
  schemaVersion: string;
  tokenUsage?: { inputTokens?: number; outputTokens?: number };
}

export type IntentAdapterOutcome =
  | ({ kind: 'CANDIDATE'; candidate: StructuredIntentCandidate } & OutcomeMeta)
  | ({ kind: 'PROVIDER_FAILURE'; failureType: IntentProviderFailureType; detail?: string } & OutcomeMeta)
  | ({ kind: 'INVALID_OUTPUT'; reason: IntentCandidateFailureReason; issueCount: number; issuePaths: string[] } & OutcomeMeta);

/**
 * The single entry point for turning natural-language text into a validated
 * StructuredIntentCandidate. This service never calls a tool, a capability
 * binding, a domain service, or Prisma — its entire surface is:
 * provider.interpret() -> schema validation -> normalization.
 */
@Injectable()
export class IntentAdapterService {
  private readonly logger = new Logger(IntentAdapterService.name);

  constructor(@Inject(INTENT_ADAPTER_PROVIDER) private readonly provider: IntentAdapterProvider) {}

  async interpret(rawInput: IntentInterpretationInput): Promise<IntentAdapterOutcome> {
    assertWithinTextLimit(rawInput.userText);
    if (rawInput.userText.length > MAX_USER_TEXT_LENGTH) {
      // Defense in depth — the DTO already enforces this at the HTTP boundary.
      throw new Error(`userText exceeds ${MAX_USER_TEXT_LENGTH} characters`);
    }

    const input: IntentInterpretationInput = {
      ...rawInput,
      conversationContext: sanitizeConversationContext(rawInput.conversationContext),
    };

    const started = Date.now();
    const raw = await this.provider.interpret(input);
    const latencyMs = Date.now() - started;
    const meta: OutcomeMeta = {
      provider: raw.provider,
      model: raw.model,
      latencyMs,
      schemaVersion: INTENT_SCHEMA_VERSION,
      tokenUsage: raw.tokenUsage,
    };

    if (raw.failure) {
      this.logger.warn(`[intent-adapter] provider failure type=${raw.failure.type} provider=${raw.provider} model=${raw.model} latencyMs=${latencyMs}`);
      return { kind: 'PROVIDER_FAILURE', failureType: raw.failure.type, detail: raw.failure.detail, ...meta };
    }

    const result = buildIntentCandidate(raw.output, rawInput.currentDate);
    if (result.kind === 'FAILED') {
      this.logger.warn(`[intent-adapter] invalid output reason=${result.reason} issueCount=${result.issueCount} provider=${raw.provider}`);
      return { kind: 'INVALID_OUTPUT', reason: result.reason, issueCount: result.issueCount, issuePaths: result.issuePaths, ...meta };
    }

    return { kind: 'CANDIDATE', candidate: result.candidate, ...meta };
  }
}
