import { WorkingContextService } from '../working-context.service';
import { WORKING_CONTEXT_SCHEMA_VERSION } from '../working-context';
import { draftToEntities } from '../conversation-draft';

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
    expect(updateData.resolvedContext.conversationDraft.capability).toBe('REGISTER_EXPENSE');
    // REGISTER_EXPENSE has no explicit CAPABILITY_DRAFT_MAPPING entry, so its
    // fields fall through to the Draft's generic metadata bag — and still
    // round-trip losslessly.
    expect(draftToEntities(updateData.resolvedContext.conversationDraft)).toEqual({
      amount: 500,
      description: 'gasolina',
    });
  });

  it('readConversationDraft returns the stored ConversationDraft as-is (null if none)', () => {
    const service = new WorkingContextService({} as never);
    const draft = {
      schemaVersion: '1' as const,
      capability: 'REGISTER_EXPENSE',
      status: 'ACTIVE' as const,
      updatedAt: '2026-08-13T00:00:00.000Z',
      metadata: { amount: 500, ok: true },
    };
    expect(service.readConversationDraft({ conversationDraft: draft })).toEqual(draft);
    expect(service.readConversationDraft({})).toBeNull();
    expect(service.readConversationDraft(null)).toBeNull();
  });
});
