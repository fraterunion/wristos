import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CrmModule } from '../crm/crm.module';
import { CuentasModule } from '../cuentas/cuentas.module';
import { DealsModule } from '../deals/deals.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { HistoryModule } from '../history/history.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CapitalModule } from '../capital/capital.module';
import { TreasuryModule } from '../treasury/treasury.module';
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
import { PayablePaymentEntityResolver } from './bindings/write/payable-payment-entity-resolver.service';
import { ReceivablePaymentEntityResolver } from './bindings/write/receivable-payment-entity-resolver.service';
import { RegisterPayablePaymentWriteBinding } from './bindings/write/register-payable-payment.binding';
import { RegisterTreasuryTransferWriteBinding } from './bindings/write/register-treasury-transfer.binding';
import { CapitalInvestorEntityResolver } from './bindings/write/capital-investor-entity-resolver.service';
import { CreateClientEntityResolver } from './bindings/write/create-client-entity-resolver.service';
import { CreateClientWriteBinding } from './bindings/write/create-client.binding';
import { CreateManualAccountEntityResolver } from './bindings/write/create-manual-account-entity-resolver.service';
import { CreatePayableWriteBinding } from './bindings/write/create-payable.binding';
import { CreateReceivableWriteBinding } from './bindings/write/create-receivable.binding';
import { ExpenseReversalTargetResolver } from './reversals/expense-reversal-target-resolver.service';
import { TransferReversalTargetResolver } from './reversals/transfer-reversal-target-resolver.service';
import { PurchaseEntityResolver } from './bindings/write/purchase-entity-resolver.service';
import { RegisterCapitalContributionWriteBinding } from './bindings/write/register-capital-contribution.binding';
import { RegisterCapitalDistributionWriteBinding } from './bindings/write/register-capital-distribution.binding';
import { RegisterExpenseWriteBinding } from './bindings/write/register-expense.binding';
import { RegisterPurchaseWriteBinding } from './bindings/write/register-purchase.binding';
import { RegisterReceivablePaymentWriteBinding } from './bindings/write/register-receivable-payment.binding';
import { RegisterSaleWriteBinding } from './bindings/write/register-sale.binding';
import { UpdateClientEntityResolver } from './bindings/write/update-client-entity-resolver.service';
import { UpdateClientWriteBinding } from './bindings/write/update-client.binding';
import { WriteCapabilityBindingRegistry } from './bindings/write-capability-binding-registry';
import { WritePlanRunner } from './bindings/write-plan-runner';
import { SaleCustomerEntityResolver } from './bindings/write/sale-customer-entity-resolver.service';
import { CompositionOrchestrator } from './composition/composition-orchestrator.service';
import { CompositionService } from './composition/composition.service';
import { AIRequestService } from './assistant/ai-request.service';
import { StructuredAssistantPersistence } from './assistant/structured-assistant.persistence';
import { StructuredAssistantService } from './assistant/structured-assistant.service';
import { IntentAdapterService, INTENT_ADAPTER_PROVIDER } from './intent-adapter/intent-adapter.service';
import { NaturalLanguageAssistantService } from './intent-adapter/natural-language-assistant.service';
import { createIntentAdapterProvider } from './intent-adapter/providers/intent-provider.factory';
import { IntentAdapterRateLimitGuard } from './intent-adapter/rate-limit.guard';
import { ReferenceResolverService } from './context/reference-resolver.service';
import { WorkingContextService } from './context/working-context.service';
import { OperationalIntelligenceService } from './operational-intelligence/operational-intelligence.service';
import { TelemetryModule } from './telemetry/telemetry.module';

@Module({
  imports: [
    AnalyticsModule,
    InventoryModule,
    CrmModule,
    CuentasModule,
    HistoryModule,
    DealsModule,
    ExpensesModule,
    TreasuryModule,
    CapitalModule,
    TelemetryModule,
  ],
  controllers: [AIController],
  providers: [
    AuditService,
    ConversationService,
    RuntimeService,
    WorkspaceService,
    OperationalIntelligenceService,
    ToolRegistry,
    ToolExecutionService,
    BusinessActionCatalog,
    BusinessCapabilityCatalog,
    PlannerService,
    CapabilityBindingRegistry,
    CapabilityBindingService,
    ReadPlanRunner,
    RegisterSaleWriteBinding,
    RegisterReceivablePaymentWriteBinding,
    RegisterPayablePaymentWriteBinding,
    RegisterTreasuryTransferWriteBinding,
    RegisterCapitalContributionWriteBinding,
    RegisterCapitalDistributionWriteBinding,
    RegisterExpenseWriteBinding,
    RegisterPurchaseWriteBinding,
    CreateClientWriteBinding,
    UpdateClientWriteBinding,
    CreateReceivableWriteBinding,
    CreatePayableWriteBinding,
    ReceivablePaymentEntityResolver,
    PayablePaymentEntityResolver,
    PurchaseEntityResolver,
    SaleCustomerEntityResolver,
    CreateClientEntityResolver,
    UpdateClientEntityResolver,
    CapitalInvestorEntityResolver,
    CreateManualAccountEntityResolver,
    ExpenseReversalTargetResolver,
    TransferReversalTargetResolver,
    CompositionService,
    CompositionOrchestrator,
    WriteCapabilityBindingRegistry,
    WritePlanRunner,
    AIRequestService,
    StructuredAssistantPersistence,
    StructuredAssistantService,
    { provide: AUDIT_STORE, useExisting: AuditService },
    { provide: CONVERSATION_STORE, useExisting: ConversationService },
    { provide: RUNTIME_STORE, useExisting: RuntimeService },
    { provide: WORKSPACE_STORE, useExisting: WorkspaceService },
    { provide: INTENT_ADAPTER_PROVIDER, useFactory: createIntentAdapterProvider },
    IntentAdapterService,
    ReferenceResolverService,
    WorkingContextService,
    NaturalLanguageAssistantService,
    IntentAdapterRateLimitGuard,
  ],
  exports: [
    AUDIT_STORE,
    CONVERSATION_STORE,
    RUNTIME_STORE,
    WORKSPACE_STORE,
    RuntimeService,
    ToolRegistry,
    ToolExecutionService,
    BusinessActionCatalog,
    BusinessCapabilityCatalog,
    PlannerService,
    CapabilityBindingRegistry,
    CapabilityBindingService,
    ReadPlanRunner,
    WriteCapabilityBindingRegistry,
    WritePlanRunner,
    AIRequestService,
    StructuredAssistantService,
    IntentAdapterService,
    NaturalLanguageAssistantService,
    OperationalIntelligenceService,
  ],
})
export class AIModule {}
