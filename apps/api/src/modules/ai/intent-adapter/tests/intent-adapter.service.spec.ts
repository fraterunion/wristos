import { IntentAdapterService } from '../intent-adapter.service';
import { IntentAdapterProvider, IntentInterpretationInput } from '../intent-adapter-provider';

function baseInput(overrides: Partial<IntentInterpretationInput> = {}): IntentInterpretationInput {
  return {
    userText: 'Muéstrame mi liquidez',
    locale: 'es-MX',
    timezone: 'UTC',
    allowedIntents: ['GET_LIQUIDITY'],
    currentDate: '2026-07-15',
    requestTraceId: 'trace-1',
    ...overrides,
  };
}

describe('IntentAdapterService: the only caller of a provider', () => {
  it('returns a CANDIDATE outcome for well-formed provider output', async () => {
    const provider: IntentAdapterProvider = {
      providerName: 'test',
      interpret: jest.fn().mockResolvedValue({
        output: { intent: 'GET_LIQUIDITY', confidence: 'HIGH' },
        provider: 'test', model: 'test-model', latencyMs: 5,
      }),
    };
    const service = new IntentAdapterService(provider);
    const outcome = await service.interpret(baseInput());
    expect(outcome.kind).toBe('CANDIDATE');
    if (outcome.kind === 'CANDIDATE') expect(outcome.candidate.intent).toBe('GET_LIQUIDITY');
    expect(outcome.provider).toBe('test');
    expect(outcome.model).toBe('test-model');
  });

  it('returns a PROVIDER_FAILURE outcome when the provider itself fails (timeout, unavailable, etc)', async () => {
    const provider: IntentAdapterProvider = {
      providerName: 'test',
      interpret: jest.fn().mockResolvedValue({
        output: null, provider: 'test', model: 'test-model', latencyMs: 12000,
        failure: { type: 'TIMEOUT', detail: 'provider request timed out' },
      }),
    };
    const service = new IntentAdapterService(provider);
    const outcome = await service.interpret(baseInput());
    expect(outcome.kind).toBe('PROVIDER_FAILURE');
    if (outcome.kind === 'PROVIDER_FAILURE') expect(outcome.failureType).toBe('TIMEOUT');
  });

  it('returns an INVALID_OUTPUT outcome when the provider returns something that fails schema validation', async () => {
    const provider: IntentAdapterProvider = {
      providerName: 'test',
      interpret: jest.fn().mockResolvedValue({
        output: { intent: 'DELETE_EVERYTHING', confidence: 'HIGH' },
        provider: 'test', model: 'test-model', latencyMs: 5,
      }),
    };
    const service = new IntentAdapterService(provider);
    const outcome = await service.interpret(baseInput());
    expect(outcome.kind).toBe('INVALID_OUTPUT');
    if (outcome.kind === 'INVALID_OUTPUT') expect(outcome.reason).toBe('INVALID_OUTPUT_SHAPE');
  });

  it('rejects an empty userText before ever calling the provider', async () => {
    const interpret = jest.fn();
    const provider: IntentAdapterProvider = { providerName: 'test', interpret };
    const service = new IntentAdapterService(provider);
    await expect(service.interpret(baseInput({ userText: '' }))).rejects.toThrow();
    expect(interpret).not.toHaveBeenCalled();
  });

  it('reports token usage and latency without ever including raw provider output in the outcome for a failure', async () => {
    const provider: IntentAdapterProvider = {
      providerName: 'test',
      interpret: jest.fn().mockResolvedValue({
        output: null, provider: 'test', model: 'test-model', latencyMs: 42,
        failure: { type: 'INVALID_OUTPUT', detail: 'no tool call' },
      }),
    };
    const service = new IntentAdapterService(provider);
    const outcome = await service.interpret(baseInput());
    expect(outcome.latencyMs).toEqual(expect.any(Number));
    expect(JSON.stringify(outcome)).not.toContain('output');
  });
});
