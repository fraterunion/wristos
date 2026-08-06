import { z } from 'zod';
import { BusinessActionId, BusinessWarning, ConfirmationPreview, ConfirmationTier, ExecutionStep, StructuredEntities } from '../planner.types';

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
  previewBuilder(entities: StructuredEntities, warnings: BusinessWarning[]): ConfirmationPreview;
  planBuilder(entities: StructuredEntities): ExecutionStep[];
  allowedToolNames: readonly string[];
  resultSchema: z.ZodType;
}
