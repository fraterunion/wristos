import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CrmModule } from '../crm/crm.module';
import { CuentasModule } from '../cuentas/cuentas.module';
import { HistoryModule } from '../history/history.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AIController } from './ai.controller';
import { AuditService } from './audit/audit.service';
import { ConversationService } from './conversation/conversation.service';
import { RuntimeService } from './runtime/runtime.service';
import { AUDIT_STORE, CONVERSATION_STORE, RUNTIME_STORE, WORKSPACE_STORE } from './types/store-contracts';
import { WorkspaceService } from './workspace/workspace.service';
import { ToolExecutionService } from './tools/tool-execution.service';
import { ToolRegistry } from './tools/tool-registry';

@Module({
  imports: [AnalyticsModule, InventoryModule, CrmModule, CuentasModule, HistoryModule],
  controllers: [AIController],
  providers: [
    AuditService,
    ConversationService,
    RuntimeService,
    WorkspaceService,
    ToolRegistry,
    ToolExecutionService,
    { provide: AUDIT_STORE, useExisting: AuditService },
    { provide: CONVERSATION_STORE, useExisting: ConversationService },
    { provide: RUNTIME_STORE, useExisting: RuntimeService },
    { provide: WORKSPACE_STORE, useExisting: WorkspaceService },
  ],
  exports: [AUDIT_STORE, CONVERSATION_STORE, RUNTIME_STORE, WORKSPACE_STORE, RuntimeService, ToolRegistry, ToolExecutionService],
})
export class AIModule {}
