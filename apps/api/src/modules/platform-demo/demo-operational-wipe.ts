import { Prisma } from '@prisma/client';

/**
 * Tenant-scoped wipe of mutable operational tables that normal demo use can
 * populate.
 *
 * Intentionally retained (not operational state):
 * - Identity: User, TenantUser, Role, Tenant
 * - Global catalog: WatchReference
 * - Immutable AI audit history: AIAuditEvent, AIMessage (DB append-only
 *   triggers). Conversations / action runs / workspaces referenced by those
 *   rows also survive because their FKs are Restrict.
 *
 * Every deleteMany is scoped by tenantId directly or via a nested tenant
 * relation. There is no unscoped deleteMany in this module.
 */
export async function wipeDemoOperationalData(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  const tenant = { tenantId };

  // --- AI runtime ---
  // AIAuditEvent and AIMessage are append-only at the database layer.
  // Do not delete them. Unreferenced workspaces/action-runs/conversations
  // remain deletable; rows pinned by surviving audit/messages are skipped.
  await tx.aIRequest.deleteMany({ where: tenant });
  await tx.aIWorkspace.deleteMany({
    where: { tenantId, auditEvents: { none: {} } },
  });
  await tx.aIActionRun.deleteMany({
    where: { tenantId, auditEvents: { none: {} }, activeWorkspaces: { none: {} } },
  });
  await tx.aIConversation.deleteMany({
    where: {
      tenantId,
      messages: { none: {} },
      auditEvents: { none: {} },
      workspaces: { none: {} },
      actionRuns: { none: {} },
    },
  });

  // --- Wrist Caviar migration staging (tenant-scoped; cascade children first) ---
  await tx.wristCaviarMigrationResolution.deleteMany({ where: tenant });
  await tx.wristCaviarMigrationEntityApproval.deleteMany({ where: tenant });
  await tx.wristCaviarMigrationReviewedDataset.deleteMany({ where: tenant });
  await tx.wristCaviarMigrationIssue.deleteMany({ where: tenant });
  await tx.wristCaviarMigrationSheet.deleteMany({ where: tenant });
  await tx.wristCaviarMigrationAnalysis.deleteMany({ where: tenant });
  await tx.wristCaviarOneTimeImportMap.deleteMany({ where: tenant });
  await tx.wristCaviarOneTimeImportRun.deleteMany({ where: tenant });

  // --- Data onboarding ---
  await tx.documentExtractionChunk.deleteMany({ where: tenant });
  await tx.dataImportRecord.deleteMany({ where: tenant });
  await tx.dataImportEvent.deleteMany({ where: tenant });
  await tx.dataImportFile.deleteMany({ where: tenant });
  await tx.dataImportSession.deleteMany({ where: tenant });

  // --- Storefront (Restrict on Watch) ---
  await tx.storefrontReservation.deleteMany({ where: tenant });

  // --- Crypto ---
  await tx.assetPriceSnapshot.deleteMany({ where: tenant });
  await tx.assetHolding.deleteMany({ where: tenant });

  // --- Legacy AR + financial audit ---
  await tx.financialAuditEvent.deleteMany({ where: tenant });
  await tx.receivablePayment.deleteMany({ where: tenant });
  await tx.receivable.deleteMany({ where: tenant });

  // --- Cuentas (settlement Restrict on payments/entries) ---
  await tx.accountSettlement.deleteMany({ where: tenant });
  await tx.accountPayment.deleteMany({ where: tenant });
  await tx.accountEntry.deleteMany({ where: tenant });

  // --- Treasury / Capital ---
  await tx.physicalCashBalanceAdjustment.deleteMany({ where: tenant });
  await tx.treasuryEntry.deleteMany({ where: tenant });
  await tx.investorContribution.deleteMany({ where: tenant });
  await tx.investorDistribution.deleteMany({ where: tenant });
  await tx.investorOpeningBalance.deleteMany({ where: tenant });
  await tx.investor.deleteMany({ where: tenant });

  // --- Radar ---
  await tx.marketListing.deleteMany({ where: tenant });
  await tx.channelMessage.deleteMany({ where: tenant });
  await tx.radarImport.deleteMany({ where: tenant });
  await tx.channel.deleteMany({ where: tenant });
  await tx.contact.deleteMany({ where: tenant });

  // --- Core operations ---
  await tx.automationRun.deleteMany({ where: tenant });
  await tx.automationRule.deleteMany({ where: tenant });
  await tx.matchSuggestion.deleteMany({ where: tenant });
  await tx.payment.deleteMany({ where: tenant });
  await tx.deal.deleteMany({ where: tenant });
  await tx.clientInteraction.deleteMany({ where: tenant });
  await tx.clientPreference.deleteMany({ where: tenant });
  await tx.operatingExpense.deleteMany({ where: tenant });
  await tx.watchImage.deleteMany({ where: tenant });
  await tx.watchExpense.deleteMany({ where: tenant });
  await tx.watch.deleteMany({ where: tenant });
  await tx.client.deleteMany({ where: tenant });
}
