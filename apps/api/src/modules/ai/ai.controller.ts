import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Res, UseGuards, Optional } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { ConversationService } from './conversation/conversation.service';
import { AppendMessageDto } from './dto/append-message.dto';
import { AssistantMessageDto } from './dto/assistant-message.dto';
import { PickerSelectionDto } from './dto/picker-selection.dto';
import { ConversationResetDto } from './dto/conversation-reset.dto';
import { CreateActionRunDto } from './dto/create-action-run.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ConfirmActionRunDto } from './dto/action-run-command.dto';
import { CreateWorkspaceDto, UpdateWorkspaceDto, WorkspaceVersionDto } from './dto/workspace.dto';
import { IntentAdapterRateLimitGuard } from './intent-adapter/rate-limit.guard';
import { NaturalLanguageAssistantService } from './intent-adapter/natural-language-assistant.service';
import { RuntimeService } from './runtime/runtime.service';
import { WorkspaceService } from './workspace/workspace.service';
import { StructuredAssistantRequestDto } from './dto/structured-assistant.dto';
import { StructuredAssistantService } from './assistant/structured-assistant.service';
import { structuredAssistantHttpStatus } from './assistant/assistant-http-status';
import { WriteCapabilityBindingRegistry } from './bindings/write-capability-binding-registry';
import { WritePlanRunner } from './bindings/write-plan-runner';
import { CompositionOrchestrator } from './composition/composition-orchestrator.service';
import { JsonValue } from './domain/canonical-json';
import { telem } from './telemetry/telemetry-hooks';
import { TelemetryEmitter } from './telemetry/telemetry-emitter.service';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AIController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly runtime: RuntimeService,
    private readonly workspaces: WorkspaceService,
    private readonly assistant: StructuredAssistantService,
    private readonly naturalLanguageAssistant: NaturalLanguageAssistantService,
    private readonly writeRegistry: WriteCapabilityBindingRegistry,
    private readonly writeRunner: WritePlanRunner,
    private readonly compositionOrchestrator: CompositionOrchestrator,
    @Optional() private readonly telemetry?: TelemetryEmitter,
  ) {}

  @Post('assistant/structured')
  async structuredAssistant(@CurrentUser() user: CurrentUserType, @Body() dto: StructuredAssistantRequestDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.assistant.execute({ tenantId: user.tenantId, userId: user.userId, role: user.role, permissions: [] }, dto);
    const status = structuredAssistantHttpStatus(result);
    if (status !== null) response.status(status);
    return result;
  }

  // Natural-language entry point. This route only ever: (1) durably claims
  // idempotency for the message, (2) calls IntentAdapterService to turn text
  // into a StructuredIntentCandidate, (3) hands a resulting
  // StructuredAssistantRequest to the SAME StructuredAssistantService used
  // above. It never calls a tool, capability binding, domain service, or
  // Prisma beyond its own idempotency/audit bookkeeping.
  @Post('assistant/message')
  @UseGuards(IntentAdapterRateLimitGuard)
  async assistantMessage(@CurrentUser() user: CurrentUserType, @Body() dto: AssistantMessageDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.naturalLanguageAssistant.handleMessage({ tenantId: user.tenantId, userId: user.userId, role: user.role, permissions: [] }, dto);
    const status = structuredAssistantHttpStatus(result.response);
    if (status !== null) response.status(status);
    return result;
  }

  // Structured picker-selection EVENT — never re-enters NLP/Claude/the
  // OperationalIntentRouter. The frontend already knows the selected
  // candidate's trusted id from the server's own last ENTITY_PICKER
  // response; this route resolves it against the durably-stored candidate
  // list and resumes the SAME planner/resolver pipeline with the surviving
  // Draft, merging in only the one newly-resolved slot.
  @Post('assistant/picker-selection')
  @UseGuards(IntentAdapterRateLimitGuard)
  async assistantPickerSelection(@CurrentUser() user: CurrentUserType, @Body() dto: PickerSelectionDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.naturalLanguageAssistant.handlePickerSelection({ tenantId: user.tenantId, userId: user.userId, role: user.role, permissions: [] }, dto);
    const status = structuredAssistantHttpStatus(result.response);
    if (status !== null) response.status(status);
    return result;
  }

  // "Empezar de nuevo" — Conversation Reset (V1 simplicity). Deliberately
  // NOT guarded by IntentAdapterRateLimitGuard: this never calls the
  // provider, so there is no LLM cost/quota to protect against. Pure
  // deterministic clear of the in-flight transaction only.
  @Post('assistant/reset')
  async assistantReset(@CurrentUser() user: CurrentUserType, @Body() dto: ConversationResetDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.naturalLanguageAssistant.resetConversation({ tenantId: user.tenantId, userId: user.userId, role: user.role, permissions: [] }, dto);
    const status = structuredAssistantHttpStatus(result.response);
    if (status !== null) response.status(status);
    return result;
  }

  @Post('conversations')
  createConversation(@CurrentUser() user: CurrentUserType, @Body() dto: CreateConversationDto) {
    return this.conversations.create(user.tenantId, user.userId, dto);
  }

  @Get('conversations/:id')
  getConversation(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.conversations.findOne(user.tenantId, id);
  }

  @Delete('conversations/:id')
  deleteConversation(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.conversations.softDelete(user.tenantId, user.userId, id);
  }

  @Post('messages')
  appendMessage(@CurrentUser() user: CurrentUserType, @Body() dto: AppendMessageDto) {
    return this.conversations.appendMessage(user.tenantId, user.userId, dto);
  }

  @Post('action-runs')
  createActionRun(@CurrentUser() user: CurrentUserType, @Body() dto: CreateActionRunDto) {
    return this.runtime.create(user.tenantId, user.userId, dto);
  }

  @Get('action-runs/:id')
  getActionRun(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.runtime.findOne(user.tenantId, id);
  }

  @Post('action-runs/:id/confirm')
  async confirmActionRun(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: ConfirmActionRunDto) {
    const run = await this.runtime.findOne(user.tenantId, id);
    if (this.writeRegistry.hasBinding(run.intent)) {
      // Bound WRITE: atomic confirm + canonical execution for ONE capability only.
      // Composition V1 may then resume a parked parent preview (second confirmation still required).
      const result = await this.writeRunner.confirmAndExecute({
        tenantId: user.tenantId,
        userId: user.userId,
        actionRunId: id,
        expectedFingerprint: dto.planFingerprint,
        role: user.role,
        permissions: [],
      });
      if (
        run.intent === 'CREATE_CLIENT' &&
        (result.executionState === 'EXECUTED' || result.executionState === 'REPLAYED')
      ) {
        const client = extractCreatedClient(result.receipt);
        const workspace = client
          ? await this.workspaces.findForConversation(user.tenantId, user.userId, run.conversationId)
          : null;
        if (client && workspace) {
          const active = await this.compositionOrchestrator.loadActive({
            tenantId: user.tenantId,
            userId: user.userId,
            workspaceId: workspace.id,
          });
          if (
            active.composition &&
            active.composition.state !== 'CANCELLED' &&
            (!active.composition.childActionRunId ||
              active.composition.childActionRunId === id ||
              Boolean(active.composition.resolvedClientId))
          ) {
            const resumed = await this.compositionOrchestrator.resumeParentAfterClient({
              actor: {
                tenantId: user.tenantId,
                userId: user.userId,
                role: user.role,
                permissions: [],
              },
              requestId: `confirm-resume:${id}`,
              traceId: `trace:${id}`,
              workspaceId: workspace.id,
              conversationId: run.conversationId,
              expectedVersion: active.version,
              clientId: client.clientId,
              clientLabel: client.name,
              kind: 'CLIENT_CREATED',
              childActionRunId: id,
            });
            if ('parentResponse' in resumed) {
              return {
                ...result,
                message: `${result.message} ${String(resumed.parentResponse.payload.message ?? '')}`.trim(),
                interactionState: resumed.parentResponse.interactionState,
                responseType: resumed.parentResponse.responseType,
                compositionResume: {
                  ...resumed.parentResponse,
                  parentCapability: resumed.parentCapability,
                  compositionIdHash: resumed.compositionIdHash,
                },
                actionRun: {
                  ...result.actionRun,
                  id: resumed.parentResponse.actionRunId ?? result.actionRun.id,
                },
                planFingerprint:
                  typeof resumed.parentResponse.payload.planFingerprint === 'string'
                    ? resumed.parentResponse.payload.planFingerprint
                    : result.planFingerprint,
                capability: resumed.parentCapability,
                receipt: result.receipt,
              };
            }
            return {
              ...result,
              message: resumed.message,
            };
          }
        }
      }
      return result;
    }
    // Unbound write intents fail closed — confirmation must not imply execution.
    if (run.requiresConfirmation) {
      throw new ForbiddenException(
        'This write capability is not bound for conversational execution',
      );
    }
    return this.runtime.confirm(user.tenantId, user.userId, id, dto.planFingerprint);
  }

  @Post('action-runs/:id/cancel')
  async cancelActionRun(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    const run = await this.runtime.findOne(user.tenantId, id);
    const cancelled = await this.runtime.cancel(user.tenantId, user.userId, id);
    const wasPreview = run.status === 'READY_FOR_CONFIRMATION';
    const wasClarification = run.status === 'NEEDS_CLARIFICATION';
    if (wasPreview) {
      telem(this.telemetry, {
        event: 'PreviewCancelled',
        tenantId: user.tenantId,
        conversationId: run.conversationId,
        actionRunId: id,
        capability: run.intent,
        cancelled: true,
        outcome: 'CANCELLED',
      });
    }
    if (wasClarification) {
      telem(this.telemetry, {
        event: 'ClarificationAbandoned',
        tenantId: user.tenantId,
        conversationId: run.conversationId,
        actionRunId: id,
        capability: run.intent,
        abandoned: true,
        outcome: 'ABANDONED',
      });
    }
    telem(this.telemetry, {
      event: 'ConversationFinished',
      tenantId: user.tenantId,
      conversationId: run.conversationId,
      actionRunId: id,
      capability: run.intent,
      outcome: wasClarification ? 'ABANDONED' : 'CANCELLED',
    });
    return cancelled;
  }

  @Post('workspaces')
  createWorkspace(@CurrentUser() user: CurrentUserType, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user.tenantId, user.userId, dto);
  }

  @Get('workspaces/:id')
  resumeWorkspace(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.workspaces.resume(user.tenantId, user.userId, id);
  }

  @Patch('workspaces/:id')
  updateWorkspace(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: UpdateWorkspaceDto) {
    return this.workspaces.update(user.tenantId, user.userId, id, dto);
  }

  @Post('workspaces/:id/reset')
  resetWorkspace(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: WorkspaceVersionDto) {
    return this.workspaces.reset(user.tenantId, user.userId, id, dto.expectedVersion);
  }

  @Delete('workspaces/:id')
  deleteWorkspace(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: WorkspaceVersionDto) {
    return this.workspaces.softDelete(user.tenantId, user.userId, id, dto.expectedVersion);
  }
}

function extractCreatedClient(receipt: JsonValue | null | undefined): { clientId: string; name: string } | null {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  const clientId = (receipt as Record<string, unknown>).clientId;
  const name = (receipt as Record<string, unknown>).name;
  if (typeof clientId !== 'string' || !clientId) return null;
  return { clientId, name: typeof name === 'string' && name ? name : 'Cliente' };
}
