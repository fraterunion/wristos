import {
  Currency,
  Prisma,
  PrismaClient,
  TreasuryAccount,
  TreasuryDirection,
} from '@prisma/client';

const INITIAL_CASH = 7100;
const INITIAL_BANK = 633146;
const INITIAL_CESAR = 535780;

const TENANT_ID = 'cmnzph8dm0000qotapt94alxs';

const BOOTSTRAP_DESCRIPTION = 'Saldo inicial de tesorería';

const prisma = new PrismaClient();
const isDryRun = process.argv.includes('--dry-run');

type BootstrapAccount = {
  account: TreasuryAccount;
  balance: number;
};

async function main() {
  const accounts: BootstrapAccount[] = [
    { account: TreasuryAccount.CASH, balance: INITIAL_CASH },
    { account: TreasuryAccount.BANK, balance: INITIAL_BANK },
    { account: TreasuryAccount.CESAR, balance: INITIAL_CESAR },
  ];

  const existing = await prisma.treasuryEntry.findFirst({
    where: {
      tenantId: TENANT_ID,
      deletedAt: null,
      description: BOOTSTRAP_DESCRIPTION,
    },
  });

  if (existing) {
    console.error(
      `Abort: bootstrap already ran for tenant ${TENANT_ID} (TreasuryEntry id=${existing.id}, account=${existing.account}).`,
    );
    process.exitCode = 1;
    return;
  }

  const toCreate = accounts.filter((row) => row.balance !== 0);

  if (isDryRun) {
    console.log('Would create:');
    console.log(`CASH: ${INITIAL_CASH}`);
    console.log(`BANK: ${INITIAL_BANK}`);
    console.log(`CESAR: ${INITIAL_CESAR}`);
    console.log('');
    if (toCreate.length === 0) {
      console.log('[dry-run] No entries would be created (all balances are 0).');
    } else {
      console.log(`[dry-run] Would create ${toCreate.length} TreasuryEntry record(s).`);
    }
    return;
  }

  if (toCreate.length === 0) {
    console.log('No entries to create (all balances are 0).');
    return;
  }

  const transactionDate = new Date();

  await prisma.$transaction(
    toCreate.map(({ account, balance }) =>
      prisma.treasuryEntry.create({
        data: {
          tenantId: TENANT_ID,
          account,
          direction: TreasuryDirection.INFLOW,
          amount: new Prisma.Decimal(balance),
          currency: Currency.MXN,
          amountMxn: new Prisma.Decimal(balance),
          exchangeRate: null,
          transactionDate,
          description: BOOTSTRAP_DESCRIPTION,
        },
      }),
    ),
  );

  console.log(`Created ${toCreate.length} TreasuryEntry bootstrap record(s).`);
  for (const row of toCreate) {
    console.log(`${row.account}: ${row.balance}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
