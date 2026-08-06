import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { READ_ACTIONS, WRITE_PREVIEW_ACTIONS } from './assistant-types';
import { createAssistantAction } from './assistant-api';
import { postLoginRoute } from './mobile-routing';

describe('assistant surface contracts', () => {
  it('exposes exactly five reads and seven non-executing write previews', () => {
    assert.deepEqual(READ_ACTIONS, [
      'GET_LIQUIDITY',
      'GET_MONTHLY_PROFIT',
      'SEARCH_INVENTORY',
      'SEARCH_CLIENT',
      'GET_CLIENT_ACCOUNTS',
    ]);
    assert.equal(WRITE_PREVIEW_ACTIONS.length, 7);
  });

  it('keeps desktop dashboard default and prefers assistant on mobile', () => {
    assert.equal(postLoginRoute(false), '/dashboard');
    assert.equal(postLoginRoute(true), '/assistant');
  });

  it('reuses one durable client request ID for safe retry', () => {
    const action = createAssistantAction({ intent: 'GET_LIQUIDITY', entities: {} });
    assert.ok(action.clientRequestId.length > 10);
    assert.equal(action.request.clientRequestId, action.clientRequestId);
    assert.equal(action.execute, action.retry);
  });
});
