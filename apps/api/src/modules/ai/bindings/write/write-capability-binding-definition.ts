import { z } from 'zod';
import { JsonValue } from '../../domain/canonical-json';
import {
  BusinessActionResult,
  BusinessCapability,
  BusinessPlanStep,
} from '../../planner/planner.types';
import { ToolContext } from '../../tools/tool-definition';

export type WriteExecutionContext = ToolContext & {
  actionRunId: string;
  planFingerprint: string;
  workspaceVersion?: number;
  entityVersions?: Record<string, string | number>;
};

export interface WriteCapabilityBindingDefinition<I = unknown> {
  capability: BusinessCapability;
  version: string;
  mode: 'WRITE';
  /** Stable identity for audit — not a ToolRegistry tool. */
  bindingName: string;
  mapInput(step: BusinessPlanStep, context: WriteExecutionContext): I;
  inputSchema: z.ZodType<I>;
  execute(input: I, context: WriteExecutionContext): Promise<BusinessActionResult>;
}

export type WriteCapabilityInput = Record<string, JsonValue>;
