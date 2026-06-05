import {
  PrismaClient,
  DealStage,
  PaymentStatus,
  AccountEntryType,
  AccountEntryStatus,
  AccountEntryCategory,
  AccountEntrySource,
  CounterpartyType,
  Currency,
  Prisma,
} from '@prisma/client';

const prisma = new PrismaClient();
const isDryRun = process.argv.includes('--dry-run');

type EntryToCreate = {
  dealId: string;
  counterpartyName: string;
  concept: string;
  totalAmount: Prisma.Decimal;
  status: AccountEntryStatus;
  pendingBalance: Prisma.Decimal;
  data: Prisma.AccountEntryUncheckedCreateInput;
};

function fmtMxn(amount: Prisma.Decimal) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount.toString()));
}

async function main() {
  const deals = await prisma.deal.findMany({
    where: {
      deletedAt: null,
      stage: { in: [DealStage.PENDING_PAYMENT, DealStage.CLOSED_WON] },
    },
    include: {
      client: { select: { name: true } },
      watch: { select: { brand: true, model: true } },
    },
  });

  const dealIds = deals.map((deal) => deal.id);

  const paidByDealRows =
    dealIds.length > 0
      ? await prisma.payment.groupBy({
          by: ['dealId'],
          where: {
            deletedAt: null,
            status: PaymentStatus.PAID,
            dealId: { in: dealIds },
          },
          _sum: { amount: true },
        })
      : [];

  const paidMap = new Map<string, Prisma.Decimal>();
  for (const row of paidByDealRows) {
    paidMap.set(row.dealId, row._sum.amount ?? new Prisma.Decimal(0));
  }

  const existingEntries =
    dealIds.length > 0
      ? await prisma.accountEntry.findMany({
          where: {
            deletedAt: null,
            type: AccountEntryType.RECEIVABLE,
            dealId: { in: dealIds },
          },
          select: { dealId: true },
        })
      : [];

  const existingDealIds = new Set(
    existingEntries
      .map((entry) => entry.dealId)
      .filter((dealId): dealId is string => dealId !== null),
  );

  let withPositiveBalance = 0;
  let alreadySkipped = 0;
  const toCreate: EntryToCreate[] = [];

  for (const deal of deals) {
    const paidTotal = paidMap.get(deal.id) ?? new Prisma.Decimal(0);
    const pendingBalance = deal.agreedPrice.minus(paidTotal);

    if (!pendingBalance.greaterThan(0)) {
      continue;
    }

    withPositiveBalance++;

    if (existingDealIds.has(deal.id)) {
      alreadySkipped++;
      continue;
    }

    const status =
      paidTotal.greaterThan(0) ? AccountEntryStatus.PARTIAL : AccountEntryStatus.OPEN;
    const concept = `Saldo pendiente — ${deal.watch.brand} ${deal.watch.model}`;

    toCreate.push({
      dealId: deal.id,
      counterpartyName: deal.client.name,
      concept,
      totalAmount: deal.agreedPrice,
      status,
      pendingBalance,
      data: {
        tenantId: deal.tenantId,
        type: AccountEntryType.RECEIVABLE,
        status,
        category: AccountEntryCategory.SALE_BALANCE,
        source: AccountEntrySource.DEAL_AUTO,
        counterpartyName: deal.client.name,
        counterpartyType: CounterpartyType.CLIENT,
        concept,
        totalAmount: deal.agreedPrice,
        currency: Currency.MXN,
        exchangeRate: deal.exchangeRate ?? undefined,
        issuedAt: deal.updatedAt,
        dueDate: null,
        notes: deal.notes ?? null,
        clientId: deal.clientId,
        dealId: deal.id,
        watchId: deal.watchId,
        expenseId: null,
        closedAt: null,
      },
    });
  }

  const totalReceivable = toCreate.reduce(
    (sum, entry) => sum.plus(entry.pendingBalance),
    new Prisma.Decimal(0),
  );

  console.log('=== Backfill Report ===');
  console.log(`Deals examined: ${deals.length}`);
  console.log(`With positive balance: ${withPositiveBalance}`);
  console.log(`Already have entry skipped: ${alreadySkipped}`);
  console.log(
    `${isDryRun ? 'Would create' : 'Creating'}: ${toCreate.length} entries`,
  );
  console.log(`Total receivable: ${fmtMxn(totalReceivable)}`);
  console.log('');

  for (const entry of toCreate) {
    console.log(
      `${entry.dealId} | ${entry.counterpartyName} | ${entry.concept} | MXN ${entry.totalAmount.toFixed(2)} | ${entry.status}`,
    );
  }

  if (toCreate.length > 0) {
    console.log('');
  }

  if (isDryRun) {
    console.log('[dry-run] No changes written.');
    return;
  }

  await prisma.$transaction(
    toCreate.map((entry) => prisma.accountEntry.create({ data: entry.data })),
  );

  console.log(`Created ${toCreate.length} AccountEntry records.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
