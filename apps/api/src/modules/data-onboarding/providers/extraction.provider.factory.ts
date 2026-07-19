import { ClaudeExtractionProvider } from './claude-extraction.provider';
import { FakeExtractionProvider } from './fake-extraction.provider';
import type { DocumentExtractionProvider } from './document-extraction.provider.interface';

/**
 * Creates the document extraction provider from environment configuration.
 * Returns null when the feature is disabled — callers must handle this and
 * reject the request with an appropriate error.
 *
 * Fails fast at call time (application startup) if a provider is selected
 * but its required configuration is absent.
 */
export function createExtractionProvider(): DocumentExtractionProvider | null {
  const provider = process.env.DOCUMENT_EXTRACTION_PROVIDER?.toLowerCase().trim();

  if (!provider || provider === 'disabled') return null;

  if (provider === 'claude') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is required when DOCUMENT_EXTRACTION_PROVIDER=claude',
      );
    }
    const model = process.env.ANTHROPIC_MODEL;
    if (!model) {
      throw new Error(
        'ANTHROPIC_MODEL is required when DOCUMENT_EXTRACTION_PROVIDER=claude',
      );
    }
    return new ClaudeExtractionProvider(apiKey, model);
  }

  if (provider === 'fake') {
    // Fake provider is only allowed when NODE_ENV is not production,
    // unless DOCUMENT_EXTRACTION_ALLOW_FAKE_IN_PRODUCTION=true is explicitly set.
    const isProduction = process.env.NODE_ENV === 'production';
    const allowFakeInProd = process.env.DOCUMENT_EXTRACTION_ALLOW_FAKE_IN_PRODUCTION === 'true';
    if (isProduction && !allowFakeInProd) {
      throw new Error(
        'DOCUMENT_EXTRACTION_PROVIDER=fake is not allowed in production. ' +
        'Set DOCUMENT_EXTRACTION_PROVIDER=claude or DOCUMENT_EXTRACTION_ALLOW_FAKE_IN_PRODUCTION=true to override.',
      );
    }
    const scenario = process.env.DOCUMENT_EXTRACTION_FAKE_SCENARIO;
    return new FakeExtractionProvider(undefined, scenario);
  }

  throw new Error(
    `Unknown DOCUMENT_EXTRACTION_PROVIDER: "${provider}". Valid values: claude, fake, disabled`,
  );
}
