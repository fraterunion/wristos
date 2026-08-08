import { ConflictException } from '@nestjs/common';
import { UpdateClientWriteBinding } from '../write/update-client.binding';

describe('UpdateClientWriteBinding execute recovery', () => {
  const context = {
    tenantId: 't1',
    userId: 'u1',
    permissions: [],
    conversationId: 'c1',
    workspaceId: null,
    actionRunId: 'run-1',
    requestId: 'r1',
    locale: 'es-MX',
    timezone: 'UTC',
    now: new Date('2026-08-08T00:00:00Z'),
    planFingerprint: 'a'.repeat(64),
  };

  const input = {
    clientId: 'client-1',
    expectedUpdatedAt: '2026-08-08T12:00:00.000Z',
    patch: { phone: '+525512345678' as string | null },
    operations: ['SET_PHONE'],
    changedFields: ['phone'],
  };

  it('returns recovered success when CAS fails but intended fields already match', async () => {
    const clientUpdate = {
      update: jest.fn().mockRejectedValue(
        new ConflictException({ code: 'CLIENT_STALE', message: 'stale' }),
      ),
    };
    const prisma = {
      tenantUser: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
      client: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'client-1',
          name: 'José',
          email: null,
          phone: '+525512345678',
          notes: 'other notes changed later',
          tags: [],
          budgetRange: null,
          updatedAt: new Date('2026-08-08T13:00:00.000Z'),
        }),
      },
    };
    const binding = new UpdateClientWriteBinding(prisma as never, clientUpdate as never);
    const result = await binding.execute(input, context);
    expect(result.success).toBe(true);
    const receipt = result.receipt as Record<string, unknown>;
    expect(receipt.kind).toBe('CLIENT_UPDATED');
    expect(receipt.recovered).toBe(true);
    expect(receipt.subsequentChangesDetected).toBe(true);
    expect(clientUpdate.update).toHaveBeenCalledTimes(1);
  });

  it('throws AMBIGUOUS_RECOVERY when same intended field diverged', async () => {
    const clientUpdate = {
      update: jest.fn().mockRejectedValue(
        new ConflictException({ code: 'CLIENT_STALE', message: 'stale' }),
      ),
    };
    const prisma = {
      tenantUser: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
      client: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'client-1',
          name: 'José',
          email: null,
          phone: '+525599999999',
          notes: null,
          tags: [],
          budgetRange: null,
          updatedAt: new Date('2026-08-08T13:00:00.000Z'),
        }),
      },
    };
    const binding = new UpdateClientWriteBinding(prisma as never, clientUpdate as never);
    await expect(binding.execute(input, context)).rejects.toBeInstanceOf(ConflictException);
    try {
      await binding.execute(input, context);
    } catch (error) {
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'AMBIGUOUS_RECOVERY',
      });
    }
  });

  it('does not mutate when confirm path is not invoked (mapInput only)', () => {
    const clientUpdate = { update: jest.fn() };
    const binding = new UpdateClientWriteBinding({} as never, clientUpdate as never);
    binding.mapInput(
      {
        stepId: 's1',
        capability: 'UPDATE_CLIENT',
        arguments: {
          clientId: 'client-1',
          expectedUpdatedAt: '2026-08-08T12:00:00.000Z',
          patchPhone: '+525512345678',
        },
        dependsOn: [],
        estimatedEffects: [],
        reversibility: 'NONE',
      },
      context,
    );
    expect(clientUpdate.update).not.toHaveBeenCalled();
  });
});
