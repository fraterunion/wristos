import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessExecutionPlan, BusinessPlanStep, PlanningContext } from '../planner/planner.types';
import { PlannerService } from '../planner/planner.service';
import { RuntimeService } from '../runtime/runtime.service';
import { ToolContext } from '../tools/tool-definition';
import { CapabilityResult } from './capability-binding-definition';
import { CapabilityBindingRegistry } from './capability-binding-registry';
import { CapabilityBindingService } from './capability-binding.service';
import { RuntimeExecutionAuditContext } from '../types/execution-audit-context';

export interface ReadPlanResult {
  planFingerprint: string;
  executionState: 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED';
  stepResults: Array<{ stepId: string; result: CapabilityResult }>;
  warnings: string[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  traceId: string;
}

export interface ReadPlanRunRequest {
  plan: BusinessExecutionPlan;
  current: PlanningContext;
  expectedFingerprint: string;
  toolContext: ToolContext;
  actionRunId?: string;
}

@Injectable()
export class ReadPlanRunner {
  constructor(private readonly planner: PlannerService, private readonly registry: CapabilityBindingRegistry, private readonly bindingService: CapabilityBindingService, private readonly runtime: RuntimeService) {}

  async run(request: ReadPlanRunRequest): Promise<ReadPlanResult> {
    const { plan, current, expectedFingerprint, toolContext, actionRunId } = request;
    if (plan.state !== 'READY_FOR_CONFIRMATION') throw new ConflictException('Read plan is not ready');
    if (plan.confirmationTier !== 'NONE') throw new ConflictException('Read plan confirmation tier must be NONE');
    const validation = this.planner.validatePlanStillCurrent(plan, current, expectedFingerprint);
    if (!validation.current) throw new ConflictException(`Read plan is stale: ${validation.reasons.join(',')}`);
    this.validateSteps(plan.executionSteps);

    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const traceId = toolContext.requestId;
    const runtimeAudit = this.runtimeAuditContext(plan);
    let runtimeStarted = false;
    const stepResults: ReadPlanResult['stepResults'] = [];
    try {
      if (actionRunId) {
        await this.runtime.startExecution(toolContext.tenantId, toolContext.userId, actionRunId, runtimeAudit);
        runtimeStarted = true;
      }
      for (const step of plan.executionSteps) {
        const result = await this.bindingService.executeCapability(step, { ...toolContext, actionRunId: actionRunId ?? toolContext.actionRunId, requestId: `${traceId}:${step.stepId}` }, { planFingerprint: plan.fingerprint, stepId: step.stepId, capability: step.capability });
        stepResults.push({ stepId: step.stepId, result });
      }
      const completedAt = new Date().toISOString();
      const output: ReadPlanResult = { planFingerprint: plan.fingerprint, executionState: 'COMPLETED', stepResults, warnings: plan.warnings.map((warning) => warning.message), startedAt, completedAt, durationMs: Math.max(0, Date.parse(completedAt) - startedMs), traceId };
      if (actionRunId) await this.runtime.completeExecution(toolContext.tenantId, toolContext.userId, actionRunId, { planFingerprint: plan.fingerprint, executionState: 'COMPLETED', stepCount: stepResults.length } as Prisma.InputJsonObject, runtimeAudit);
      return output;
    } catch (error) {
      if (actionRunId && runtimeStarted) await this.runtime.failExecution(toolContext.tenantId, toolContext.userId, actionRunId, `Read plan failed: ${error instanceof Error ? error.constructor.name : 'UnknownError'}`, runtimeAudit);
      const completedAt = new Date().toISOString();
      return { planFingerprint: plan.fingerprint, executionState: stepResults.length ? 'PARTIALLY_COMPLETED' : 'FAILED', stepResults, warnings: plan.warnings.map((warning) => warning.message), startedAt, completedAt, durationMs: Math.max(0, Date.parse(completedAt) - startedMs), traceId };
    }
  }

  private validateSteps(steps: readonly BusinessPlanStep[]): void {
    const completed = new Set<string>();
    for (const step of steps) {
      const binding = this.registry.getBinding(step.capability);
      if (binding.mode !== 'READ') throw new BadRequestException('Read plan contains a non-read binding');
      if (completed.has(step.stepId) || step.dependsOn.some((dependency) => !completed.has(dependency))) throw new BadRequestException('Read plan dependency cannot be resolved deterministically');
      completed.add(step.stepId);
    }
  }

  private runtimeAuditContext(plan: BusinessExecutionPlan): RuntimeExecutionAuditContext {
    const audit: RuntimeExecutionAuditContext = { planFingerprint: plan.fingerprint };
    if (plan.executionSteps.length === 1) {
      const step = plan.executionSteps[0]!;
      const binding = this.registry.getBinding(step.capability);
      audit.stepId = step.stepId;
      audit.capability = step.capability;
      audit.bindingVersion = binding.version;
      audit.toolName = binding.toolName;
      audit.toolVersion = binding.toolVersion;
    }
    return audit;
  }
}
