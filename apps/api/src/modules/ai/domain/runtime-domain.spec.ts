import { BadRequestException } from '@nestjs/common';
import { AIActionRunStatus } from '@prisma/client';
import { assertValidTransition, canTransition } from './action-run-state-machine';
import { createIdempotencyKey } from './idempotency';
import { createPlanFingerprint } from './plan-fingerprint';

describe('AI runtime domain', () => {
  it('allows every intended lifecycle branch', () => {
    expect(canTransition(AIActionRunStatus.DRAFT, AIActionRunStatus.READY_FOR_CONFIRMATION)).toBe(true);
    expect(canTransition(AIActionRunStatus.READY_FOR_CONFIRMATION, AIActionRunStatus.EXECUTING)).toBe(true);
    expect(canTransition(AIActionRunStatus.EXECUTING, AIActionRunStatus.COMPLETED)).toBe(true);
    expect(canTransition(AIActionRunStatus.DRAFT, AIActionRunStatus.NEEDS_CLARIFICATION)).toBe(true);
  });

  it('rejects transitions from terminal states and skips', () => {
    expect(() => assertValidTransition(AIActionRunStatus.COMPLETED, AIActionRunStatus.EXECUTING)).toThrow(BadRequestException);
    expect(() => assertValidTransition(AIActionRunStatus.DRAFT, AIActionRunStatus.COMPLETED)).toThrow(BadRequestException);
  });

  it('fingerprints equivalent plans identically despite key formatting/order', () => {
    const first = { action: 'create', args: { count: 1, tags: ['a', 'b'] } };
    const second = { args: { tags: ['a', 'b'], count: 1 }, action: 'create' };
    expect(createPlanFingerprint(first)).toBe(createPlanFingerprint(second));
    expect(createPlanFingerprint(first)).not.toBe(createPlanFingerprint({ ...first, action: 'update' }));
  });

  it('creates stable, tenant/user/intent-scoped idempotency keys', () => {
    const input = { tenantId: 't1', userId: 'u1', intent: 'draft', normalizedArguments: { b: 2, a: 1 } };
    expect(createIdempotencyKey(input)).toBe(createIdempotencyKey({ ...input, normalizedArguments: { a: 1, b: 2 } }));
    expect(createIdempotencyKey(input)).not.toBe(createIdempotencyKey({ ...input, tenantId: 't2' }));
  });
});
