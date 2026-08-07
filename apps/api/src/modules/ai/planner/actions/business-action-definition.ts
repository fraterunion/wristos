import { z } from 'zod';
import { BusinessActionId, BusinessCapability, BusinessPlanStep, BusinessWarning, ConfirmationPreview, ConfirmationTier, StructuredEntities } from '../planner.types';

export interface WarningRule {
  code: string;
  evaluate(entities: StructuredEntities): BusinessWarning | null;
}

export interface BusinessActionDefinition {
  id: BusinessActionId;
  name: string;
  description: string;
  category: string;
  confirmationTier: ConfirmationTier;
  requiredEntities: readonly string[];
  optionalEntities: readonly string[];
  clarificationQuestions: Readonly<Record<string, string>>;
  warningRules: readonly WarningRule[];
  /** Extra missing fields derived from already-provided entities (e.g. payment destination). */
  conditionalMissing?: (entities: StructuredEntities) => Array<{ entity: string; question: string }>;
  previewBuilder(entities: StructuredEntities, warnings: BusinessWarning[]): ConfirmationPreview;
  planningStrategy(entities: StructuredEntities): BusinessPlanStep[];
  capabilities: readonly BusinessCapability[];
  resultSchema: z.ZodType;
}
