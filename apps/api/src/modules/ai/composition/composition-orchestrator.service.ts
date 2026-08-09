import { ConflictException, Injectable, Optional } from '@nestjs/common';
import { AIActionRunStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PreparedAssistantRequest, StructuredAssistantPersistence } from '../assistant/structured-assistant.persistence';
import {
  AssistantActorContext,
  StructuredAssistantRequest,
  StructuredAssistantResponse,
} from '../assistant/structured-assistant.types';
import { JsonValue } from '../domain/canonical-json';
import { PlannerService } from '../planner/planner.service';
import { BusinessExecutionPlan } from '../planner/planner.types';
import { telem } from '../telemetry/telemetry-hooks';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter.service';
import { CompositionService } from './composition.service';
import {
  COMPOSITION_CANCEL_ID,
  COMPOSITION_SEARCH_ID,
  CompositionStateRecord,
  compositionCreateSentinel,
  hashParentDraft,
} from './composition.types';

const EXECUTABLE_WRITES = new Set([
  'REGISTER_SALE',
  'REGISTER_RECEIVABLE_PAYMENT',
  'REGISTER_PAYABLE_PAYMENT',
  'REGISTER_TREASURY_TRANSFER',
  'REGISTER_EXPENSE',
  'REGISTER_PURCHASE',
  'CREATE_CLIENT',
  'UPDATE_CLIENT',
]);

export type CompositionResumeResult = {
  parentResponse: StructuredAssistantResponse;
  workspaceVersion: number;
  parentCapability: string;
  compositionIdHash: string;
};

@Injectable()
export class CompositionOrchestrator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly composition: CompositionService,
    private readonly planner: PlannerService,
    private readonly persistence: StructuredAssistantPersistence,
    @Optional() private readonly telemetry?: TelemetryEmitter,
  ) {}

  read(resolvedContext: unknown): CompositionStateRecord | null {
    return this.composition.readComposition(resolvedContext);
  }

  async loadActive(args: {
    tenantId: string;
    userId: string;
    workspaceId: string;
  }): Promise<{ composition: CompositionStateRecord | null; version: number; resolvedContext: unknown }> {
    return this.composition.loadComposition(args);
  }

  dependencyPickerItems(query: string): Array<Record<string, JsonValue>> {
    const name = query.slice(0, 80);
    return [
      {
        id: compositionCreateSentinel(name),
        label: `Crear cliente «${name}»`,
        name,
        compositionAction: 'CREATE_CLIENT',
      },
      {
        id: COMPOSITION_SEARCH_ID,
        label: 'Buscar otro cliente',
        name: 'Buscar otro cliente',
        compositionAction: 'SEARCH',
      },
      {
        id: COMPOSITION_CANCEL_ID,
        label: 'Cancelar',
        name: 'Cancelar',
        compositionAction: 'CANCEL',
      },
    ];
  }

  async pausePurchaseSellerMissing(args: {
    actor: AssistantActorContext;
    prepared: PreparedAssistantRequest;
    requestId: string;
    traceId: string;
    entities: Record<string, JsonValue>;
    query: string;
    message: string;
  }): Promise<{ response: StructuredAssistantResponse; workspaceVersion: number }> {
    const { composition, workspaceVersion } = await this.composition.pauseForMissingClient({
      tenantId: args.actor.tenantId,
      userId: args.actor.userId,
      workspaceId: args.prepared.workspaceId,
      expectedVersion: args.prepared.workspaceVersion,
      parentCapability: 'REGISTER_PURCHASE',
      dependencyReason: 'PURCHASE_SELLER',
      dependencyQuery: args.query,
      parentDraftEntities: args.entities,
    });
    telem(this.telemetry, {
      event: 'ClarificationShown',
      tenantId: args.actor.tenantId,
      conversationId: args.prepared.conversationId,
      requestId: args.requestId,
      capability: 'REGISTER_PURCHASE',
      clarificationType: 'ENTITY_AMBIGUITY',
      clarificationReason: 'composition_purchase_seller',
      candidateCount: 3,
      entityPickerUsed: true,
    });
    const response: StructuredAssistantResponse = {
      requestId: args.requestId,
      conversationId: args.prepared.conversationId,
      workspaceId: args.prepared.workspaceId,
      interactionState: 'NEEDS_DISAMBIGUATION',
      responseType: 'ENTITY_PICKER',
      payload: {
        message: args.message,
        entityType: 'CLIENT',
        data: { items: this.dependencyPickerItems(args.query) },
        unchanged: 'No se ejecutó ninguna acción.',
        nextAction: 'Elige crear el cliente, buscar otro, o cancelar.',
        composition: {
          compositionIdHash: hashId(composition.compositionId),
          parentCapability: 'REGISTER_PURCHASE',
          dependencyReason: 'PURCHASE_SELLER',
          state: composition.state,
        },
      },
      warnings: [],
      suggestedActions: [],
      traceId: args.traceId,
      createdAt: new Date().toISOString(),
    };
    return { response, workspaceVersion };
  }

  async pauseSaleCustomerMissing(args: {
    actor: AssistantActorContext;
    prepared: PreparedAssistantRequest;
    requestId: string;
    traceId: string;
    entities: Record<string, JsonValue>;
    query: string;
    message: string;
  }): Promise<{ response: StructuredAssistantResponse; workspaceVersion: number }> {
    const { composition, workspaceVersion } = await this.composition.pauseForMissingClient({
      tenantId: args.actor.tenantId,
      userId: args.actor.userId,
      workspaceId: args.prepared.workspaceId,
      expectedVersion: args.prepared.workspaceVersion,
      parentCapability: 'REGISTER_SALE',
      dependencyReason: 'SALE_CUSTOMER',
      dependencyQuery: args.query,
      parentDraftEntities: args.entities,
    });
    telem(this.telemetry, {
      event: 'ClarificationShown',
      tenantId: args.actor.tenantId,
      conversationId: args.prepared.conversationId,
      requestId: args.requestId,
      capability: 'REGISTER_SALE',
      clarificationType: 'ENTITY_AMBIGUITY',
      clarificationReason: 'composition_sale_customer',
      candidateCount: 3,
      entityPickerUsed: true,
    });
    const response: StructuredAssistantResponse = {
      requestId: args.requestId,
      conversationId: args.prepared.conversationId,
      workspaceId: args.prepared.workspaceId,
      interactionState: 'NEEDS_DISAMBIGUATION',
      responseType: 'ENTITY_PICKER',
      payload: {
        message: args.message,
        entityType: 'CLIENT',
        data: { items: this.dependencyPickerItems(args.query) },
        unchanged: 'No se ejecutó ninguna acción.',
        nextAction: 'Elige crear el cliente, buscar otro, o cancelar.',
        composition: {
          compositionIdHash: hashId(composition.compositionId),
          parentCapability: 'REGISTER_SALE',
          dependencyReason: 'SALE_CUSTOMER',
          state: composition.state,
        },
      },
      warnings: [],
      suggestedActions: [],
      traceId: args.traceId,
      createdAt: new Date().toISOString(),
    };
    return { response, workspaceVersion };
  }

  async attachChildPreview(args: {
    tenantId: string;
    userId: string;
    workspaceId: string;
    expectedVersion: number;
    childActionRunId: string;
  }): Promise<number> {
    return this.composition.attachChildActionRun(args);
  }

  /**
   * After CREATE_CLIENT mutation succeeds (or existing Client chosen):
   * bind trusted clientId and rebuild parent preview (does NOT execute parent).
   */
  async resumeParentAfterClient(args: {
    actor: AssistantActorContext;
    requestId: string;
    traceId: string;
    workspaceId: string;
    conversationId: string;
    expectedVersion: number;
    clientId: string;
    clientLabel: string;
    kind: 'CLIENT_CREATED' | 'CLIENT_REUSED';
    childActionRunId?: string;
  }): Promise<CompositionResumeResult | { kind: 'PARTIAL'; message: string; workspaceVersion: number }> {
    const satisfied = await this.composition.satisfyDependency({
      tenantId: args.actor.tenantId,
      userId: args.actor.userId,
      workspaceId: args.workspaceId,
      expectedVersion: args.expectedVersion,
      clientId: args.clientId,
      clientLabel: args.clientLabel,
      kind: args.kind,
      childActionRunId: args.childActionRunId,
    });
    return this.checkpointResumedParent({
      actor: args.actor,
      requestId: args.requestId,
      traceId: args.traceId,
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      expectedVersion: satisfied.workspaceVersion,
      composition: satisfied.composition,
      clientCreatedNote:
        args.kind === 'CLIENT_CREATED'
          ? `Listo. ${args.clientLabel} quedó creado. Ahora continúo con ${
              satisfied.composition.parentCapability === 'REGISTER_PURCHASE' ? 'la compra' : 'la venta'
            }.`
          : `Perfecto. Usaré a ${args.clientLabel}. Continúo con ${
              satisfied.composition.parentCapability === 'REGISTER_PURCHASE' ? 'la compra' : 'la venta'
            }.`,
    });
  }

  /**
   * Crash recovery: child ActionRun COMPLETED but parent not yet previewed.
   */
  async recoverPendingResume(args: {
    actor: AssistantActorContext;
    requestId: string;
    traceId: string;
    workspaceId: string;
    conversationId: string;
    expectedVersion: number;
    resolvedContext: unknown;
  }): Promise<CompositionResumeResult | null> {
    const composition = this.composition.readComposition(args.resolvedContext);
    if (!composition || composition.state === 'CANCELLED') return null;

    if (
      composition.resolvedClientId &&
      (composition.state === 'DEPENDENCY_COMPLETED' || composition.state === 'PRIMARY_RESUMING')
    ) {
      return this.checkpointResumedParent({
        actor: args.actor,
        requestId: args.requestId,
        traceId: args.traceId,
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        expectedVersion: args.expectedVersion,
        composition,
        clientCreatedNote:
          composition.resolvedKind === 'CLIENT_CREATED'
            ? `El cliente quedó creado. Continúo con ${
                composition.parentCapability === 'REGISTER_PURCHASE' ? 'la compra' : 'la venta'
              }.`
            : `Continúo con ${
                composition.parentCapability === 'REGISTER_PURCHASE' ? 'la compra' : 'la venta'
              }.`,
      }).then((r) => (r && 'parentResponse' in r ? r : null));
    }

    if (!composition.childActionRunId || composition.resolvedClientId) return null;

    const child = await this.prisma.aIActionRun.findFirst({
      where: {
        id: composition.childActionRunId,
        tenantId: args.actor.tenantId,
        conversationId: args.conversationId,
        intent: 'CREATE_CLIENT',
        status: AIActionRunStatus.COMPLETED,
      },
      select: { id: true, result: true },
    });
    if (!child) return null;
    const receipt = extractClientReceipt(child.result);
    if (!receipt) return null;

    const resumed = await this.resumeParentAfterClient({
      actor: args.actor,
      requestId: args.requestId,
      traceId: args.traceId,
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      expectedVersion: args.expectedVersion,
      clientId: receipt.clientId,
      clientLabel: receipt.name,
      kind: 'CLIENT_CREATED',
      childActionRunId: child.id,
    });
    return 'parentResponse' in resumed ? resumed : null;
  }

  async cancelComposition(args: {
    tenantId: string;
    userId: string;
    workspaceId: string;
    expectedVersion: number;
  }): Promise<number> {
    return this.composition.cancel(args);
  }

  private async checkpointResumedParent(args: {
    actor: AssistantActorContext;
    requestId: string;
    traceId: string;
    workspaceId: string;
    conversationId: string;
    expectedVersion: number;
    composition: CompositionStateRecord;
    clientCreatedNote: string;
  }): Promise<CompositionResumeResult | { kind: 'PARTIAL'; message: string; workspaceVersion: number }> {
    try {
      const resumed = await this.composition.markResuming({
        tenantId: args.actor.tenantId,
        userId: args.actor.userId,
        workspaceId: args.workspaceId,
        expectedVersion: args.expectedVersion,
      });
      const entities = this.composition.buildResumedParentEntities(resumed.composition);
      const draftHash = hashParentDraft(resumed.composition.parentDraftEntities as Record<string, JsonValue>);
      if (draftHash !== resumed.composition.parentDraftHash) {
        throw new ConflictException('Parent draft hash mismatch');
      }

      const plan = this.planner.plan(
        { intent: resumed.composition.parentCapability, entities },
        { workspaceVersion: resumed.workspaceVersion, entityVersions: {} },
      );

      const compositionIdHash = hashId(resumed.composition.compositionId);
      const prepared: PreparedAssistantRequest = {
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
        workspaceVersion: resumed.workspaceVersion,
      };
      const input: StructuredAssistantRequest = {
        intent: resumed.composition.parentCapability,
        entities,
        surface: 'API',
        clientRequestId: `composition-resume-${resumed.composition.compositionId}`,
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
      };

      let checkpoint: { actionRun: { id: string }; workspaceVersion: number };
      try {
        checkpoint = await this.persistence.checkpointCompositionParent(
          args.actor,
          prepared,
          input,
          plan,
          {
            compositionIdHash,
            childActionRunId: resumed.composition.childActionRunId,
            dependencyReason: resumed.composition.dependencyReason,
          },
        );
      } catch (error) {
        // Idempotent resume: same composition parent fingerprint already checkpointed.
        const existing = await this.prisma.aIActionRun.findFirst({
          where: {
            tenantId: args.actor.tenantId,
            conversationId: args.conversationId,
            intent: resumed.composition.parentCapability,
            idempotencyKey: `composition-parent:${compositionIdHash}:${plan.fingerprint.slice(0, 24)}`,
          },
          select: { id: true },
        });
        if (!existing) throw error;
        const version = await this.persistence.currentWorkspaceVersion(
          args.actor,
          args.workspaceId,
        );
        checkpoint = { actionRun: existing, workspaceVersion: version };
      }

      // Clear composition after parent preview is durable — prevents duplicate resume.
      let workspaceVersion = checkpoint.workspaceVersion;
      try {
        workspaceVersion = await this.composition.clear({
          tenantId: args.actor.tenantId,
          userId: args.actor.userId,
          workspaceId: args.workspaceId,
          expectedVersion: checkpoint.workspaceVersion,
        });
      } catch {
        // Already cleared on a prior resume attempt.
        workspaceVersion = await this.persistence.currentWorkspaceVersion(
          args.actor,
          args.workspaceId,
        );
      }

      telem(this.telemetry, {
        event: 'PreviewShown',
        tenantId: args.actor.tenantId,
        conversationId: args.conversationId,
        requestId: args.requestId,
        actionRunId: checkpoint.actionRun.id,
        capability: plan.businessAction,
        shown: true,
        funnelStage: 'preview',
        meta: {
          compositionResume: true,
          compositionIdHash,
          dependencyReason: resumed.composition.dependencyReason,
        },
      });

      const parentResponse = this.parentPreviewResponse(
        args.requestId,
        args.traceId,
        prepared,
        checkpoint.actionRun.id,
        plan,
        args.clientCreatedNote,
      );

      return {
        parentResponse,
        workspaceVersion,
        parentCapability: plan.businessAction,
        compositionIdHash,
      };
    } catch (error) {
      const message =
        args.composition.resolvedKind === 'CLIENT_CREATED' || args.composition.resolvedClientId
          ? `El cliente quedó creado, pero todavía no registré ${
              args.composition.parentCapability === 'REGISTER_PURCHASE' ? 'la compra' : 'la venta'
            }.`
          : `Identifiqué al cliente, pero todavía no pude continuar con ${
              args.composition.parentCapability === 'REGISTER_PURCHASE' ? 'la compra' : 'la venta'
            }.`;
      return {
        kind: 'PARTIAL',
        message: `${message}${error instanceof Error ? ` (${error.message})` : ''}`,
        workspaceVersion: args.expectedVersion,
      };
    }
  }

  private parentPreviewResponse(
    requestId: string,
    traceId: string,
    prepared: PreparedAssistantRequest,
    actionRunId: string,
    plan: BusinessExecutionPlan,
    preface: string,
  ): StructuredAssistantResponse {
    const executable = EXECUTABLE_WRITES.has(plan.businessAction);
    const isPurchase = plan.businessAction === 'REGISTER_PURCHASE';
    if (plan.state === 'NEEDS_CLARIFICATION') {
      return {
        requestId,
        conversationId: prepared.conversationId,
        workspaceId: prepared.workspaceId,
        actionRunId,
        interactionState: 'NEEDS_INPUT',
        responseType: 'MISSING_FIELDS_CARD',
        payload: {
          title: 'Faltan datos para continuar',
          groups: [
            {
              id: 'required',
              label: 'Datos requeridos',
              fields: plan.missingEntities.map((item) => ({
                key: item.entity,
                question: item.question,
              })),
            },
          ],
          message: `${preface} Faltan algunos datos.`,
          unchanged: 'No se ejecutó la acción principal.',
          nextAction: 'Completa los campos indicados. La dependencia ya quedó resuelta.',
        },
        warnings: plan.warnings ?? [],
        suggestedActions: [],
        traceId,
        createdAt: new Date().toISOString(),
      };
    }
    return {
      requestId,
      conversationId: prepared.conversationId,
      workspaceId: prepared.workspaceId,
      actionRunId,
      interactionState: 'READY_FOR_CONFIRMATION',
      responseType: 'ACTION_PREVIEW_CARD',
      payload: {
        preview: plan.preview as unknown as JsonValue,
        planFingerprint: plan.fingerprint,
        executable,
        correctionPolicy: isPurchase
          ? 'Después de registrarla, cualquier corrección se realiza desde Inventario.'
          : 'Después de registrarla, cualquier corrección se realiza desde Ventas.',
        message: `${preface} Revisa el resumen y confirma para registrar ${
          isPurchase ? 'la compra' : 'la venta'
        }.`,
        unchanged: 'No se ejecutó ni modificó el registro principal todavía.',
        nextAction: isPurchase
          ? 'Confirma la compra para ejecutar el registro canónico.'
          : 'Confirma la venta para ejecutar el registro canónico.',
      },
      warnings: plan.warnings ?? [],
      suggestedActions: [],
      traceId,
      createdAt: new Date().toISOString(),
    };
  }
}

function hashId(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

function extractClientReceipt(result: Prisma.JsonValue | null): { clientId: string; name: string } | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const receipt = (result as Record<string, unknown>).receipt;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  const clientId = (receipt as Record<string, unknown>).clientId;
  const name = (receipt as Record<string, unknown>).name;
  if (typeof clientId !== 'string' || !clientId) return null;
  return { clientId, name: typeof name === 'string' && name ? name : 'Cliente' };
}
