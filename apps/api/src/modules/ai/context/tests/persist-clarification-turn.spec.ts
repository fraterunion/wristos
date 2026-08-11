import { WorkingContextService } from '../working-context.service';
import { WORKING_CONTEXT_SCHEMA_VERSION } from '../working-context';

describe('WorkingContextService.persistClarificationTurn', () => {
  it('creates conversation/workspace and stores pending clarification + draft entities', async () => {
    const conversation = { id: 'c1' };
    const workspace = {
      id: 'w1',
      version: 1,
      conversationId: null,
      resolvedContext: {},
    };
    const tx = {
      aIConversation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(conversation),
        update: jest.fn().mockResolvedValue(conversation),
      },
      aIWorkspace: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ ...workspace, conversationId: 'c1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...workspace, id: 'w1', version: 2, conversationId: 'c1' }),
      },
      aIRequest: {
        update: jest.fn().mockResolvedValue({}),
      },
      aIAuditEvent: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const service = new WorkingContextService(prisma as never);

    const result = await service.persistClarificationTurn({
      tenantId: 't1',
      userId: 'u1',
      surface: 'DESKTOP',
      requestId: 'ar-1',
      intent: 'REGISTER_EXPENSE',
      entities: { amount: 500, description: 'gasolina' },
      response: {
        interactionState: 'NEEDS_INPUT',
        responseType: 'MISSING_FIELDS_CARD',
        payload: {
          clarificationField: 'currency',
          groups: [{ fields: [{ key: 'currency', question: '¿Pesos o dólares?' }] }],
        },
      },
      mode: 'MISSING_FIELDS',
    });

    expect(result).toEqual({ conversationId: 'c1', workspaceId: 'w1', version: 2 });
    expect(tx.aIConversation.create).toHaveBeenCalled();
    expect(tx.aIWorkspace.create).toHaveBeenCalled();
    expect(tx.aIRequest.update).toHaveBeenCalledWith({
      where: { id: 'ar-1' },
      data: { conversationId: 'c1', workspaceId: 'w1' },
    });
    const updateData = tx.aIWorkspace.updateMany.mock.calls[0][0].data;
    expect(updateData.resolvedContext.workingContext.pendingMissingFields).toEqual(['currency']);
    expect(updateData.resolvedContext.workingContext.lastIntent).toBe('REGISTER_EXPENSE');
    expect(updateData.resolvedContext.workingContext.schemaVersion).toBe(WORKING_CONTEXT_SCHEMA_VERSION);
    expect(updateData.resolvedContext.pendingClarificationEntities).toEqual({
      amount: 500,
      description: 'gasolina',
    });
  });

  it('readPendingClarificationEntities returns only scalar draft values', () => {
    const service = new WorkingContextService({} as never);
    expect(
      service.readPendingClarificationEntities({
        pendingClarificationEntities: { amount: 500, nested: { x: 1 }, ok: true },
      }),
    ).toEqual({ amount: 500, ok: true });
  });
});
