import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/types/current-user.type';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { ConversationService } from './conversation/conversation.service';
import { AppendMessageDto } from './dto/append-message.dto';
import { AssistantMessageDto } from './dto/assistant-message.dto';
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
      // Bound WRITE (REGISTER_SALE | REGISTER_RECEIVABLE_PAYMENT | REGISTER_EXPENSE): atomic confirm + canonical execution.
      // Client never sets EXECUTING/COMPLETED — server owns the lifecycle.
      return this.writeRunner.confirmAndExecute({
        tenantId: user.tenantId,
        userId: user.userId,
        actionRunId: id,
        expectedFingerprint: dto.planFingerprint,
        role: user.role,
        permissions: [],
      });
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
  cancelActionRun(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.runtime.cancel(user.tenantId, user.userId, id);
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
