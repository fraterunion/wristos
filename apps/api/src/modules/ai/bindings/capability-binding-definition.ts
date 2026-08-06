import { z } from 'zod';
import { JsonValue } from '../domain/canonical-json';
import { BusinessCapability, BusinessPlanStep } from '../planner/planner.types';
import { ToolContext, ToolResult, ToolSourceMetadata } from '../tools/tool-definition';

export interface CapabilityResult {
  capability: BusinessCapability;
  bindingVersion: string;
  toolName: string;
  toolVersion: string;
  success: true;
  data: unknown;
  summary: string;
  warnings: string[];
  sourceMetadata: ToolSourceMetadata;
  executedAt: string;
  durationMs: number;
  traceId: string;
}

export interface CapabilityBindingDefinition<I = unknown> {
  capability: BusinessCapability;
  version: string;
  mode: 'READ';
  toolName: string;
  toolVersion: string;
  inputSchema: z.ZodType<I>;
  inputMapper(planStep: BusinessPlanStep, context: ToolContext): I;
  outputMapper(toolResult: ToolResult, context: ToolContext): CapabilityResult;
}

export type CapabilityInput = Record<string, JsonValue>;
