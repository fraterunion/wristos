import { JsonValue } from '../domain/canonical-json';

export type BusinessActionId =
  | 'GET_LIQUIDITY'
  | 'GET_MONTHLY_PROFIT'
  | 'SEARCH_INVENTORY'
  | 'SEARCH_CLIENT'
  | 'GET_CLIENT_ACCOUNTS'
  | 'GET_INVENTORY_AGING'
  | 'GET_TOP_INVENTORY_CAPITAL'
  | 'GET_TOP_DEBTORS'
  | 'GET_RECEIVABLE_SUMMARY'
  | 'GET_SALES_MARGIN_SUMMARY'
  | 'GET_PROFIT_BY_BRAND'
  | 'GET_TOP_SALES'
  | 'GET_ATTENTION_ITEMS'
  | 'GET_BUSINESS_SUMMARY'
  | 'REGISTER_SALE'
  | 'REGISTER_RECEIVABLE_PAYMENT'
  | 'REGISTER_PURCHASE'
  | 'REGISTER_EXPENSE'
  | 'CREATE_CLIENT'
  | 'UPDATE_CLIENT'
  | 'REGISTER_SETTLEMENT'
  | 'REGISTER_CRYPTO_POSITION'
  | 'REGISTER_CRYPTO_PRICE'

export type BusinessCapability = BusinessActionId;

export type ConfirmationTier = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
export type PlannerState = 'NEEDS_CLARIFICATION' | 'READY_FOR_CONFIRMATION';
export type StructuredEntities = Record<string, JsonValue | undefined>;

export interface StructuredIntent {
  intent: BusinessActionId | string;
  entities: StructuredEntities;
}

export interface PlanningContext {
  workspaceVersion: number;
  entityVersions: Record<string, string | number>;
}

export interface MissingEntity {
  entity: string;
  question: string;
}

export interface BusinessWarning {
  code: string;
  message: string;
}

export interface ConfirmationPreview {
  title: string;
  category: string;
  fields: Array<{ label: string; value: JsonValue }>;
  warnings: BusinessWarning[];
  confirmationTier: ConfirmationTier;
  estimatedEffects: Array<{ area: string; description: string }>;
}

export interface EstimatedEffect {
  area: string;
  description: string;
}

export interface BusinessPlanStep {
  stepId: string;
  capability: BusinessCapability;
  arguments: Record<string, JsonValue>;
  dependsOn: string[];
  estimatedEffects: EstimatedEffect[];
  reversibility: 'FULL' | 'PARTIAL' | 'NONE';
}

export interface BusinessExecutionPlan {
  businessAction: BusinessActionId;
  state: PlannerState;
  missingEntities: MissingEntity[];
  clarificationQuestions: string[];
  warnings: BusinessWarning[];
  confirmationTier: ConfirmationTier;
  executionSteps: BusinessPlanStep[];
  preview: ConfirmationPreview | null;
  workspaceVersion: number;
  entityVersions: Record<string, string | number>;
  fingerprint: string;
}

export interface BusinessActionResult {
  actionId: BusinessActionId;
  executionState: 'NOT_EXECUTED' | 'EXECUTED' | 'PARTIALLY_EXECUTED' | 'FAILED';
  success: boolean;
  affectedEntities: JsonValue[];
  generatedEvents: JsonValue[];
  receipt: JsonValue | null;
  warnings: BusinessWarning[];
  rollbackPossible: boolean;
}

export const createNotExecutedResult = (actionId: BusinessActionId, warnings: BusinessWarning[] = []): BusinessActionResult => ({
  actionId,
  executionState: 'NOT_EXECUTED',
  success: false,
  affectedEntities: [],
  generatedEvents: [],
  receipt: null,
  warnings: [...warnings],
  rollbackPossible: false,
});

export interface PlanValidationResult {
  current: boolean;
  reasons: Array<'WORKSPACE_VERSION_CHANGED' | 'ENTITY_VERSION_CHANGED' | 'PLAN_FINGERPRINT_MISMATCH'>;
}
