import { IntentAdapterProvider } from '../intent-adapter-provider';
import { ClaudeIntentProvider } from './claude-intent-provider';
import { FakeIntentProvider } from './fake-intent-provider';

/**
 * Selects the intent-adapter provider from environment configuration.
 * Mirrors data-onboarding's createExtractionProvider(): explicit,
 * fail-fast, no implicit fallback chain (Part 2).
 */
export function createIntentAdapterProvider(): IntentAdapterProvider {
  const provider = process.env.INTENT_ADAPTER_PROVIDER?.toLowerCase().trim();

  if (!provider || provider === 'fake') {
    const isProduction = process.env.NODE_ENV === 'production';
    const allowFakeInProd = process.env.INTENT_ADAPTER_ALLOW_FAKE_IN_PRODUCTION === 'true';
    if (isProduction && !allowFakeInProd) {
      throw new Error(
        'INTENT_ADAPTER_PROVIDER=fake is not allowed in production. ' +
          'Set INTENT_ADAPTER_PROVIDER=claude or INTENT_ADAPTER_ALLOW_FAKE_IN_PRODUCTION=true to override.',
      );
    }
    return new FakeIntentProvider();
  }

  if (provider === 'claude') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required when INTENT_ADAPTER_PROVIDER=claude');
    const model = process.env.INTENT_ADAPTER_MODEL ?? process.env.ANTHROPIC_MODEL;
    if (!model) throw new Error('INTENT_ADAPTER_MODEL (or ANTHROPIC_MODEL) is required when INTENT_ADAPTER_PROVIDER=claude');
    return new ClaudeIntentProvider(apiKey, model);
  }

  if (provider === 'disabled') {
    throw new Error('INTENT_ADAPTER_PROVIDER=disabled — the natural-language endpoint is not available. Set INTENT_ADAPTER_PROVIDER=claude or fake.');
  }

  throw new Error(`Unknown INTENT_ADAPTER_PROVIDER: "${provider}". Valid values: claude, fake, disabled`);
}
