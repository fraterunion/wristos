import { JsonValue } from '../domain/canonical-json';

export type BusinessActionId =
  | 'GET_LIQUIDITY'
  | 'GET_MONTHLY_PROFIT'
  | 'SEARCH_INVENTORY'
  | 'SEARCH_CLIENT'
  | 'GET_CLIENT_ACCOUNTS'
  | 'REGISTER_SALE'
  | 'REGISTER_RECEIVABLE_PAYMENT'
  | 'REGISTER_PURCHASE'
  | 'REGISTER_EXPENSE'
  | 'REGISTER_SETTLEMENT'
  | 'REGISTER_CRYPTO_POSITION'
  | 'REGISTER_CRYPTO_PRICE';

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

export interface ExecutionStep {
  businessAction: BusinessActionId;
  toolName: string;
  arguments: Record<string, JsonValue>;
}

export interface ExecutionPlan {
  businessAction: BusinessActionId;
  state: PlannerState;
  missingEntities: MissingEntity[];
  clarificationQuestions: string[];
  warnings: BusinessWarning[];
  confirmationTier: ConfirmationTier;
  executionSteps: ExecutionStep[];
  preview: ConfirmationPreview | null;
  workspaceVersion: number;
  entityVersions: Record<string, string | number>;
  fingerprint: string;
}

export interface PlanValidationResult {
  current: boolean;
  reasons: Array<'WORKSPACE_VERSION_CHANGED' | 'ENTITY_VERSION_CHANGED' | 'PLAN_FINGERPRINT_MISMATCH'>;
}
