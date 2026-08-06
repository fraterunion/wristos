import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessPlanStep } from '../planner/planner.types';
import { ToolContext } from '../tools/tool-definition';
import { ToolExecutionService } from '../tools/tool-execution.service';
import { CapabilityResult } from './capability-binding-definition';
import { CapabilityBindingRegistry } from './capability-binding-registry';
import { CapabilityExecutionAuditContext, PendingCapabilityExecutionAuditContext } from '../types/execution-audit-context';

@Injectable()
export class CapabilityBindingService {
  constructor(private readonly registry: CapabilityBindingRegistry, private readonly toolExecution: ToolExecutionService, private readonly prisma: PrismaService) {}

  async executeCapability(step: BusinessPlanStep, context: ToolContext, pendingAudit: PendingCapabilityExecutionAuditContext): Promise<CapabilityResult> {
    const membership = await this.prisma.tenantUser.findFirst({ where: { tenantId: context.tenantId, userId: context.userId, tenant: { status: 'ACTIVE' }, user: { status: 'ACTIVE' } }, select: { id: true } });
    if (!membership) throw new ForbiddenException('Authenticated tenant membership required for capability execution');
    const binding = this.registry.getBinding(step.capability);
    if (pendingAudit.capability !== step.capability || pendingAudit.stepId !== step.stepId) throw new ForbiddenException('Capability audit context does not match the plan step');
    if (binding.mode !== 'READ') throw new ForbiddenException('Only read capability bindings may execute');
    const input = binding.inputMapper(step, context);
    binding.inputSchema.parse(input);
    const capabilityAudit: CapabilityExecutionAuditContext = { planFingerprint: pendingAudit.planFingerprint, stepId: pendingAudit.stepId, capability: pendingAudit.capability, bindingVersion: binding.version };
    const toolResult = await this.toolExecution.execute(binding.toolName, context, input, capabilityAudit);
    if (toolResult.toolName !== binding.toolName || toolResult.toolVersion !== binding.toolVersion) throw new ForbiddenException('Bound tool result identity mismatch');
    return binding.outputMapper(toolResult, context);
  }
}
