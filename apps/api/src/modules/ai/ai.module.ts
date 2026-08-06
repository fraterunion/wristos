import { Module } from '@nestjs/common';
import { AIController } from './ai.controller';
import { AuditService } from './audit/audit.service';
import { ConversationService } from './conversation/conversation.service';
import { RuntimeService } from './runtime/runtime.service';
import { AUDIT_STORE, CONVERSATION_STORE, RUNTIME_STORE, WORKSPACE_STORE } from './types/store-contracts';
import { WorkspaceService } from './workspace/workspace.service';

@Module({
  controllers: [AIController],
  providers: [
    AuditService,
    ConversationService,
    RuntimeService,
    WorkspaceService,
    { provide: AUDIT_STORE, useExisting: AuditService },
    { provide: CONVERSATION_STORE, useExisting: ConversationService },
    { provide: RUNTIME_STORE, useExisting: RuntimeService },
    { provide: WORKSPACE_STORE, useExisting: WorkspaceService },
  ],
  exports: [AUDIT_STORE, CONVERSATION_STORE, RUNTIME_STORE, WORKSPACE_STORE, RuntimeService],
})
export class AIModule {}
