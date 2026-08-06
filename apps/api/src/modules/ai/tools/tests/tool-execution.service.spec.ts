import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AIAuditEventType } from '@prisma/client';
import { z } from 'zod';
import { ToolDefinition, ToolContext } from '../tool-definition';
import { ToolExecutionService } from '../tool-execution.service';

describe('ToolExecutionService', () => {
  const auditCreate = jest.fn().mockResolvedValue({ id: 'audit' });
  const prisma = { aIAuditEvent: { create: auditCreate } };
  const context: ToolContext = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [], conversationId: null, workspaceId: null, actionRunId: null, requestId: 'trace-1', locale: 'es-MX', timezone: 'America/Mexico_City', now: new Date('2026-08-06T12:00:00Z') };
  const makeTool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({ name: 'test_read', version: '1.0.0', description: 'test', category: 'TEST', mode: 'READ', confirmationTier: 0, permission: null, inputSchema: {}, outputSchema: {}, inputValidator: z.object({ value: z.string() }).strict(), outputValidator: z.object({ result: z.string() }).strict(), canonicalService: 'TestService.read', execute: jest.fn(async (_ctx, input: any) => ({ data: { result: input.value }, summary: 'ok' })), ...overrides });
  const serviceFor = (tool: ToolDefinition) => new ToolExecutionService({ getDefinition: jest.fn(() => tool) } as never, prisma as never);
  beforeEach(() => jest.clearAllMocks());

  it('validates, executes, validates output, and emits start/completed metadata', async () => {
    const result = await serviceFor(makeTool()).execute('test_read', context, { value: 'same' });
    expect(result).toEqual(expect.objectContaining({ success: true, data: { result: 'same' }, executedAt: context.now.toISOString(), traceId: 'trace-1' }));
    expect(auditCreate.mock.calls.map((call) => call[0].data.type)).toEqual([AIAuditEventType.TOOL_EXECUTION_STARTED, AIAuditEventType.TOOL_EXECUTION_COMPLETED]);
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain('same');
  });

  it('rejects invalid/unknown fields before execution and does not audit raw input', async () => {
    const tool = makeTool();
    await expect(serviceFor(tool).execute('test_read', context, { value: 'secret-pii', extra: true })).rejects.toBeInstanceOf(BadRequestException);
    expect(tool.execute).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ type: AIAuditEventType.TOOL_INPUT_INVALID }) });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain('secret-pii');
  });

  it('rejects invalid canonical output and audits without payload', async () => {
    const tool = makeTool({ execute: jest.fn(async () => ({ data: { wrong: true }, summary: 'bad' })) });
    await expect(serviceFor(tool).execute('test_read', context, { value: 'x' })).rejects.toThrow('output failed validation');
    expect(auditCreate.mock.calls.map((call) => call[0].data.type)).toContain(AIAuditEventType.TOOL_OUTPUT_INVALID);
  });

  it('denies missing permission before canonical execution', async () => {
    const tool = makeTool({ permission: 'finance.read' });
    await expect(serviceFor(tool).execute('test_read', context, { value: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(tool.execute).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ type: AIAuditEventType.TOOL_PERMISSION_DENIED }) });
  });

  it('audits canonical failures', async () => {
    const tool = makeTool({ execute: jest.fn(async () => { throw new Error('database unavailable'); }) });
    await expect(serviceFor(tool).execute('test_read', context, { value: 'x' })).rejects.toThrow('database unavailable');
    expect(auditCreate.mock.calls.map((call) => call[0].data.type)).toContain(AIAuditEventType.TOOL_EXECUTION_FAILED);
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain('database unavailable');
  });
});
