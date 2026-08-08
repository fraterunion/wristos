import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildClientUpdatePatch,
  clientToEditBaseline,
  isClientStaleError,
} from './crm-client-edit-patch';

const baseline = clientToEditBaseline({
  updatedAt: '2026-08-08T12:00:00.000Z',
  name: 'José',
  email: 'a@x.com',
  phone: '+525511111111',
  notes: 'OLD',
  tags: ['VIP'],
  budgetRange: '8k-12k',
});

describe('buildClientUpdatePatch', () => {
  it('returns noop when nothing changed', () => {
    const result = buildClientUpdatePatch(baseline, {
      name: 'José',
      email: 'a@x.com',
      phone: '+525511111111',
      notes: 'OLD',
      tags: ['VIP'],
      budgetRange: '8k-12k',
    });
    assert.equal(result.noop, true);
  });

  it('sends only changed fields plus expectedUpdatedAt', () => {
    const result = buildClientUpdatePatch(baseline, {
      name: 'José',
      email: 'a@x.com',
      phone: '55 2222 3333',
      notes: 'OLD',
      tags: ['VIP'],
      budgetRange: '8k-12k',
    });
    assert.equal(result.noop, false);
    if (result.noop) return;
    assert.deepEqual(result.body, {
      expectedUpdatedAt: '2026-08-08T12:00:00.000Z',
      phone: '55 2222 3333',
    });
  });

  it('can clear optional fields with null', () => {
    const result = buildClientUpdatePatch(baseline, {
      name: 'José',
      email: '',
      phone: '',
      notes: '',
      tags: ['VIP'],
      budgetRange: '',
    });
    assert.equal(result.noop, false);
    if (result.noop) return;
    assert.equal(result.body.email, null);
    assert.equal(result.body.phone, null);
    assert.equal(result.body.notes, null);
    assert.equal(result.body.budgetRange, null);
    assert.equal(result.body.name, undefined);
    assert.equal(result.body.tags, undefined);
  });

  it('detects tag list changes for full-array replace', () => {
    const result = buildClientUpdatePatch(baseline, {
      name: 'José',
      email: 'a@x.com',
      phone: '+525511111111',
      notes: 'OLD',
      tags: ['VIP', 'AP'],
      budgetRange: '8k-12k',
    });
    assert.equal(result.noop, false);
    if (result.noop) return;
    assert.deepEqual(result.body.tags, ['VIP', 'AP']);
  });
});

describe('isClientStaleError', () => {
  it('recognizes CLIENT_STALE payloads', () => {
    assert.equal(
      isClientStaleError({
        status: 409,
        payload: { code: 'CLIENT_STALE', message: 'stale' },
      }),
      true,
    );
    assert.equal(
      isClientStaleError({
        status: 409,
        payload: { message: { code: 'CLIENT_STALE' } },
      }),
      true,
    );
    assert.equal(
      isClientStaleError({
        status: 409,
        payload: { code: 'CLIENT_EXACT_DUPLICATE' },
      }),
      false,
    );
  });
});
