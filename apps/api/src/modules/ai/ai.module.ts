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
import { BusinessActionCatalog } from './planner/actions/business-action-catalog';
import { PlannerService } from './planner/planner.service';
import { BusinessCapabilityCatalog } from './planner/capabilities/business-capability-catalog';
import { CapabilityBindingRegistry } from './bindings/capability-binding-registry';
import { CapabilityBindingService } from './bindings/capability-binding.service';
import { ReadPlanRunner } from './bindings/read-plan-runner';
import { AIRequestService } from './assistant/ai-request.service';
import { StructuredAssistantPersistence } from './assistant/structured-assistant.persistence';
import { StructuredAssistantService } from './assistant/structured-assistant.service';

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
    BusinessActionCatalog,
    BusinessCapabilityCatalog,
    PlannerService,
    CapabilityBindingRegistry,
    CapabilityBindingService,
    ReadPlanRunner,
    AIRequestService,
    StructuredAssistantPersistence,
    StructuredAssistantService,
    { provide: AUDIT_STORE, useExisting: AuditService },
    { provide: CONVERSATION_STORE, useExisting: ConversationService },
    { provide: RUNTIME_STORE, useExisting: RuntimeService },
    { provide: WORKSPACE_STORE, useExisting: WorkspaceService },
  ],
  exports: [AUDIT_STORE, CONVERSATION_STORE, RUNTIME_STORE, WORKSPACE_STORE, RuntimeService, ToolRegistry, ToolExecutionService, BusinessActionCatalog, BusinessCapabilityCatalog, PlannerService, CapabilityBindingRegistry, CapabilityBindingService, ReadPlanRunner, AIRequestService, StructuredAssistantService],
})
export class AIModule {}
