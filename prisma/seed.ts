import {
  AutomationRuleType,
  AutomationRunStatus,
  ClientInteractionType,
  DealStage,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  PrismaClient,
  TenantStatus,
  UserStatus,
  WatchOwnershipType,
  WatchStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const dayMs = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * dayMs);
const daysFromNow = (days: number) => new Date(Date.now() + days * dayMs);
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

type WatchSeed = {
  key: string;
  brand: string;
  model: string;
  reference: string;
  serialNumber: string;
  condition: string;
  cost: number;
  price: number;
  status: WatchStatus;
  ownershipType: WatchOwnershipType;
  consignmentOwnerName?: string;
  consignmentSplitPercentage?: number;
  createdAtDaysAgo: number;
};

type ClientSeed = {
  key: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  tags: string[];
  budgetRange: string;
};

type DealSeed = {
  key: string;
  clientKey: string;
  watchKey: string;
  stage: DealStage;
  expectedCloseInDays: number | null;
  agreedPrice: number;
  notes: string;
  createdAtDaysAgo: number;
  updatedAtDaysAgo: number;
};

type PaymentSeed = {
  dealKey: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  dueDateDaysOffset: number | null;
  paidAtDaysAgo: number | null;
  notes: string | null;
};

const watchSeeds: WatchSeed[] = [
  {
    key: 'w1',
    brand: 'Rolex',
    model: 'Submariner Date',
    reference: '126610LN',
    serialNumber: 'RX-4F21-9A7C',
    condition: 'Excellent, full set 2022',
    cost: 10600,
    price: 13950,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 18,
  },
  {
    key: 'w2',
    brand: 'Rolex',
    model: 'GMT-Master II Pepsi',
    reference: '126710BLRO',
    serialNumber: 'RX-8P03-2L6R',
    condition: 'Very good, box only',
    cost: 18200,
    price: 22500,
    status: WatchStatus.RESERVED,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Northbridge Collection',
    consignmentSplitPercentage: 78,
    createdAtDaysAgo: 44,
  },
  {
    key: 'w3',
    brand: 'Rolex',
    model: 'Daytona Ceramic',
    reference: '116500LN',
    serialNumber: 'RX-1D72-5Q8M',
    condition: 'Excellent, complete set',
    cost: 25800,
    price: 33900,
    status: WatchStatus.SOLD,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 72,
  },
  {
    key: 'w4',
    brand: 'Audemars Piguet',
    model: 'Royal Oak 41',
    reference: '15500ST.OO.1220ST.04',
    serialNumber: 'AP-6K41-3R9V',
    condition: 'Excellent, warranty card included',
    cost: 37100,
    price: 44800,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Aster Advisory Family Office',
    consignmentSplitPercentage: 74,
    createdAtDaysAgo: 95,
  },
  {
    key: 'w5',
    brand: 'Audemars Piguet',
    model: 'Royal Oak Offshore Chronograph',
    reference: '26420SO.OO.A002CA.01',
    serialNumber: 'AP-5C84-1N3T',
    condition: 'Mint, unworn strap',
    cost: 29200,
    price: 36900,
    status: WatchStatus.IN_TRANSIT,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 11,
  },
  {
    key: 'w6',
    brand: 'Patek Philippe',
    model: 'Nautilus',
    reference: '5711/1A-010',
    serialNumber: 'PP-9H11-4Z2B',
    condition: 'Very good, polished once',
    cost: 84500,
    price: 102000,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Crown & Crest Holdings',
    consignmentSplitPercentage: 81,
    createdAtDaysAgo: 132,
  },
  {
    key: 'w7',
    brand: 'Patek Philippe',
    model: 'Aquanaut',
    reference: '5167A-001',
    serialNumber: 'PP-2V33-8M6C',
    condition: 'Excellent, full set',
    cost: 40800,
    price: 47900,
    status: WatchStatus.RESERVED,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 39,
  },
  {
    key: 'w8',
    brand: 'Cartier',
    model: 'Santos de Cartier Large',
    reference: 'WSSA0018',
    serialNumber: 'CA-3S21-7J5P',
    condition: 'Excellent, minor clasp wear',
    cost: 4700,
    price: 6900,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 29,
  },
  {
    key: 'w9',
    brand: 'Cartier',
    model: 'Tank Louis Cartier',
    reference: 'WGTA0011',
    serialNumber: 'CA-7T98-2F4L',
    condition: 'Very good, manual wind serviced',
    cost: 7800,
    price: 11200,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Lucent Private Vault',
    consignmentSplitPercentage: 72,
    createdAtDaysAgo: 64,
  },
  {
    key: 'w10',
    brand: 'Omega',
    model: 'Speedmaster Professional Moonwatch',
    reference: '310.30.42.50.01.001',
    serialNumber: 'OM-4M55-6X8H',
    condition: 'Excellent, complete set',
    cost: 4300,
    price: 6550,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 22,
  },
  {
    key: 'w11',
    brand: 'Omega',
    model: 'Seamaster Diver 300M',
    reference: '210.30.42.20.01.001',
    serialNumber: 'OM-8R64-3D9Q',
    condition: 'Good, desk-diving marks',
    cost: 2850,
    price: 4350,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 48,
  },
  {
    key: 'w12',
    brand: 'Tudor',
    model: 'Black Bay 58',
    reference: 'M79030N-0001',
    serialNumber: 'TD-5B12-4W7R',
    condition: 'Excellent, full links',
    cost: 2300,
    price: 3650,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 14,
  },
  {
    key: 'w13',
    brand: 'Tudor',
    model: 'Pelagos 39',
    reference: 'M25407N-0001',
    serialNumber: 'TD-9P30-2E6K',
    condition: 'Mint, near unworn',
    cost: 2950,
    price: 4600,
    status: WatchStatus.IN_SERVICE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 33,
  },
  {
    key: 'w14',
    brand: 'Richard Mille',
    model: 'RM 011 Felipe Massa',
    reference: 'RM011-FM-TI',
    serialNumber: 'RM-1N84-7C2S',
    condition: 'Very good, serviced 2024',
    cost: 128000,
    price: 156000,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Aurum Legacy Partners',
    consignmentSplitPercentage: 84,
    createdAtDaysAgo: 121,
  },
  {
    key: 'w15',
    brand: 'Richard Mille',
    model: 'RM 035 Rafael Nadal',
    reference: 'RM035-03',
    serialNumber: 'RM-6Q28-5V1A',
    condition: 'Excellent, full set',
    cost: 172000,
    price: 214000,
    status: WatchStatus.SOLD,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Helios Family Capital',
    consignmentSplitPercentage: 82,
    createdAtDaysAgo: 154,
  },
  {
    key: 'w16',
    brand: 'Rolex',
    model: 'Datejust 41',
    reference: '126334',
    serialNumber: 'RX-3J45-8N2X',
    condition: 'Excellent, fluted bezel',
    cost: 9200,
    price: 12800,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 27,
  },
  {
    key: 'w17',
    brand: 'Rolex',
    model: 'Explorer II Polar',
    reference: '226570',
    serialNumber: 'RX-7W61-4G3M',
    condition: 'Very good, full kit',
    cost: 9700,
    price: 12850,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Silvergate Advisory',
    consignmentSplitPercentage: 76,
    createdAtDaysAgo: 58,
  },
  {
    key: 'w18',
    brand: 'Patek Philippe',
    model: 'Annual Calendar',
    reference: '5396G-017',
    serialNumber: 'PP-8C44-1L9V',
    condition: 'Excellent, complete papers',
    cost: 29900,
    price: 39200,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 88,
  },
  {
    key: 'w19',
    brand: 'Omega',
    model: 'Speedmaster Snoopy',
    reference: '310.32.42.50.02.001',
    serialNumber: 'OM-2L66-9R1T',
    condition: 'Excellent, limited edition',
    cost: 12600,
    price: 17800,
    status: WatchStatus.RESERVED,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Blue Meridian Fund',
    consignmentSplitPercentage: 79,
    createdAtDaysAgo: 41,
  },
  {
    key: 'w20',
    brand: 'Cartier',
    model: 'Ballon Bleu 42',
    reference: 'WSBB0048',
    serialNumber: 'CA-1R37-6H8N',
    condition: 'Good, polished bezel',
    cost: 4100,
    price: 6200,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 17,
  },
  {
    key: 'w21',
    brand: 'Audemars Piguet',
    model: 'Code 11.59 Chronograph',
    reference: '26393OR.OO.A002CR.01',
    serialNumber: 'AP-4T72-8Q3W',
    condition: 'Excellent, full set',
    cost: 34400,
    price: 42100,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 76,
  },
  {
    key: 'w22',
    brand: 'Tudor',
    model: 'Black Bay GMT',
    reference: 'M79830RB-0001',
    serialNumber: 'TD-7H13-5P9L',
    condition: 'Very good, complete',
    cost: 2600,
    price: 3980,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Quarry Street Group',
    consignmentSplitPercentage: 70,
    createdAtDaysAgo: 102,
  },
  {
    key: 'w23',
    brand: 'Rolex',
    model: 'Yacht-Master 40',
    reference: '126622',
    serialNumber: 'RX-2E59-7S4D',
    condition: 'Excellent, platinum bezel',
    cost: 11500,
    price: 15400,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 36,
  },
  {
    key: 'w24',
    brand: 'Patek Philippe',
    model: 'Calatrava',
    reference: '6119G-001',
    serialNumber: 'PP-6N22-3B5R',
    condition: 'Mint, boxed',
    cost: 22800,
    price: 28600,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 53,
  },
  {
    key: 'w25',
    brand: 'Richard Mille',
    model: 'RM 67-01 Extra Flat',
    reference: 'RM67-01-TI',
    serialNumber: 'RM-5D77-2K8P',
    condition: 'Excellent, complete',
    cost: 143000,
    price: 176000,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Crescent Peak Holdings',
    consignmentSplitPercentage: 83,
    createdAtDaysAgo: 109,
  },
  {
    key: 'w26',
    brand: 'Cartier',
    model: 'Santos Dumont XL',
    reference: 'WSSA0032',
    serialNumber: 'CA-4M61-9C2T',
    condition: 'Excellent',
    cost: 5200,
    price: 7600,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 25,
  },
  {
    key: 'w27',
    brand: 'Omega',
    model: 'Seamaster 300 Heritage',
    reference: '234.30.41.21.01.001',
    serialNumber: 'OM-7F90-1J6R',
    condition: 'Very good',
    cost: 3700,
    price: 5650,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 61,
  },
  {
    key: 'w28',
    brand: 'Audemars Piguet',
    model: 'Royal Oak Jumbo',
    reference: '16202ST.OO.1240ST.01',
    serialNumber: 'AP-9V35-4R1L',
    condition: 'Excellent, complete',
    cost: 73500,
    price: 89900,
    status: WatchStatus.SOLD,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Meridian Crest Trust',
    consignmentSplitPercentage: 80,
    createdAtDaysAgo: 145,
  },
  {
    key: 'w29',
    brand: 'Rolex',
    model: 'Sky-Dweller',
    reference: '336934',
    serialNumber: 'RX-6S73-8P2N',
    condition: 'Excellent',
    cost: 18900,
    price: 24800,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 47,
  },
  {
    key: 'w30',
    brand: 'Tudor',
    model: 'Black Bay Chrono',
    reference: 'M79360N-0002',
    serialNumber: 'TD-3L58-7Q4B',
    condition: 'Excellent',
    cost: 3200,
    price: 4950,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 19,
  },
];

const clientSeeds: ClientSeed[] = [
  {
    key: 'c1',
    name: 'Elias Mercer',
    email: 'elias.mercer@demo-wristos.local',
    phone: '+1 305 555 1101',
    notes: 'Prefers investment-grade sports pieces with full set and low polish history.',
    tags: ['VIP', 'Rolex', 'Repeat Buyer'],
    budgetRange: '$25k-$60k',
  },
  {
    key: 'c2',
    name: 'Mira Calder',
    email: 'mira.calder@demo-wristos.local',
    phone: '+1 212 555 2202',
    notes: 'Focused on modern Patek and AP references; values discreet transaction handling.',
    tags: ['Collector', 'Patek', 'AP'],
    budgetRange: '$40k-$140k',
  },
  {
    key: 'c3',
    name: 'Jonah Vale',
    email: 'jonah.vale@demo-wristos.local',
    phone: '+1 646 555 3303',
    notes: 'First-time high-end buyer, strong interest in Rolex GMT and Submariner.',
    tags: ['New Lead', 'Rolex'],
    budgetRange: '$12k-$25k',
  },
  {
    key: 'c4',
    name: 'Leona Price',
    email: 'leona.price@demo-wristos.local',
    phone: '+44 20 5550 4404',
    notes: 'Buys for family office portfolio, prefers complete documentation.',
    tags: ['Family Office', 'High Value'],
    budgetRange: '$70k-$250k',
  },
  {
    key: 'c5',
    name: 'Rafael Quinn',
    email: 'rafael.quinn@demo-wristos.local',
    phone: '+1 917 555 5505',
    notes: 'Comfortable with minor wear if pricing is attractive; likes Omega and Tudor.',
    tags: ['Value Buyer', 'Omega', 'Tudor'],
    budgetRange: '$4k-$15k',
  },
  {
    key: 'c6',
    name: 'Sienna Holt',
    email: 'sienna.holt@demo-wristos.local',
    phone: '+1 310 555 6606',
    notes: 'Seeking Cartier dress models for personal wear and gifting.',
    tags: ['Cartier', 'Gift Buyer'],
    budgetRange: '$6k-$20k',
  },
  {
    key: 'c7',
    name: 'Marcus Devereux',
    email: 'marcus.devereux@demo-wristos.local',
    phone: '+1 347 555 7707',
    notes: 'Actively rotates inventory, asks for fast settlement on in-demand references.',
    tags: ['Dealer', 'Fast Close'],
    budgetRange: '$15k-$50k',
  },
  {
    key: 'c8',
    name: 'Ari Stone',
    email: 'ari.stone@demo-wristos.local',
    phone: '+1 415 555 8808',
    notes: 'Prefers under-the-radar independent and advanced complications.',
    tags: ['Niche Collector'],
    budgetRange: '$30k-$120k',
  },
  {
    key: 'c9',
    name: 'Noor Ellison',
    email: 'noor.ellison@demo-wristos.local',
    phone: '+971 4 555 9909',
    notes: 'Interested in RM and AP, frequently requests private viewing appointments.',
    tags: ['Ultra High Net Worth', 'RM', 'AP'],
    budgetRange: '$120k-$350k',
  },
  {
    key: 'c10',
    name: 'Parker Wilde',
    email: 'parker.wilde@demo-wristos.local',
    phone: '+1 702 555 1010',
    notes: 'Buys and flips sports models every 2-3 months.',
    tags: ['Trader', 'Rolex'],
    budgetRange: '$18k-$45k',
  },
  {
    key: 'c11',
    name: 'Juno Barrett',
    email: 'juno.barrett@demo-wristos.local',
    phone: '+1 786 555 1111',
    notes: 'Wants clean Cartier and Omega inventory for boutique resale.',
    tags: ['Wholesale', 'Cartier', 'Omega'],
    budgetRange: '$5k-$18k',
  },
  {
    key: 'c12',
    name: 'Dorian Pike',
    email: 'dorian.pike@demo-wristos.local',
    phone: '+1 646 555 1212',
    notes: 'Interested in white-dial pieces and newer warranty cards.',
    tags: ['Rolex', 'Lead'],
    budgetRange: '$10k-$35k',
  },
  {
    key: 'c13',
    name: 'Helena Rowe',
    email: 'helena.rowe@demo-wristos.local',
    phone: '+1 213 555 1313',
    notes: 'Focused on heirloom pieces and milestone gifts.',
    tags: ['Gift Buyer', 'Patek'],
    budgetRange: '$20k-$80k',
  },
  {
    key: 'c14',
    name: 'Milo Frost',
    email: 'milo.frost@demo-wristos.local',
    phone: '+1 917 555 1414',
    notes: 'Wants immediate delivery; price-sensitive but decisive.',
    tags: ['Urgent', 'Tudor', 'Omega'],
    budgetRange: '$3k-$12k',
  },
  {
    key: 'c15',
    name: 'Avery Lane',
    email: 'avery.lane@demo-wristos.local',
    phone: '+1 305 555 1515',
    notes: 'Maintains annual acquisition plan for private collection.',
    tags: ['VIP', 'Annual Plan'],
    budgetRange: '$30k-$90k',
  },
  {
    key: 'c16',
    name: 'Rowan Sterling',
    email: 'rowan.sterling@demo-wristos.local',
    phone: '+44 20 5550 1616',
    notes: 'Seeks modern AP and RM, willing to prepay for allocation-priority.',
    tags: ['AP', 'RM', 'Priority Client'],
    budgetRange: '$90k-$250k',
  },
  {
    key: 'c17',
    name: 'Cassian Bloom',
    email: 'cassian.bloom@demo-wristos.local',
    phone: '+1 415 555 1717',
    notes: 'Looking for first serious watch purchase, likes clean steel sports pieces.',
    tags: ['New Lead', 'Rolex', 'Omega'],
    budgetRange: '$8k-$22k',
  },
  {
    key: 'c18',
    name: 'Nadia Crest',
    email: 'nadia.crest@demo-wristos.local',
    phone: '+1 646 555 1818',
    notes: 'Shopping for dual-purpose watch wardrobe: one sport, one dress.',
    tags: ['Cartier', 'Rolex'],
    budgetRange: '$12k-$40k',
  },
];

async function main() {
  const tenantName = process.env.SEED_TENANT_NAME ?? 'WristOS Demo Tenant';
  const tenantSlug = process.env.SEED_TENANT_SLUG ?? 'wristos-demo';
  const roleName = process.env.SEED_ROLE_NAME ?? 'OWNER';
  const userEmail = (process.env.SEED_USER_EMAIL ?? 'owner@wristos.local').toLowerCase();
  const userPassword = process.env.SEED_USER_PASSWORD ?? 'ChangeMe123!';

  const passwordHash = await bcrypt.hash(userPassword, 12);

  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantSlug },
    update: { name: tenantName, status: TenantStatus.ACTIVE },
    create: {
      name: tenantName,
      slug: tenantSlug,
      status: TenantStatus.ACTIVE,
    },
  });

  const role = await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: tenant.id,
        name: roleName,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      name: roleName,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: userEmail },
    update: {
      passwordHash,
      status: UserStatus.ACTIVE,
    },
    create: {
      email: userEmail,
      passwordHash,
      status: UserStatus.ACTIVE,
      displayName: 'WristOS Owner',
    },
  });

  await prisma.tenantUser.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: user.id,
      },
    },
    update: {
      roleId: role.id,
    },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      roleId: role.id,
    },
  });

  // Reset tenant business data so seed is idempotent and always demo-ready.
  await prisma.automationRun.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.automationRule.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.matchSuggestion.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.payment.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.deal.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.clientInteraction.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.clientPreference.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.watch.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.client.deleteMany({ where: { tenantId: tenant.id } });

  const watchByKey = new Map<string, { id: string; brand: string; model: string; price: number }>();
  for (const watch of watchSeeds) {
    const created = await prisma.watch.create({
      data: {
        tenantId: tenant.id,
        brand: watch.brand,
        model: watch.model,
        reference: watch.reference,
        serialNumber: watch.serialNumber,
        condition: watch.condition,
        cost: new Prisma.Decimal(watch.cost),
        price: new Prisma.Decimal(watch.price),
        status: watch.status,
        ownershipType: watch.ownershipType,
        consignmentOwnerName:
          watch.ownershipType === WatchOwnershipType.CONSIGNMENT
            ? watch.consignmentOwnerName ?? null
            : null,
        consignmentSplitPercentage:
          watch.ownershipType === WatchOwnershipType.CONSIGNMENT &&
          watch.consignmentSplitPercentage !== undefined
            ? new Prisma.Decimal(watch.consignmentSplitPercentage)
            : null,
        createdAt: daysAgo(watch.createdAtDaysAgo),
      },
      select: { id: true, brand: true, model: true, price: true },
    });
    watchByKey.set(watch.key, {
      id: created.id,
      brand: created.brand,
      model: created.model,
      price: Number(created.price),
    });
  }

  const clientByKey = new Map<string, { id: string; name: string; tags: string[] }>();
  for (const client of clientSeeds) {
    const created = await prisma.client.create({
      data: {
        tenantId: tenant.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        notes: client.notes,
        tags: client.tags,
        budgetRange: client.budgetRange,
      },
      select: { id: true, name: true, tags: true },
    });
    clientByKey.set(client.key, { id: created.id, name: created.name, tags: created.tags });
  }

  const preferenceSeeds: Array<{
    clientKey: string;
    preferredBrands: string[];
    preferredModels: string[];
    budgetMin: number | null;
    budgetMax: number | null;
    notes: string | null;
  }> = [
    {
      clientKey: 'c1',
      preferredBrands: ['Rolex', 'Patek Philippe'],
      preferredModels: ['Submariner', 'GMT-Master', 'Aquanaut'],
      budgetMin: 20000,
      budgetMax: 65000,
      notes: 'Prioritizes complete set and strong service history.',
    },
    {
      clientKey: 'c2',
      preferredBrands: ['Audemars Piguet', 'Patek Philippe'],
      preferredModels: ['Royal Oak', 'Nautilus'],
      budgetMin: 50000,
      budgetMax: 160000,
      notes: 'Wants near-mint dial and bracelet condition.',
    },
    {
      clientKey: 'c3',
      preferredBrands: ['Rolex'],
      preferredModels: ['Submariner', 'Explorer'],
      budgetMin: 10000,
      budgetMax: 26000,
      notes: null,
    },
    {
      clientKey: 'c4',
      preferredBrands: ['Richard Mille', 'Audemars Piguet'],
      preferredModels: ['RM 011', 'Royal Oak Jumbo'],
      budgetMin: 90000,
      budgetMax: 280000,
      notes: 'Open to consignment inventory if provenance is clear.',
    },
    {
      clientKey: 'c5',
      preferredBrands: ['Omega', 'Tudor'],
      preferredModels: ['Speedmaster', 'Black Bay'],
      budgetMin: 4000,
      budgetMax: 16000,
      notes: null,
    },
    {
      clientKey: 'c6',
      preferredBrands: ['Cartier'],
      preferredModels: ['Santos', 'Tank', 'Ballon Bleu'],
      budgetMin: 6000,
      budgetMax: 20000,
      notes: 'Needs gift packaging and quick turnover.',
    },
    {
      clientKey: 'c7',
      preferredBrands: ['Rolex', 'Audemars Piguet'],
      preferredModels: ['Daytona', 'Royal Oak'],
      budgetMin: 18000,
      budgetMax: 60000,
      notes: null,
    },
    {
      clientKey: 'c8',
      preferredBrands: ['Patek Philippe', 'Audemars Piguet'],
      preferredModels: ['Calatrava', 'Code 11.59'],
      budgetMin: 25000,
      budgetMax: 120000,
      notes: null,
    },
    {
      clientKey: 'c9',
      preferredBrands: ['Richard Mille', 'Audemars Piguet'],
      preferredModels: ['RM 035', 'Royal Oak'],
      budgetMin: 120000,
      budgetMax: 350000,
      notes: 'Private viewing only.',
    },
    {
      clientKey: 'c10',
      preferredBrands: ['Rolex'],
      preferredModels: ['GMT-Master', 'Sky-Dweller', 'Datejust'],
      budgetMin: 15000,
      budgetMax: 50000,
      notes: null,
    },
    {
      clientKey: 'c11',
      preferredBrands: ['Cartier', 'Omega'],
      preferredModels: ['Santos', 'Seamaster'],
      budgetMin: 5000,
      budgetMax: 20000,
      notes: 'Open to wholesale lots.',
    },
    {
      clientKey: 'c12',
      preferredBrands: ['Rolex'],
      preferredModels: ['Explorer II', 'Datejust'],
      budgetMin: 9000,
      budgetMax: 36000,
      notes: null,
    },
    {
      clientKey: 'c13',
      preferredBrands: ['Patek Philippe', 'Cartier'],
      preferredModels: ['Calatrava', 'Tank'],
      budgetMin: 18000,
      budgetMax: 90000,
      notes: null,
    },
    {
      clientKey: 'c16',
      preferredBrands: ['Audemars Piguet', 'Richard Mille'],
      preferredModels: ['Royal Oak', 'RM 67'],
      budgetMin: 85000,
      budgetMax: 260000,
      notes: 'Responds quickly to allocation-level opportunities.',
    },
    {
      clientKey: 'c18',
      preferredBrands: ['Cartier', 'Rolex'],
      preferredModels: ['Santos', 'Datejust', 'Yacht-Master'],
      budgetMin: 12000,
      budgetMax: 45000,
      notes: null,
    },
  ];

  for (const pref of preferenceSeeds) {
    const client = clientByKey.get(pref.clientKey);
    if (!client) continue;
    await prisma.clientPreference.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        preferredBrands: pref.preferredBrands,
        preferredModels: pref.preferredModels,
        budgetMin: pref.budgetMin === null ? null : new Prisma.Decimal(pref.budgetMin),
        budgetMax: pref.budgetMax === null ? null : new Prisma.Decimal(pref.budgetMax),
        notes: pref.notes,
      },
    });
  }

  let interactionCount = 0;
  const timelineCoverageDates: Date[] = [];
  const interactionPatterns: Array<{ type: ClientInteractionType; note: string; daysAgo: number }> = [
    { type: ClientInteractionType.MESSAGE, note: 'Shared current inventory shortlist and pricing.', daysAgo: 28 },
    { type: ClientInteractionType.CALL, note: 'Discussed trade-in options and timeline.', daysAgo: 17 },
    { type: ClientInteractionType.MEETING, note: 'In-showroom appointment completed; follow-up pending.', daysAgo: 6 },
  ];

  let clientIndex = 0;
  for (const client of clientSeeds) {
    const clientRef = clientByKey.get(client.key);
    if (!clientRef) continue;
    for (const pattern of interactionPatterns) {
      await prisma.clientInteraction.create({
        data: {
          tenantId: tenant.id,
          clientId: clientRef.id,
          type: pattern.type,
          notes: `${pattern.note} (${clientRef.name})`,
          occurredAt: daysAgo(pattern.daysAgo + (clientIndex % 4)),
        },
      });
      timelineCoverageDates.push(daysAgo(pattern.daysAgo + (clientIndex % 4)));
      interactionCount += 1;
    }
    // one extra NOTE for richer timeline on every third client
    if (clientIndex % 3 === 0) {
      await prisma.clientInteraction.create({
        data: {
          tenantId: tenant.id,
          clientId: clientRef.id,
          type: ClientInteractionType.NOTE,
          notes: 'Preferred communication time captured for future outreach.',
          occurredAt: daysAgo(3 + (clientIndex % 5)),
        },
      });
      timelineCoverageDates.push(daysAgo(3 + (clientIndex % 5)));
      interactionCount += 1;
    }
    clientIndex += 1;
  }

  // Extend CRM history so timeline feels active over multiple months.
  const longHorizonOffsets = [42, 58, 76, 93, 111, 128, 146, 167];
  const longHorizonTypes: ClientInteractionType[] = [
    ClientInteractionType.CALL,
    ClientInteractionType.MESSAGE,
    ClientInteractionType.MEETING,
    ClientInteractionType.NOTE,
  ];
  clientIndex = 0;
  for (const client of clientSeeds) {
    const clientRef = clientByKey.get(client.key);
    if (!clientRef) continue;

    const firstOffset = longHorizonOffsets[clientIndex % longHorizonOffsets.length];
    const secondOffset = longHorizonOffsets[(clientIndex + 3) % longHorizonOffsets.length];
    const notes = [
      'Historical follow-up on previous shortlist and market movement.',
      'Past quarterly check-in regarding preferred references.',
    ];
    const offsets = [firstOffset, secondOffset];
    for (let idx = 0; idx < offsets.length; idx += 1) {
      const offset = offsets[idx];
      await prisma.clientInteraction.create({
        data: {
          tenantId: tenant.id,
          clientId: clientRef.id,
          type: longHorizonTypes[(clientIndex + idx) % longHorizonTypes.length],
          notes: `${notes[idx]} (${clientRef.name})`,
          occurredAt: daysAgo(offset),
        },
      });
      timelineCoverageDates.push(daysAgo(offset));
      interactionCount += 1;
    }
    clientIndex += 1;
  }

  const dealSeeds: DealSeed[] = [
    {
      key: 'd1',
      clientKey: 'c3',
      watchKey: 'w1',
      stage: DealStage.LEAD,
      expectedCloseInDays: 19,
      agreedPrice: 13600,
      notes: 'Initial quote sent. Awaiting callback after weekend travel.',
      createdAtDaysAgo: 9,
      updatedAtDaysAgo: 9,
    },
    {
      key: 'd2',
      clientKey: 'c10',
      watchKey: 'w2',
      stage: DealStage.PENDING_PAYMENT,
      expectedCloseInDays: 4,
      agreedPrice: 22300,
      notes: 'Deposit received verbally approved; final transfer pending.',
      createdAtDaysAgo: 16,
      updatedAtDaysAgo: 2,
    },
    {
      key: 'd3',
      clientKey: 'c2',
      watchKey: 'w6',
      stage: DealStage.NEGOTIATING,
      expectedCloseInDays: 12,
      agreedPrice: 99500,
      notes: 'Client requested margin reduction tied to same-day wire.',
      createdAtDaysAgo: 21,
      updatedAtDaysAgo: 11,
    },
    {
      key: 'd4',
      clientKey: 'c6',
      watchKey: 'w8',
      stage: DealStage.CLOSED_WON,
      expectedCloseInDays: null,
      agreedPrice: 6800,
      notes: 'Gift sale completed with express delivery.',
      createdAtDaysAgo: 27,
      updatedAtDaysAgo: 14,
    },
    {
      key: 'd5',
      clientKey: 'c5',
      watchKey: 'w10',
      stage: DealStage.CLOSED_WON,
      expectedCloseInDays: null,
      agreedPrice: 6400,
      notes: 'Closed after short negotiation. Client requested payment split.',
      createdAtDaysAgo: 24,
      updatedAtDaysAgo: 8,
    },
    {
      key: 'd6',
      clientKey: 'c12',
      watchKey: 'w17',
      stage: DealStage.INTERESTED,
      expectedCloseInDays: 16,
      agreedPrice: 12600,
      notes: 'Client asked for macro photos and bracelet measurement.',
      createdAtDaysAgo: 6,
      updatedAtDaysAgo: 4,
    },
    {
      key: 'd7',
      clientKey: 'c4',
      watchKey: 'w14',
      stage: DealStage.CLOSED_LOST,
      expectedCloseInDays: null,
      agreedPrice: 151000,
      notes: 'Client deferred decision to next quarter capital cycle.',
      createdAtDaysAgo: 40,
      updatedAtDaysAgo: 28,
    },
    {
      key: 'd8',
      clientKey: 'c16',
      watchKey: 'w25',
      stage: DealStage.NEGOTIATING,
      expectedCloseInDays: 9,
      agreedPrice: 173500,
      notes: 'Holding for private preview. Counteroffer under discussion.',
      createdAtDaysAgo: 18,
      updatedAtDaysAgo: 15,
    },
    {
      key: 'd9',
      clientKey: 'c18',
      watchKey: 'w23',
      stage: DealStage.INTERESTED,
      expectedCloseInDays: 7,
      agreedPrice: 15200,
      notes: 'Client requested bundle quote with Cartier dress option.',
      createdAtDaysAgo: 10,
      updatedAtDaysAgo: 3,
    },
    {
      key: 'd10',
      clientKey: 'c9',
      watchKey: 'w15',
      stage: DealStage.CLOSED_WON,
      expectedCloseInDays: null,
      agreedPrice: 210000,
      notes: 'Private sale completed after authentication review.',
      createdAtDaysAgo: 45,
      updatedAtDaysAgo: 30,
    },
    {
      key: 'd11',
      clientKey: 'c11',
      watchKey: 'w20',
      stage: DealStage.PENDING_PAYMENT,
      expectedCloseInDays: 2,
      agreedPrice: 6050,
      notes: 'Wholesale invoice issued; awaiting balance payment.',
      createdAtDaysAgo: 12,
      updatedAtDaysAgo: 5,
    },
    {
      key: 'd12',
      clientKey: 'c13',
      watchKey: 'w24',
      stage: DealStage.LEAD,
      expectedCloseInDays: 25,
      agreedPrice: 28200,
      notes: 'Initial introduction from referral partner.',
      createdAtDaysAgo: 8,
      updatedAtDaysAgo: 1,
    },
    {
      key: 'd13',
      clientKey: 'c7',
      watchKey: 'w29',
      stage: DealStage.NEGOTIATING,
      expectedCloseInDays: 5,
      agreedPrice: 24300,
      notes: 'Trade-in allowance being evaluated.',
      createdAtDaysAgo: 14,
      updatedAtDaysAgo: 13,
    },
    {
      key: 'd14',
      clientKey: 'c14',
      watchKey: 'w12',
      stage: DealStage.CLOSED_LOST,
      expectedCloseInDays: null,
      agreedPrice: 3550,
      notes: 'Client paused purchase due to competing offer.',
      createdAtDaysAgo: 19,
      updatedAtDaysAgo: 16,
    },
    {
      key: 'd15',
      clientKey: 'c15',
      watchKey: 'w18',
      stage: DealStage.INTERESTED,
      expectedCloseInDays: 11,
      agreedPrice: 38400,
      notes: 'Client requested hold while reviewing annual budget allocation.',
      createdAtDaysAgo: 11,
      updatedAtDaysAgo: 10,
    },
  ];

  // Add additional historical deal activity to create rich chart trends.
  const peakDayOffsets = [
    176, 169, 163, 158, 152, 148, 143, 138, 132, 126, 121, 116, 110, 105, 99, 94,
    88, 83, 78, 73, 68, 63, 58, 53, 48, 43, 39, 34, 29, 24, 20, 16, 12, 9, 6, 3,
  ];
  const stagePattern: DealStage[] = [
    DealStage.CLOSED_WON,
    DealStage.CLOSED_WON,
    DealStage.CLOSED_LOST,
    DealStage.INTERESTED,
    DealStage.NEGOTIATING,
    DealStage.LEAD,
    DealStage.PENDING_PAYMENT,
    DealStage.CLOSED_WON,
    DealStage.INTERESTED,
    DealStage.NEGOTIATING,
    DealStage.CLOSED_WON,
    DealStage.CLOSED_LOST,
    DealStage.LEAD,
    DealStage.PENDING_PAYMENT,
    DealStage.CLOSED_WON,
    DealStage.INTERESTED,
    DealStage.NEGOTIATING,
    DealStage.CLOSED_WON,
    DealStage.LEAD,
    DealStage.INTERESTED,
    DealStage.NEGOTIATING,
    DealStage.PENDING_PAYMENT,
    DealStage.CLOSED_WON,
    DealStage.CLOSED_LOST,
    DealStage.INTERESTED,
    DealStage.NEGOTIATING,
    DealStage.CLOSED_WON,
    DealStage.LEAD,
    DealStage.PENDING_PAYMENT,
    DealStage.CLOSED_WON,
    DealStage.INTERESTED,
    DealStage.CLOSED_LOST,
    DealStage.NEGOTIATING,
    DealStage.PENDING_PAYMENT,
    DealStage.CLOSED_WON,
    DealStage.LEAD,
  ];

  const generatedDeals: DealSeed[] = stagePattern.map((stage, index) => {
    const client = clientSeeds[index % clientSeeds.length];
    const watch = watchSeeds[(index * 3 + 5) % watchSeeds.length];
    const basePrice = watch.price;
    const agreedPrice = Math.round((basePrice * (0.94 + (index % 7) * 0.012)) / 10) * 10;
    const createdAtDaysAgo = peakDayOffsets[index];
    const stageProgressDays =
      stage === DealStage.LEAD
        ? 1
        : stage === DealStage.INTERESTED
          ? 4
          : stage === DealStage.NEGOTIATING
            ? 8
            : stage === DealStage.PENDING_PAYMENT
              ? 12
              : stage === DealStage.CLOSED_WON
                ? 18
                : 14;
    const updatedAtDaysAgo = clamp(createdAtDaysAgo - stageProgressDays, 1, createdAtDaysAgo);
    const expectedCloseInDays =
      stage === DealStage.CLOSED_WON || stage === DealStage.CLOSED_LOST
        ? null
        : 5 + (index % 24);

    return {
      key: `dx${index + 1}`,
      clientKey: client.key,
      watchKey: watch.key,
      stage,
      expectedCloseInDays,
      agreedPrice,
      notes:
        stage === DealStage.CLOSED_WON
          ? 'Historical conversion closed after structured follow-up cadence.'
          : stage === DealStage.CLOSED_LOST
            ? 'Opportunity cooled after valuation alignment discussion.'
            : 'Historical pipeline opportunity retained for realistic trend coverage.',
      createdAtDaysAgo,
      updatedAtDaysAgo,
    };
  });

  const allDealSeeds: DealSeed[] = [...dealSeeds, ...generatedDeals];

  const dealByKey = new Map<string, { id: string; stage: DealStage; agreedPrice: number; updatedAtDaysAgo: number }>();
  for (const deal of allDealSeeds) {
    const client = clientByKey.get(deal.clientKey);
    const watch = watchByKey.get(deal.watchKey);
    if (!client || !watch) continue;

    const created = await prisma.deal.create({
      data: {
        tenantId: tenant.id,
        clientId: client.id,
        watchId: watch.id,
        stage: deal.stage,
        expectedCloseAt:
          deal.expectedCloseInDays === null ? null : daysFromNow(deal.expectedCloseInDays),
        agreedPrice: new Prisma.Decimal(deal.agreedPrice),
        notes: deal.notes,
        createdAt: daysAgo(deal.createdAtDaysAgo),
        updatedAt: daysAgo(deal.updatedAtDaysAgo),
      },
      select: { id: true },
    });
    timelineCoverageDates.push(daysAgo(deal.createdAtDaysAgo));
    timelineCoverageDates.push(daysAgo(deal.updatedAtDaysAgo));
    dealByKey.set(deal.key, {
      id: created.id,
      stage: deal.stage,
      agreedPrice: deal.agreedPrice,
      updatedAtDaysAgo: deal.updatedAtDaysAgo,
    });
  }

  // Keep inventory status coherent with seeded pipeline outcomes.
  await prisma.watch.update({ where: { id: watchByKey.get('w2')!.id }, data: { status: WatchStatus.RESERVED } });
  await prisma.watch.update({ where: { id: watchByKey.get('w7')!.id }, data: { status: WatchStatus.RESERVED } });
  await prisma.watch.update({ where: { id: watchByKey.get('w19')!.id }, data: { status: WatchStatus.RESERVED } });
  await prisma.watch.update({ where: { id: watchByKey.get('w3')!.id }, data: { status: WatchStatus.SOLD } });
  await prisma.watch.update({ where: { id: watchByKey.get('w15')!.id }, data: { status: WatchStatus.SOLD } });
  await prisma.watch.update({ where: { id: watchByKey.get('w28')!.id }, data: { status: WatchStatus.SOLD } });

  const paymentSeeds: PaymentSeed[] = [
    {
      dealKey: 'd4',
      amount: 6800,
      method: PaymentMethod.CARD,
      status: PaymentStatus.PAID,
      dueDateDaysOffset: null,
      paidAtDaysAgo: 14,
      notes: 'Single card settlement.',
    },
    {
      dealKey: 'd5',
      amount: 3000,
      method: PaymentMethod.TRANSFER,
      status: PaymentStatus.PAID,
      dueDateDaysOffset: null,
      paidAtDaysAgo: 9,
      notes: 'Deposit transfer received.',
    },
    {
      dealKey: 'd5',
      amount: 3400,
      method: PaymentMethod.CARD,
      status: PaymentStatus.PAID,
      dueDateDaysOffset: null,
      paidAtDaysAgo: 8,
      notes: 'Final balance settled.',
    },
    {
      dealKey: 'd10',
      amount: 105000,
      method: PaymentMethod.TRANSFER,
      status: PaymentStatus.PAID,
      dueDateDaysOffset: null,
      paidAtDaysAgo: 32,
      notes: 'Initial tranche from private client desk.',
    },
    {
      dealKey: 'd10',
      amount: 105000,
      method: PaymentMethod.TRANSFER,
      status: PaymentStatus.PAID,
      dueDateDaysOffset: null,
      paidAtDaysAgo: 30,
      notes: 'Final tranche confirmed.',
    },
    {
      dealKey: 'd2',
      amount: 5000,
      method: PaymentMethod.TRANSFER,
      status: PaymentStatus.PAID,
      dueDateDaysOffset: null,
      paidAtDaysAgo: 3,
      notes: 'Reservation deposit received.',
    },
    {
      dealKey: 'd2',
      amount: 17300,
      method: PaymentMethod.TRANSFER,
      status: PaymentStatus.PENDING,
      dueDateDaysOffset: 4,
      paidAtDaysAgo: null,
      notes: 'Final transfer expected before release.',
    },
    {
      dealKey: 'd11',
      amount: 2500,
      method: PaymentMethod.CASH,
      status: PaymentStatus.PAID,
      dueDateDaysOffset: null,
      paidAtDaysAgo: 5,
      notes: 'Cash component collected at showroom.',
    },
    {
      dealKey: 'd11',
      amount: 3550,
      method: PaymentMethod.TRANSFER,
      status: PaymentStatus.OVERDUE,
      dueDateDaysOffset: -3,
      paidAtDaysAgo: null,
      notes: 'Invoice overdue; reminder sent.',
    },
    {
      dealKey: 'd3',
      amount: 15000,
      method: PaymentMethod.TRANSFER,
      status: PaymentStatus.PENDING,
      dueDateDaysOffset: 10,
      paidAtDaysAgo: null,
      notes: 'Soft hold deposit requested.',
    },
    {
      dealKey: 'd8',
      amount: 25000,
      method: PaymentMethod.TRANSFER,
      status: PaymentStatus.PENDING,
      dueDateDaysOffset: 7,
      paidAtDaysAgo: null,
      notes: 'Allocation hold pending escrow confirmation.',
    },
    {
      dealKey: 'd9',
      amount: 2500,
      method: PaymentMethod.CARD,
      status: PaymentStatus.PENDING,
      dueDateDaysOffset: 6,
      paidAtDaysAgo: null,
      notes: 'Token payment link sent.',
    },
    {
      dealKey: 'd13',
      amount: 4000,
      method: PaymentMethod.CARD,
      status: PaymentStatus.PENDING,
      dueDateDaysOffset: -2,
      paidAtDaysAgo: null,
      notes: 'Advance expected after appraisal; currently overdue.',
    },
    {
      dealKey: 'd15',
      amount: 5000,
      method: PaymentMethod.TRANSFER,
      status: PaymentStatus.PENDING,
      dueDateDaysOffset: 9,
      paidAtDaysAgo: null,
      notes: 'Interest deposit pending approval.',
    },
  ];

  const generatedPayments: PaymentSeed[] = [];
  for (const deal of allDealSeeds) {
    if (deal.stage === DealStage.CLOSED_WON) {
      const splitFactor = (deal.createdAtDaysAgo + deal.updatedAtDaysAgo) % 3;
      if (splitFactor === 0) {
        generatedPayments.push({
          dealKey: deal.key,
          amount: Math.round(deal.agreedPrice * 0.4),
          method: PaymentMethod.TRANSFER,
          status: PaymentStatus.PAID,
          dueDateDaysOffset: null,
          paidAtDaysAgo: clamp(deal.updatedAtDaysAgo - 2, 1, 179),
          notes: 'Historical tranche 1 settled.',
        });
        generatedPayments.push({
          dealKey: deal.key,
          amount: deal.agreedPrice - Math.round(deal.agreedPrice * 0.4),
          method: PaymentMethod.TRANSFER,
          status: PaymentStatus.PAID,
          dueDateDaysOffset: null,
          paidAtDaysAgo: clamp(deal.updatedAtDaysAgo - 1, 0, 179),
          notes: 'Historical tranche 2 settled.',
        });
      } else {
        generatedPayments.push({
          dealKey: deal.key,
          amount: deal.agreedPrice,
          method: splitFactor === 1 ? PaymentMethod.CARD : PaymentMethod.TRANSFER,
          status: PaymentStatus.PAID,
          dueDateDaysOffset: null,
          paidAtDaysAgo: clamp(deal.updatedAtDaysAgo, 0, 179),
          notes: 'Historical single-settlement deal.',
        });
      }
      continue;
    }

    if (deal.stage === DealStage.PENDING_PAYMENT) {
      const deposit = Math.round(deal.agreedPrice * 0.22);
      generatedPayments.push({
        dealKey: deal.key,
        amount: deposit,
        method: PaymentMethod.TRANSFER,
        status: PaymentStatus.PAID,
        dueDateDaysOffset: null,
        paidAtDaysAgo: clamp(deal.updatedAtDaysAgo + 2, 1, 179),
        notes: 'Deposit confirmed on pending-payment opportunity.',
      });
      const dueOffset = ((deal.updatedAtDaysAgo + deal.createdAtDaysAgo) % 9) - 3; // some overdue
      generatedPayments.push({
        dealKey: deal.key,
        amount: deal.agreedPrice - deposit,
        method: PaymentMethod.TRANSFER,
        status: PaymentStatus.PENDING,
        dueDateDaysOffset: dueOffset,
        paidAtDaysAgo: null,
        notes:
          dueOffset < 0
            ? 'Balance now overdue pending reconciliation.'
            : 'Balance invoice open with agreed payment window.',
      });
      continue;
    }

    if (deal.stage === DealStage.NEGOTIATING || deal.stage === DealStage.INTERESTED) {
      if ((deal.createdAtDaysAgo + deal.updatedAtDaysAgo) % 2 === 0) {
        generatedPayments.push({
          dealKey: deal.key,
          amount: Math.round(deal.agreedPrice * 0.1),
          method: PaymentMethod.CARD,
          status: PaymentStatus.PENDING,
          dueDateDaysOffset: 7 + ((deal.createdAtDaysAgo + deal.updatedAtDaysAgo) % 5),
          paidAtDaysAgo: null,
          notes: 'Token reservation payment requested.',
        });
      }
    }
  }

  const allPaymentSeeds: PaymentSeed[] = [...paymentSeeds, ...generatedPayments];

  let paymentCount = 0;
  for (const payment of allPaymentSeeds) {
    const deal = dealByKey.get(payment.dealKey);
    if (!deal) continue;
    await prisma.payment.create({
      data: {
        tenantId: tenant.id,
        dealId: deal.id,
        amount: new Prisma.Decimal(payment.amount),
        method: payment.method,
        status: payment.status,
        dueDate:
          payment.dueDateDaysOffset === null
            ? null
            : daysFromNow(payment.dueDateDaysOffset),
        paidAt: payment.paidAtDaysAgo === null ? null : daysAgo(payment.paidAtDaysAgo),
        notes: payment.notes,
      },
    });
    if (payment.paidAtDaysAgo !== null) {
      timelineCoverageDates.push(daysAgo(payment.paidAtDaysAgo));
    }
    paymentCount += 1;
  }

  // Deterministic matching suggestions derived from preferences and available/reserved watches.
  const candidateWatches = watchSeeds
    .filter((watch) => watch.status !== WatchStatus.SOLD)
    .map((watch) => ({
      ...watch,
      id: watchByKey.get(watch.key)?.id ?? '',
    }))
    .filter((watch) => watch.id);

  let matchSuggestionCount = 0;
  const insertedPairs = new Set<string>();
  for (const pref of preferenceSeeds) {
    const client = clientByKey.get(pref.clientKey);
    if (!client) continue;

    const scored = candidateWatches
      .map((watch) => {
        let score = 20;
        const reasons: string[] = [];
        if (pref.preferredBrands.includes(watch.brand)) {
          score += 35;
          reasons.push(`Brand match: ${watch.brand}`);
        }
        if (
          pref.preferredModels.some((modelToken) =>
            `${watch.model} ${watch.reference}`.toLowerCase().includes(modelToken.toLowerCase()),
          )
        ) {
          score += 30;
          reasons.push(`Model affinity: ${watch.model}`);
        }
        const inBudget =
          (pref.budgetMin === null || watch.price >= pref.budgetMin) &&
          (pref.budgetMax === null || watch.price <= pref.budgetMax);
        if (inBudget) {
          score += 20;
          reasons.push('Budget match');
        }
        if (client.tags.some((tag) => pref.preferredBrands.join(' ').includes(tag))) {
          score += 5;
          reasons.push('Tag alignment');
        }
        return { watch, score, reasons };
      })
      .filter((item) => item.score >= 55)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    for (const item of scored) {
      const key = `${client.id}:${item.watch.id}`;
      if (insertedPairs.has(key)) continue;
      insertedPairs.add(key);
      await prisma.matchSuggestion.create({
        data: {
          tenantId: tenant.id,
          clientId: client.id,
          watchId: item.watch.id,
          score: Math.min(98, item.score),
          reason: item.reasons.join('; ') || 'General profile fit',
          dismissedAt: null,
        },
      });
      matchSuggestionCount += 1;
    }
  }

  const staleDealThreshold = 10;
  const staleDealCount = allDealSeeds.filter((deal) => {
    const open = [
      DealStage.LEAD,
      DealStage.INTERESTED,
      DealStage.NEGOTIATING,
      DealStage.PENDING_PAYMENT,
    ].includes(deal.stage);
    return open && deal.updatedAtDaysAgo > staleDealThreshold;
  }).length;

  const overduePaymentThreshold = 0;
  const overduePaymentCount = allPaymentSeeds.filter(
    (payment) =>
      payment.status === PaymentStatus.PENDING &&
      payment.dueDateDaysOffset !== null &&
      payment.dueDateDaysOffset < overduePaymentThreshold,
  ).length;

  const agingInventoryThreshold = 60;
  const agingInventoryCount = watchSeeds.filter(
    (watch) => watch.status !== WatchStatus.SOLD && watch.createdAtDaysAgo > agingInventoryThreshold,
  ).length;

  const staleRule = await prisma.automationRule.create({
    data: {
      tenantId: tenant.id,
      type: AutomationRuleType.STALE_DEAL,
      isEnabled: true,
      thresholdDays: staleDealThreshold,
    },
  });
  const overdueRule = await prisma.automationRule.create({
    data: {
      tenantId: tenant.id,
      type: AutomationRuleType.OVERDUE_PAYMENT,
      isEnabled: true,
      thresholdDays: 1,
    },
  });
  const agingRule = await prisma.automationRule.create({
    data: {
      tenantId: tenant.id,
      type: AutomationRuleType.AGING_INVENTORY,
      isEnabled: true,
      thresholdDays: agingInventoryThreshold,
    },
  });

  await prisma.automationRun.createMany({
    data: [
      {
        tenantId: tenant.id,
        ruleId: staleRule.id,
        status: AutomationRunStatus.SUCCESS,
        resultCount: staleDealCount,
        createdAt: daysAgo(1),
      },
      {
        tenantId: tenant.id,
        ruleId: overdueRule.id,
        status: AutomationRunStatus.SUCCESS,
        resultCount: overduePaymentCount,
        createdAt: daysAgo(1),
      },
      {
        tenantId: tenant.id,
        ruleId: agingRule.id,
        status: AutomationRunStatus.SUCCESS,
        resultCount: agingInventoryCount,
        createdAt: daysAgo(1),
      },
    ],
  });

  for (const watch of watchSeeds) {
    timelineCoverageDates.push(daysAgo(watch.createdAtDaysAgo));
  }
  const earliestDate = new Date(
    Math.min(...timelineCoverageDates.map((date) => date.getTime())),
  );
  const latestDate = new Date(
    Math.max(...timelineCoverageDates.map((date) => date.getTime())),
  );

  console.log('Seed complete');
  console.log({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    userEmail,
    role: role.name,
    counts: {
      watches: watchSeeds.length,
      clients: clientSeeds.length,
      clientPreferences: preferenceSeeds.length,
      interactions: interactionCount,
      deals: allDealSeeds.length,
      payments: paymentCount,
      matchSuggestions: matchSuggestionCount,
      automationRules: 3,
      automationRuns: 3,
    },
    coverage: {
      earliest: earliestDate.toISOString(),
      latest: latestDate.toISOString(),
    },
    notable: {
      staleDeals: staleDealCount,
      overduePayments: overduePaymentCount,
      agingInventory: agingInventoryCount,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
