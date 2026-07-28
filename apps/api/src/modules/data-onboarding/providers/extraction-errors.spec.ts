import {
  serializeProviderErrorForDiagnostics,
} from './extraction-errors';

describe('serializeProviderErrorForDiagnostics', () => {
  it('serializes Anthropic-style APIError fields including nested cause', () => {
    const nested = Object.assign(new Error('socket hang up'), { name: 'CauseError' });
    const headers = new Headers({
      'request-id': 'req_abc',
      'anthropic-ratelimit-requests-remaining': '49',
    });
    const err = Object.assign(new Error('invalid x-api-key'), {
      name: 'AuthenticationError',
      status: 401,
      type: 'authentication_error',
      requestID: 'req_abc',
      error: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      headers,
      cause: nested,
    });

    const dumped = serializeProviderErrorForDiagnostics(err);

    expect(dumped.kind).toBe('error');
    expect(dumped.name).toBe('AuthenticationError');
    expect(dumped.message).toBe('invalid x-api-key');
    expect(dumped.stack).toEqual(expect.stringContaining('invalid x-api-key'));
    expect(dumped.status).toBe(401);
    expect(dumped.type).toBe('authentication_error');
    expect(dumped.requestID).toBe('req_abc');
    expect(dumped.errorBody).toEqual({
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    });
    expect(dumped.headers).toEqual(
      expect.objectContaining({
        'request-id': 'req_abc',
        'anthropic-ratelimit-requests-remaining': '49',
      }),
    );
    expect(dumped.cause).toEqual(
      expect.objectContaining({
        name: 'CauseError',
        message: 'socket hang up',
      }),
    );
  });

  it('handles non-Error values without throwing', () => {
    expect(serializeProviderErrorForDiagnostics({ foo: 'bar' })).toEqual({
      kind: 'object',
      value: { foo: 'bar' },
    });
    expect(serializeProviderErrorForDiagnostics(null)).toEqual({ kind: 'nullish', value: null });
  });
});
