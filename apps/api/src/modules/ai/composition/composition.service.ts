import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  parseResolvedContextShell,
  ResolvedContextShell,
} from '../context/working-context';
import { JsonValue } from '../domain/canonical-json';
import {
  CompositionDependencyReason,
  CompositionParentCapability,
  CompositionStateRecord,
  compositionStateSchema,
  hashParentDraft,
  isAllowedCompositionEdge,
  newCompositionId,
} from './composition.types';

const DRAFT_DENY = /email|phone|notes?|password|secret|token/i;

function sanitizeDraft(entities: Record<string, JsonValue>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(entities)) {
    if (DRAFT_DENY.test(key)) continue;
    // Never park provider-claimed client ids as trusted.
    if (key === 'clientId' || key === 'sellerClientId' || key === 'customerId') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    }
  }
  return out;
}

@Injectable()
export class CompositionService {
  constructor(private readonly prisma: PrismaService) {}

  readComposition(resolvedContext: unknown): CompositionStateRecord | null {
    const shell = parseResolvedContextShell(resolvedContext);
    const raw = (shell as ResolvedContextShell & { composition?: unknown }).composition;
    if (!raw) return null;
    const parsed = compositionStateSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async loadComposition(args: {
    tenantId: string;
    userId: string;
    workspaceId: string;
  }): Promise<{ composition: CompositionStateRecord | null; version: number; resolvedContext: unknown }> {
    const workspace = await this.loadWorkspace(args);
    return {
      composition: this.readComposition(workspace.resolvedContext),
      version: workspace.version,
      resolvedContext: workspace.resolvedContext,
    };
  }

  withComposition(
    resolvedContext: unknown,
    composition: CompositionStateRecord | null,
  ): ResolvedContextShell {
    const shell = parseResolvedContextShell(resolvedContext);
    if (!composition) {
      const { composition: _drop, ...rest } = shell as ResolvedContextShell & {
        composition?: unknown;
      };
      return rest;
    }
    return { ...shell, composition };
  }

  /**
   * Park a parent write draft and enter DEPENDENCY_REQUIRED.
   * Does NOT create a parent ActionRun — parent ActionRun is created only on resume preview.
   */
  async pauseForMissingClient(args: {
    tenantId: string;
    userId: string;
    workspaceId: string;
    expectedVersion: number;
    parentCapability: CompositionParentCapability;
    dependencyReason: CompositionDependencyReason;
    dependencyQuery: string;
    parentDraftEntities: Record<string, JsonValue>;
  }): Promise<{ composition: CompositionStateRecord; workspaceVersion: number }> {
    if (!isAllowedCompositionEdge(args.parentCapability, args.dependencyReason, 'CREATE_CLIENT')) {
      throw new ConflictException('Composition edge is not allowlisted');
    }
    const draft = sanitizeDraft(args.parentDraftEntities);
    const now = new Date().toISOString();
    const composition: CompositionStateRecord = {
      schemaVersion: '1.0',
      compositionId: newCompositionId(),
      state: 'DEPENDENCY_REQUIRED',
      parentCapability: args.parentCapability,
      dependencyReason: args.dependencyReason,
      dependencyQuery: args.dependencyQuery.slice(0, 160),
      parentDraftEntities: draft,
      parentDraftHash: hashParentDraft(draft as Record<string, JsonValue>),
      childCapability: 'CREATE_CLIENT',
      createdAt: now,
      updatedAt: now,
    };
    const version = await this.persistComposition(
      args.tenantId,
      args.userId,
      args.workspaceId,
      args.expectedVersion,
      composition,
      { clearActiveActionRun: true },
    );
    return { composition, workspaceVersion: version };
  }

  async attachChildActionRun(args: {
    tenantId: string;
    userId: string;
    workspaceId: string;
    expectedVersion: number;
    childActionRunId: string;
  }): Promise<number> {
    const workspace = await this.loadWorkspace(args);
    const composition = this.readComposition(workspace.resolvedContext);
    if (!composition || composition.state === 'CANCELLED') {
      throw new ConflictException('No active composition to attach child ActionRun');
    }
    const next: CompositionStateRecord = {
      ...composition,
      state: 'DEPENDENCY_PREVIEW',
      childActionRunId: args.childActionRunId,
      updatedAt: new Date().toISOString(),
    };
    return this.persistComposition(
      args.tenantId,
      args.userId,
      args.workspaceId,
      args.expectedVersion,
      next,
    );
  }

  async markChildExecuting(args: {
    tenantId: string;
    userId: string;
    workspaceId: string;
    expectedVersion: number;
    childActionRunId: string;
  }): Promise<number> {
    const workspace = await this.loadWorkspace(args);
    const composition = this.readComposition(workspace.resolvedContext);
    if (!composition || composition.childActionRunId !== args.childActionRunId) {
      return args.expectedVersion;
    }
    const next: CompositionStateRecord = {
      ...composition,
      state: 'DEPENDENCY_EXECUTING',
      updatedAt: new Date().toISOString(),
    };
    return this.persistComposition(
      args.tenantId,
      args.userId,
      args.workspaceId,
      args.expectedVersion,
      next,
    );
  }

  /**
   * After CREATE_CLIENT completes (or existing Client chosen), bind trusted clientId
   * and prepare PRIMARY_RESUMING. Caller must replan parent with trusted id.
   */
  async satisfyDependency(args: {
    tenantId: string;
    userId: string;
    workspaceId: string;
    expectedVersion: number;
    clientId: string;
    clientLabel: string;
    kind: 'CLIENT_CREATED' | 'CLIENT_REUSED';
    childActionRunId?: string;
  }): Promise<{ composition: CompositionStateRecord; workspaceVersion: number }> {
    const workspace = await this.loadWorkspace(args);
    const composition = this.readComposition(workspace.resolvedContext);
    if (!composition || composition.state === 'CANCELLED') {
      throw new ConflictException('No active composition for dependency handoff');
    }
    // Verify Client is live in tenant — never trust provider.
    const client = await this.prisma.client.findFirst({
      where: { id: args.clientId, tenantId: args.tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!client) throw new ConflictException('Resolved composition Client is not available');

    const next: CompositionStateRecord = {
      ...composition,
      state: 'DEPENDENCY_COMPLETED',
      resolvedClientId: client.id,
      resolvedClientLabel: (args.clientLabel || client.name).slice(0, 160),
      resolvedKind: args.kind,
      childActionRunId: args.childActionRunId ?? composition.childActionRunId,
      updatedAt: new Date().toISOString(),
    };
    const version = await this.persistComposition(
      args.tenantId,
      args.userId,
      args.workspaceId,
      args.expectedVersion,
      next,
    );
    return { composition: next, workspaceVersion: version };
  }

  /** Build parent entities for resume — injects trusted Client into the right slot. */
  buildResumedParentEntities(composition: CompositionStateRecord): Record<string, JsonValue> {
    const base = { ...composition.parentDraftEntities } as Record<string, JsonValue>;
    if (!composition.resolvedClientId) {
      throw new ConflictException('Composition dependency is not satisfied');
    }
    if (composition.dependencyReason === 'PURCHASE_SELLER') {
      base.sellerClientId = composition.resolvedClientId;
      base.sellerLabel = composition.resolvedClientLabel ?? 'Cliente';
      base.sellerCounterpartyName = composition.resolvedClientLabel ?? 'Cliente';
      delete base.sellerUnlinked;
      delete base.sellerFallbackNote;
      delete base.sellerQuery;
    } else if (composition.dependencyReason === 'SALE_CUSTOMER') {
      base.customerId = composition.resolvedClientId;
      base.customerName = composition.resolvedClientLabel ?? 'Cliente';
      delete base.customerQuery;
    }
    return base;
  }

  async markResuming(args: {
    tenantId: string;
    userId: string;
    workspaceId: string;
    expectedVersion: number;
  }): Promise<{ composition: CompositionStateRecord; workspaceVersion: number }> {
    const workspace = await this.loadWorkspace(args);
    const composition = this.readComposition(workspace.resolvedContext);
    if (!composition || composition.state !== 'DEPENDENCY_COMPLETED') {
      throw new ConflictException('Composition is not ready to resume parent');
    }
    const next: CompositionStateRecord = {
      ...composition,
      state: 'PRIMARY_RESUMING',
      updatedAt: new Date().toISOString(),
    };
    const version = await this.persistComposition(
      args.tenantId,
      args.userId,
      args.workspaceId,
      args.expectedVersion,
      next,
    );
    return { composition: next, workspaceVersion: version };
  }

  /** Clear composition after parent preview is checkpointed or cancelled. */
  async clear(args: {
    tenantId: string;
    userId: string;
    workspaceId: string;
    expectedVersion: number;
  }): Promise<number> {
    return this.persistComposition(
      args.tenantId,
      args.userId,
      args.workspaceId,
      args.expectedVersion,
      null,
    );
  }

  async cancel(args: {
    tenantId: string;
    userId: string;
    workspaceId: string;
    expectedVersion: number;
  }): Promise<number> {
    const workspace = await this.loadWorkspace(args);
    const composition = this.readComposition(workspace.resolvedContext);
    if (!composition) return args.expectedVersion;
    const next: CompositionStateRecord = {
      ...composition,
      state: 'CANCELLED',
      updatedAt: new Date().toISOString(),
    };
    return this.persistComposition(
      args.tenantId,
      args.userId,
      args.workspaceId,
      args.expectedVersion,
      next,
      { clearActiveActionRun: true },
    );
  }

  private async loadWorkspace(args: {
    tenantId: string;
    userId: string;
    workspaceId: string;
  }) {
    const workspace = await this.prisma.aIWorkspace.findFirst({
      where: {
        id: args.workspaceId,
        tenantId: args.tenantId,
        userId: args.userId,
        deletedAt: null,
      },
    });
    if (!workspace) throw new ConflictException('AI workspace not found');
    return workspace;
  }

  private async persistComposition(
    tenantId: string,
    userId: string,
    workspaceId: string,
    expectedVersion: number,
    composition: CompositionStateRecord | null,
    opts?: { clearActiveActionRun?: boolean },
  ): Promise<number> {
    const workspace = await this.prisma.aIWorkspace.findFirst({
      where: { id: workspaceId, tenantId, userId, deletedAt: null },
      select: { resolvedContext: true, version: true },
    });
    if (!workspace) throw new ConflictException('AI workspace not found');
    if (workspace.version !== expectedVersion) {
      throw new ConflictException('AI workspace version is stale');
    }
    const resolvedContext = this.withComposition(workspace.resolvedContext, composition);
    const changed = await this.prisma.aIWorkspace.updateMany({
      where: { id: workspaceId, tenantId, userId, version: expectedVersion, deletedAt: null },
      data: {
        resolvedContext: resolvedContext as Prisma.InputJsonObject,
        ...(opts?.clearActiveActionRun ? { activeActionRunId: null } : {}),
        version: { increment: 1 },
        lastActivityAt: new Date(),
      },
    });
    if (changed.count !== 1) throw new ConflictException('AI workspace version is stale');
    return expectedVersion + 1;
  }
}
