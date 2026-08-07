import { Injectable } from '@nestjs/common';
import { JsonValue } from '../domain/canonical-json';
import { createPlanFingerprint } from '../domain/plan-fingerprint';
import { BusinessActionCatalog } from './actions/business-action-catalog';
import { BusinessCapabilityCatalog } from './capabilities/business-capability-catalog';
import { BusinessExecutionPlan, BusinessPlanStep, BusinessWarning, MissingEntity, PlanningContext, PlanValidationResult, StructuredEntities, StructuredIntent } from './planner.types';

const isMissing = (value: JsonValue | undefined): boolean => value === undefined || value === null || value === '';
const normalizedEntities = (entities: StructuredEntities): Record<string, JsonValue> => Object.fromEntries(Object.entries(entities).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined));
const fingerprintPayload = (plan: Omit<BusinessExecutionPlan, 'fingerprint'>): JsonValue => plan as unknown as JsonValue;

@Injectable()
export class PlannerService {
  constructor(private readonly catalog: BusinessActionCatalog, private readonly capabilityCatalog: BusinessCapabilityCatalog) {}

  plan(intent: StructuredIntent, context: PlanningContext): BusinessExecutionPlan {
    const action = this.catalog.get(intent.intent);
    const missingEntities: MissingEntity[] = action.requiredEntities
      .filter((entity) => isMissing(intent.entities[entity]))
      .map((entity) => ({ entity, question: action.clarificationQuestions[entity] ?? `Provide ${entity}.` }));
    if (action.conditionalMissing) {
      for (const extra of action.conditionalMissing(intent.entities)) {
        if (!missingEntities.some((item) => item.entity === extra.entity)) {
          missingEntities.push(extra);
        }
      }
    }
    const warnings = action.warningRules.map((rule) => rule.evaluate(intent.entities)).filter((item): item is BusinessWarning => item !== null);
    const ready = missingEntities.length === 0;
    const planWithoutFingerprint: Omit<BusinessExecutionPlan, 'fingerprint'> = {
      businessAction: action.id,
      state: ready ? 'READY_FOR_CONFIRMATION' : 'NEEDS_CLARIFICATION',
      missingEntities,
      clarificationQuestions: missingEntities.map((item) => item.question),
      warnings,
      confirmationTier: action.confirmationTier,
      executionSteps: ready ? action.planningStrategy(intent.entities) : [],
      preview: ready ? action.previewBuilder(intent.entities, warnings) : null,
      workspaceVersion: context.workspaceVersion,
      entityVersions: { ...context.entityVersions },
    };

    this.assertValidSteps(action.capabilities, planWithoutFingerprint.executionSteps);
    return { ...planWithoutFingerprint, fingerprint: createPlanFingerprint(fingerprintPayload(planWithoutFingerprint)) };
  }

  validatePlanStillCurrent(plan: BusinessExecutionPlan, current: PlanningContext, expectedFingerprint = plan.fingerprint): PlanValidationResult {
    const reasons: PlanValidationResult['reasons'] = [];
    if (plan.workspaceVersion !== current.workspaceVersion) reasons.push('WORKSPACE_VERSION_CHANGED');
    if (Object.entries(plan.entityVersions).some(([id, version]) => current.entityVersions[id] !== version)) reasons.push('ENTITY_VERSION_CHANGED');
    const { fingerprint, ...unsignedPlan } = plan;
    const recomputed = createPlanFingerprint(fingerprintPayload(unsignedPlan));
    if (fingerprint !== expectedFingerprint || fingerprint !== recomputed) reasons.push('PLAN_FINGERPRINT_MISMATCH');
    return { current: reasons.length === 0, reasons };
  }

  private assertValidSteps(allowed: readonly string[], steps: readonly BusinessPlanStep[]): void {
    const prior = new Set<string>();
    for (const step of steps) {
      this.capabilityCatalog.get(step.capability);
      if (!allowed.includes(step.capability)) throw new Error('Business action plan contains a non-allowlisted capability');
      if (prior.has(step.stepId) || step.dependsOn.some((dependency) => !prior.has(dependency))) throw new Error('Business action plan contains invalid dependency order');
      prior.add(step.stepId);
    }
  }
}
