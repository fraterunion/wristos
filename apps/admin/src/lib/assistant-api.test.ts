import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { READ_ACTIONS, WRITE_PREVIEW_ACTIONS } from './assistant-types';
import { createAssistantAction } from './assistant-api';
import { postLoginRoute } from './mobile-routing';

describe('assistant surface contracts', () => {
  it('exposes fourteen reads and seven write-preview actions (REGISTER_SALE is the only executable write)', () => {
    assert.deepEqual(READ_ACTIONS, [
      'GET_LIQUIDITY',
      'GET_MONTHLY_PROFIT',
      'SEARCH_INVENTORY',
      'SEARCH_CLIENT',
      'GET_CLIENT_ACCOUNTS',
      'GET_INVENTORY_AGING',
      'GET_TOP_INVENTORY_CAPITAL',
      'GET_TOP_DEBTORS',
      'GET_RECEIVABLE_SUMMARY',
      'GET_SALES_MARGIN_SUMMARY',
      'GET_PROFIT_BY_BRAND',
      'GET_TOP_SALES',
      'GET_ATTENTION_ITEMS',
      'GET_BUSINESS_SUMMARY',
    ]);
    assert.equal(WRITE_PREVIEW_ACTIONS.length, 7);
    assert.equal(WRITE_PREVIEW_ACTIONS[0], 'REGISTER_SALE');
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
