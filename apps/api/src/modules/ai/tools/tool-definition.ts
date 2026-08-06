import { z } from 'zod';

export type ToolContext = { tenantId: string; userId: string; role?: string; permissions: string[]; conversationId: string | null; workspaceId: string | null; actionRunId: string | null; requestId: string; locale: string; timezone: string; now: Date };
export type ToolSourceMetadata = { canonicalService: string; deterministic: true; tenantScoped: true };
export type ToolResult<T = unknown> = { toolName: string; toolVersion: string; success: true; data: T; summary: string; sourceMetadata: ToolSourceMetadata; warnings: string[]; executedAt: string; durationMs: number; traceId: string };

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string; version: string; description: string; category: string; mode: 'READ'; confirmationTier: 0; permission: string | null;
  inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>;
  inputValidator: z.ZodType<I>; outputValidator: z.ZodType<O>;
  canonicalService: string;
  execute(context: ToolContext, input: I): Promise<{ data: O; summary: string; warnings?: string[] }>;
}
