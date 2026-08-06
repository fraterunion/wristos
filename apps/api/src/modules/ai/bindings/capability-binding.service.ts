import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessPlanStep } from '../planner/planner.types';
import { ToolContext } from '../tools/tool-definition';
import { ToolExecutionService } from '../tools/tool-execution.service';
import { CapabilityResult } from './capability-binding-definition';
import { CapabilityBindingRegistry } from './capability-binding-registry';

@Injectable()
export class CapabilityBindingService {
  constructor(private readonly registry: CapabilityBindingRegistry, private readonly toolExecution: ToolExecutionService, private readonly prisma: PrismaService) {}

  async executeCapability(step: BusinessPlanStep, context: ToolContext): Promise<CapabilityResult> {
    const membership = await this.prisma.tenantUser.findFirst({ where: { tenantId: context.tenantId, userId: context.userId, tenant: { status: 'ACTIVE' }, user: { status: 'ACTIVE' } }, select: { id: true } });
    if (!membership) throw new ForbiddenException('Authenticated tenant membership required for capability execution');
    const binding = this.registry.getBinding(step.capability);
    if (binding.mode !== 'READ') throw new ForbiddenException('Only read capability bindings may execute');
    const input = binding.inputMapper(step, context);
    binding.inputSchema.parse(input);
    const toolResult = await this.toolExecution.execute(binding.toolName, context, input);
    if (toolResult.toolName !== binding.toolName || toolResult.toolVersion !== binding.toolVersion) throw new ForbiddenException('Bound tool result identity mismatch');
    return binding.outputMapper(toolResult, context);
  }
}
