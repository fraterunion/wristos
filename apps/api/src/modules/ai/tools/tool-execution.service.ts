import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AIAuditEventType, Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { PrismaService } from '../../../prisma/prisma.service';
import { JsonValue, sha256Canonical } from '../domain/canonical-json';
import { ToolContext, ToolResult } from './tool-definition';
import { ToolRegistry } from './tool-registry';

@Injectable()
export class ToolExecutionService {
  constructor(private readonly registry: ToolRegistry, private readonly prisma: PrismaService) {}
  async execute(name: string, context: ToolContext, rawInput: unknown): Promise<ToolResult> {
    const tool = this.registry.getDefinition(name);
    const traceId = context.requestId;
    if (tool.permission && !context.permissions.includes(tool.permission)) { await this.audit(context, AIAuditEventType.TOOL_PERMISSION_DENIED, tool.name, tool.version, traceId); throw new ForbiddenException('AI tool permission denied'); }
    let input: unknown;
    try { input = tool.inputValidator.parse(rawInput); }
    catch (error) { await this.audit(context, AIAuditEventType.TOOL_INPUT_INVALID, tool.name, tool.version, traceId); throw new BadRequestException(error instanceof ZodError ? error.issues.map((i) => i.message).join('; ') : 'Invalid tool input'); }
    const inputFingerprint = sha256Canonical(input as JsonValue);
    await this.audit(context, AIAuditEventType.TOOL_EXECUTION_STARTED, tool.name, tool.version, traceId, { inputFingerprint });
    const started = Date.now();
    try {
      const executed = await tool.execute(context, input);
      let data: unknown;
      try { data = tool.outputValidator.parse(executed.data); }
      catch { await this.audit(context, AIAuditEventType.TOOL_OUTPUT_INVALID, tool.name, tool.version, traceId); throw new BadRequestException('Canonical tool output failed validation'); }
      const durationMs = Date.now() - started;
      const result: ToolResult = { toolName: tool.name, toolVersion: tool.version, success: true, data, summary: executed.summary, sourceMetadata: { canonicalService: tool.canonicalService, deterministic: true, tenantScoped: true }, warnings: executed.warnings ?? [], executedAt: context.now.toISOString(), durationMs, traceId };
      await this.audit(context, AIAuditEventType.TOOL_EXECUTION_COMPLETED, tool.name, tool.version, traceId, { durationMs, outputHash: sha256Canonical(data as JsonValue), summary: executed.summary.slice(0, 200) });
      return result;
    } catch (error) {
      if (!(error instanceof BadRequestException && error.message === 'Canonical tool output failed validation')) await this.audit(context, AIAuditEventType.TOOL_EXECUTION_FAILED, tool.name, tool.version, traceId, { errorType: error instanceof Error ? error.constructor.name : 'UnknownError' });
      throw error;
    }
  }
  private audit(context: ToolContext, type: AIAuditEventType, toolName: string, toolVersion: string, traceId: string, metadata: Prisma.InputJsonObject = {}) {
    return this.prisma.aIAuditEvent.create({ data: { tenantId: context.tenantId, actorUserId: context.userId, conversationId: context.conversationId, actionRunId: context.actionRunId, workspaceId: context.workspaceId, type, payload: { toolName, toolVersion, traceId, ...metadata } } });
  }
}
