import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AIAuditEventType, AIActionRunStatus } from '@prisma/client';
import { RuntimeService } from './runtime.service';

describe('RuntimeService', () => {
  const tx = {
    aIConversation: { findFirst: jest.fn() },
    aIActionRun: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    aIAuditEvent: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    aIActionRun: { findFirst: jest.fn() },
  };
  const service = new RuntimeService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('creates a plan with hashes and an audit event', async () => {
    tx.aIConversation.findFirst.mockResolvedValue({ id: 'c1' });
    tx.aIActionRun.create.mockImplementation(({ data }) => ({ id: 'r1', ...data }));
    const run = await service.create('t1', 'u1', { conversationId: 'c1', intent: 'test', proposedPlan: { b: 2, a: 1 }, normalizedArguments: { x: true } });
    expect(run).toEqual(expect.objectContaining({ id: 'r1', planFingerprint: expect.any(String), idempotencyKey: expect.stringMatching(/^ai:/) }));
    expect(tx.aIAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: AIAuditEventType.PLAN_CREATED }) });
  });

  it('confirms only the expected plan fingerprint and records the actor', async () => {
    tx.aIActionRun.findFirst.mockResolvedValue({ id: 'r1', tenantId: 't1', conversationId: 'c1', status: AIActionRunStatus.READY_FOR_CONFIRMATION, planFingerprint: 'a'.repeat(64), confirmedAt: null });
    tx.aIActionRun.update.mockResolvedValue({ id: 'r1', status: AIActionRunStatus.READY_FOR_CONFIRMATION });
    await service.confirm('t1', 'u1', 'r1', 'a'.repeat(64));
    expect(tx.aIActionRun.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { confirmedAt: expect.any(Date), confirmedByUserId: 'u1' } });
    expect(tx.aIAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: AIAuditEventType.PLAN_CONFIRMED, actorUserId: 'u1' }) });
  });

  it('rejects a wrong confirmation fingerprint', async () => {
    tx.aIActionRun.findFirst.mockResolvedValue({ id: 'r1', conversationId: 'c1', status: AIActionRunStatus.READY_FOR_CONFIRMATION, planFingerprint: 'a'.repeat(64), confirmedAt: null });
    await expect(service.confirm('t1', 'u1', 'r1', 'b'.repeat(64))).rejects.toThrow('fingerprint does not match');
    expect(tx.aIActionRun.update).not.toHaveBeenCalled();
  });

  it('rejects confirmation from an invalid state', async () => {
    tx.aIActionRun.findFirst.mockResolvedValue({ id: 'r1', conversationId: 'c1', status: AIActionRunStatus.DRAFT, planFingerprint: 'a'.repeat(64), confirmedAt: null });
    await expect(service.confirm('t1', 'u1', 'r1', 'a'.repeat(64))).rejects.toThrow('not ready for confirmation');
  });

  it('allows internal execution lifecycle methods after confirmation', async () => {
    const auditContext = { planFingerprint: 'a'.repeat(64), stepId: 's1', capability: 'GET_LIQUIDITY' as const, bindingVersion: '1.0.0', toolName: 'get_liquidity', toolVersion: '1.0.0' };
    tx.aIActionRun.findFirst
      .mockResolvedValueOnce({ id: 'r1', conversationId: 'c1', status: AIActionRunStatus.READY_FOR_CONFIRMATION, requiresConfirmation: true, confirmedAt: new Date() })
      .mockResolvedValueOnce({ id: 'r1', conversationId: 'c1', status: AIActionRunStatus.EXECUTING, requiresConfirmation: true, confirmedAt: new Date() });
    tx.aIActionRun.update
      .mockResolvedValueOnce({ id: 'r1', status: AIActionRunStatus.EXECUTING })
      .mockResolvedValueOnce({ id: 'r1', status: AIActionRunStatus.COMPLETED });
    await service.startExecution('t1', 'system-user', 'r1', auditContext);
    await service.completeExecution('t1', 'system-user', 'r1', { ok: true }, auditContext);
    expect(tx.aIActionRun.update).toHaveBeenNthCalledWith(1, { where: { id: 'r1' }, data: expect.objectContaining({ status: AIActionRunStatus.EXECUTING }) });
    expect(tx.aIActionRun.update).toHaveBeenNthCalledWith(2, { where: { id: 'r1' }, data: expect.objectContaining({ status: AIActionRunStatus.COMPLETED }) });
    expect(tx.aIAuditEvent.create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ type: AIAuditEventType.EXECUTION_STARTED, payload: auditContext }) });
    expect(tx.aIAuditEvent.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ type: AIAuditEventType.EXECUTION_COMPLETED, payload: { result: { ok: true }, ...auditContext } }) });
  });

  it('allows a Tier 0 read run to execute directly from DRAFT when confirmation is not required', async () => {
    tx.aIActionRun.findFirst.mockResolvedValue({ id: 'r1', conversationId: 'c1', status: AIActionRunStatus.DRAFT, requiresConfirmation: false, confirmedAt: null });
    tx.aIActionRun.update.mockResolvedValue({ id: 'r1', status: AIActionRunStatus.EXECUTING });
    await service.startExecution('t1', 'system-user', 'r1');
    expect(tx.aIActionRun.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: expect.objectContaining({ status: AIActionRunStatus.EXECUTING }) });
  });

  it('emits sanitized trusted metadata and failureType when read execution fails', async () => {
    const auditContext = { planFingerprint: 'a'.repeat(64), stepId: 's1', capability: 'GET_LIQUIDITY' as const, bindingVersion: '1.0.0', toolName: 'get_liquidity', toolVersion: '1.0.0' };
    tx.aIActionRun.findFirst.mockResolvedValue({ id: 'r1', conversationId: 'c1', status: AIActionRunStatus.EXECUTING, requiresConfirmation: false, confirmedAt: null });
    tx.aIActionRun.update.mockResolvedValue({ id: 'r1', status: AIActionRunStatus.FAILED });
    await service.failExecution('t1', 'system-user', 'r1', 'Read plan failed: Error', auditContext);
    expect(tx.aIAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: AIAuditEventType.EXECUTION_FAILED, payload: { failureType: 'Read plan failed: Error', ...auditContext } }) });
  });

  it('keeps terminal states terminal', async () => {
    tx.aIActionRun.findFirst.mockResolvedValue({ id: 'r1', conversationId: 'c1', status: AIActionRunStatus.COMPLETED, requiresConfirmation: true, confirmedAt: new Date() });
    await expect(service.startExecution('t1', 'system-user', 'r1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not expose another tenant action run', async () => {
    prisma.aIActionRun.findFirst.mockResolvedValue(null);
    await expect(service.findOne('other-tenant', 'r1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.aIActionRun.findFirst).toHaveBeenCalledWith({ where: { id: 'r1', tenantId: 'other-tenant', conversation: { deletedAt: null } } });
  });
});
