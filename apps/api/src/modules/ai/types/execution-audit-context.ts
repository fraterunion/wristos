import { BusinessCapability } from '../planner/planner.types';

export interface CapabilityExecutionAuditContext {
  planFingerprint: string;
  stepId: string;
  capability: BusinessCapability;
  bindingVersion: string;
}

export type PendingCapabilityExecutionAuditContext = Omit<CapabilityExecutionAuditContext, 'bindingVersion'>;

export interface RuntimeExecutionAuditContext {
  planFingerprint: string;
  stepId?: string;
  capability?: BusinessCapability;
  bindingVersion?: string;
  toolName?: string;
  toolVersion?: string;
}
