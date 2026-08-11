import {
  AutomationRuleType,
  AutomationRunStatus,
  ClientInteractionType,
  DealStage,
  OperatingExpenseCategory,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  PrismaClient,
  TenantStatus,
  UserStatus,
  WatchExpenseCategory,
  WatchOwnershipType,
  WatchStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { seedWatchReferences } from './seeds/watch-references';

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
  priceMin: number;
  priceMax: number;
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

type WatchExpenseSeed = {
  watchKey: string;
  category: WatchExpenseCategory;
  amount: number;
  notes: string | null;
};

type OperatingExpenseSeed = {
  category: OperatingExpenseCategory;
  amount: number;
  notes: string | null;
  daysAgoOffset: number;
};

// ---------------------------------------------------------------------------
// Watch seeds (60 total)
// ---------------------------------------------------------------------------

const watchSeeds: WatchSeed[] = [
  {
    key: 'w1',
    brand: 'Rolex',
    model: 'Submariner Date',
    reference: '126610LN',
    serialNumber: 'RX-4F21-9A7C',
    condition: 'Excellent, full set 2022',
    cost: 196100,
    priceMin: 249750,
    priceMax: 262700,
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
    cost: 336700,
    priceMin: 403300,
    priceMax: 429200,
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
    cost: 477300,
    priceMin: 601250,
    priceMax: 647500,
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
    cost: 686350,
    priceMin: 804750,
    priceMax: 851000,
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
    cost: 540200,
    priceMin: 656750,
    priceMax: 706700,
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
    cost: 1563250,
    priceMin: 1813000,
    priceMax: 1961000,
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
    cost: 754800,
    priceMin: 860250,
    priceMax: 910200,
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
    cost: 86950,
    priceMin: 120250,
    priceMax: 135050,
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
    cost: 144300,
    priceMin: 199800,
    priceMax: 218300,
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
    cost: 79550,
    priceMin: 114700,
    priceMax: 127650,
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
    cost: 52730,
    priceMin: 75850,
    priceMax: 85100,
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
    cost: 42550,
    priceMin: 62900,
    priceMax: 72150,
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
    cost: 54580,
    priceMin: 79550,
    priceMax: 90650,
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
    cost: 2368000,
    priceMin: 2775000,
    priceMax: 3015500,
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
    cost: 3182000,
    priceMin: 3848000,
    priceMax: 4070000,
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
    cost: 170200,
    priceMin: 225700,
    priceMax: 249750,
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
    cost: 179450,
    priceMin: 229400,
    priceMax: 246050,
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
    cost: 553150,
    priceMin: 699300,
    priceMax: 752950,
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
    cost: 233100,
    priceMin: 312650,
    priceMax: 345950,
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
    cost: 75850,
    priceMin: 109150,
    priceMax: 120250,
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
    cost: 636400,
    priceMin: 749250,
    priceMax: 808450,
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
    cost: 48100,
    priceMin: 68450,
    priceMax: 79550,
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
    cost: 212750,
    priceMin: 271950,
    priceMax: 297850,
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
    cost: 421800,
    priceMin: 508750,
    priceMax: 549450,
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
    cost: 2645500,
    priceMin: 3145000,
    priceMax: 3367000,
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
    cost: 96200,
    priceMin: 133200,
    priceMax: 146150,
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
    cost: 68450,
    priceMin: 98050,
    priceMax: 109150,
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
    cost: 1359750,
    priceMin: 1600250,
    priceMax: 1727900,
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
    cost: 349650,
    priceMin: 438450,
    priceMax: 479150,
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
    cost: 59200,
    priceMin: 86950,
    priceMax: 96200,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 19,
  },
  // --- 30 new watches ---
  {
    key: 'w31',
    brand: 'IWC',
    model: 'Portugieser Chronograph',
    reference: 'IW371604',
    serialNumber: 'IW-3P71-6C4A',
    condition: 'Excellent, full set 2023',
    cost: 133200,
    priceMin: 175750,
    priceMax: 194250,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 23,
  },
  {
    key: 'w32',
    brand: 'Jaeger-LeCoultre',
    model: 'Reverso Classic Large',
    reference: 'Q3858522',
    serialNumber: 'JL-3R58-5C2D',
    condition: 'Very good, complete papers',
    cost: 164650,
    priceMin: 212750,
    priceMax: 236800,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 37,
  },
  {
    key: 'w33',
    brand: 'Vacheron Constantin',
    model: 'Overseas Automatic',
    reference: '4500V/110A-B483',
    serialNumber: 'VC-4V50-1A8B',
    condition: 'Excellent, three-strap set',
    cost: 453250,
    priceMin: 558700,
    priceMax: 610500,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Constellation Capital',
    consignmentSplitPercentage: 77,
    createdAtDaysAgo: 67,
  },
  {
    key: 'w34',
    brand: 'Breitling',
    model: 'Navitimer B01 Chronograph 43',
    reference: 'AB0138211B1A1',
    serialNumber: 'BR-4N01-3B1A',
    condition: 'Excellent, complete set',
    cost: 125800,
    priceMin: 166500,
    priceMax: 188700,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 31,
  },
  {
    key: 'w35',
    brand: 'Rolex',
    model: 'Milgauss Green Crystal',
    reference: '116400GV',
    serialNumber: 'RX-1M64-0G2V',
    condition: 'Very good, full kit',
    cost: 175750,
    priceMin: 236800,
    priceMax: 259000,
    status: WatchStatus.RESERVED,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 55,
  },
  {
    key: 'w36',
    brand: 'Omega',
    model: 'Constellation Co-Axial 41mm',
    reference: '131.10.41.21.06.001',
    serialNumber: 'OM-1C41-2X1M',
    condition: 'Mint, unworn',
    cost: 59200,
    priceMin: 88800,
    priceMax: 99900,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 12,
  },
  {
    key: 'w37',
    brand: 'Cartier',
    model: 'Pasha de Cartier 41mm',
    reference: 'CRWGSA0011',
    serialNumber: 'CA-6P41-3G8A',
    condition: 'Very good, serviced',
    cost: 120250,
    priceMin: 164650,
    priceMax: 181300,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 44,
  },
  {
    key: 'w38',
    brand: 'Tudor',
    model: 'Ranger 39mm',
    reference: 'M79950-0001',
    serialNumber: 'TD-7R39-5N1K',
    condition: 'Excellent, near unworn',
    cost: 38850,
    priceMin: 59200,
    priceMax: 68450,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 8,
  },
  {
    key: 'w39',
    brand: 'IWC',
    model: "Pilot's Watch Mark XX 40mm",
    reference: 'IW328201',
    serialNumber: 'IW-3P28-2M0B',
    condition: 'Excellent, complete box',
    cost: 96200,
    priceMin: 129500,
    priceMax: 144300,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 19,
  },
  {
    key: 'w40',
    brand: 'Rolex',
    model: 'Day-Date 40 President',
    reference: '228235',
    serialNumber: 'RX-2D40-3P5R',
    condition: 'Excellent, full set',
    cost: 601250,
    priceMin: 754800,
    priceMax: 823250,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Halcyon Estate Trust',
    consignmentSplitPercentage: 82,
    createdAtDaysAgo: 92,
  },
  {
    key: 'w41',
    brand: 'Audemars Piguet',
    model: 'Royal Oak Perpetual Calendar',
    reference: '26574ST.OO.1220ST.02',
    serialNumber: 'AP-2R65-7P4C',
    condition: 'Excellent, unworn strap',
    cost: 1452250,
    priceMin: 1766750,
    priceMax: 1905500,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Zephyr Private Equity',
    consignmentSplitPercentage: 80,
    createdAtDaysAgo: 115,
  },
  {
    key: 'w42',
    brand: 'Patek Philippe',
    model: 'Grand Complications',
    reference: '5204R-001',
    serialNumber: 'PP-5G04-R1C2',
    condition: 'Very good, complete documentation',
    cost: 2497500,
    priceMin: 3052500,
    priceMax: 3293000,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Arcadian Holdings',
    consignmentSplitPercentage: 83,
    createdAtDaysAgo: 140,
  },
  {
    key: 'w43',
    brand: 'Breitling',
    model: 'Chronomat B01 42mm',
    reference: 'AB0134101G1A1',
    serialNumber: 'BR-4C01-3B2A',
    condition: 'Excellent, rouleaux bracelet',
    cost: 136900,
    priceMin: 181300,
    priceMax: 201650,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 26,
  },
  {
    key: 'w44',
    brand: 'Rolex',
    model: 'GMT-Master II Batman',
    reference: '126710BLNR',
    serialNumber: 'RX-1G71-0B3N',
    condition: 'Excellent, Jubilee bracelet',
    cost: 323750,
    priceMin: 388500,
    priceMax: 434750,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 16,
  },
  {
    key: 'w45',
    brand: 'Jaeger-LeCoultre',
    model: 'Master Ultra Thin Perpetual',
    reference: 'Q1303520',
    serialNumber: 'JL-1M30-3P2T',
    condition: 'Excellent, complete set',
    cost: 518000,
    priceMin: 647500,
    priceMax: 712250,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Luminary Family Office',
    consignmentSplitPercentage: 76,
    createdAtDaysAgo: 83,
  },
  {
    key: 'w46',
    brand: 'Hublot',
    model: 'Classic Fusion Titanium 45mm',
    reference: '511.NX.1170.NX',
    serialNumber: 'HU-5C11-N1X7',
    condition: 'Excellent',
    cost: 125800,
    priceMin: 170200,
    priceMax: 192400,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 34,
  },
  {
    key: 'w47',
    brand: 'Omega',
    model: 'Speedmaster 57',
    reference: '332.10.41.51.01.001',
    serialNumber: 'OM-3S57-1A1C',
    condition: 'Excellent, full set',
    cost: 133200,
    priceMin: 181300,
    priceMax: 201650,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 48,
  },
  {
    key: 'w48',
    brand: 'Cartier',
    model: 'Panthère de Cartier Medium',
    reference: 'WSPN0006',
    serialNumber: 'CA-2P36-6N0M',
    condition: 'Very good, full set',
    cost: 109150,
    priceMin: 146150,
    priceMax: 162800,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 29,
  },
  {
    key: 'w49',
    brand: 'Rolex',
    model: 'Pearlmaster 39',
    reference: '86348SABLV',
    serialNumber: 'RX-8P39-3S4B',
    condition: 'Excellent, diamond-set',
    cost: 647500,
    priceMin: 804750,
    priceMax: 869500,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Ivory Gate Partners',
    consignmentSplitPercentage: 81,
    createdAtDaysAgo: 76,
  },
  {
    key: 'w50',
    brand: 'Audemars Piguet',
    model: 'Royal Oak Offshore Diver',
    reference: '15720ST.OO.A002CA.01',
    serialNumber: 'AP-1R72-0D2C',
    condition: 'Excellent, full set',
    cost: 573500,
    priceMin: 712250,
    priceMax: 777000,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 53,
  },
  {
    key: 'w51',
    brand: 'Vacheron Constantin',
    model: 'Patrimony',
    reference: '85180/000R-9248',
    serialNumber: 'VC-8P18-0R9B',
    condition: 'Mint, complete papers',
    cost: 407000,
    priceMin: 508750,
    priceMax: 558700,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Nordic Trust Management',
    consignmentSplitPercentage: 75,
    createdAtDaysAgo: 98,
  },
  {
    key: 'w52',
    brand: 'Patek Philippe',
    model: 'Aquanaut Travel Time',
    reference: '5164A-001',
    serialNumber: 'PP-5A64-T1V2',
    condition: 'Excellent, full set',
    cost: 888000,
    priceMin: 1073000,
    priceMax: 1165500,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 130,
  },
  {
    key: 'w53',
    brand: 'Tudor',
    model: 'Black Bay 41',
    reference: 'M79540-0004',
    serialNumber: 'TD-7B41-5N4M',
    condition: 'Excellent, new links',
    cost: 51800,
    priceMin: 77700,
    priceMax: 86950,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 7,
  },
  {
    key: 'w54',
    brand: 'IWC',
    model: "Big Pilot's Watch 43mm",
    reference: 'IW329301',
    serialNumber: 'IW-3B29-3P1C',
    condition: 'Very good, complete set',
    cost: 140600,
    priceMin: 188700,
    priceMax: 212750,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 42,
  },
  {
    key: 'w55',
    brand: 'Rolex',
    model: 'Cellini Time',
    reference: '50509RBR',
    serialNumber: 'RX-5C50-9R4B',
    condition: 'Excellent, complete set',
    cost: 114700,
    priceMin: 155400,
    priceMax: 172050,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 62,
  },
  {
    key: 'w56',
    brand: 'Audemars Piguet',
    model: 'Millenary 4101',
    reference: '15350ST.OO.D002CR.01',
    serialNumber: 'AP-1M43-5D0C',
    condition: 'Very good, box and papers',
    cost: 721500,
    priceMin: 869500,
    priceMax: 943500,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.CONSIGNMENT,
    consignmentOwnerName: 'Quorum Wealth Advisors',
    consignmentSplitPercentage: 78,
    createdAtDaysAgo: 108,
  },
  {
    key: 'w57',
    brand: 'Hublot',
    model: 'Big Bang Unico Steel 42mm',
    reference: '441.NX.1170.RX',
    serialNumber: 'HU-4B42-N1X0',
    condition: 'Excellent, full set',
    cost: 212750,
    priceMin: 281200,
    priceMax: 314500,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 38,
  },
  {
    key: 'w58',
    brand: 'Rolex',
    model: 'Submariner No-Date',
    reference: '124060',
    serialNumber: 'RX-1S60-4N0D',
    condition: 'Excellent, full set 2021',
    cost: 164650,
    priceMin: 212750,
    priceMax: 236800,
    status: WatchStatus.SOLD,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 89,
  },
  {
    key: 'w59',
    brand: 'Tudor',
    model: 'Pelagos FXD',
    reference: 'M25717N-0001',
    serialNumber: 'TD-2P57-1F3D',
    condition: 'Mint, near unworn',
    cost: 66600,
    priceMin: 99900,
    priceMax: 111000,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 22,
  },
  {
    key: 'w60',
    brand: 'Omega',
    model: 'De Ville Trésor',
    reference: '432.53.40.21.13.001',
    serialNumber: 'OM-4D40-5T1X',
    condition: 'Mint, complete set',
    cost: 88800,
    priceMin: 125800,
    priceMax: 138750,
    status: WatchStatus.AVAILABLE,
    ownershipType: WatchOwnershipType.OWNED,
    createdAtDaysAgo: 15,
  },
];

// ---------------------------------------------------------------------------
// Watch expense seeds (~20 watches, 1-3 expenses each)
// ---------------------------------------------------------------------------

const watchExpenseSeeds: WatchExpenseSeed[] = [
  { watchKey: 'w14', category: WatchExpenseCategory.REPAIR, amount: 51800, notes: 'Movement service and case reconditioning' },
  { watchKey: 'w14', category: WatchExpenseCategory.POLISHING, amount: 12030, notes: 'Case and bracelet polishing to near-new' },
  { watchKey: 'w14', category: WatchExpenseCategory.SHIPPING, amount: 3420, notes: 'Insured express shipping from seller' },
  { watchKey: 'w6', category: WatchExpenseCategory.REPAIR, amount: 22200, notes: 'Bracelet link replacement and regulation' },
  { watchKey: 'w6', category: WatchExpenseCategory.POLISHING, amount: 8880, notes: 'Light case polish — original finish preserved' },
  { watchKey: 'w42', category: WatchExpenseCategory.REPAIR, amount: 64750, notes: 'Full movement service — authorized watchmaker' },
  { watchKey: 'w42', category: WatchExpenseCategory.POLISHING, amount: 14430, notes: 'Case and integrated bracelet detailed' },
  { watchKey: 'w42', category: WatchExpenseCategory.SHIPPING, amount: 6480, notes: 'Insured international shipping with white-glove handling' },
  { watchKey: 'w15', category: WatchExpenseCategory.REPAIR, amount: 33300, notes: 'Tonneau case and movement inspection' },
  { watchKey: 'w15', category: WatchExpenseCategory.POLISHING, amount: 9070, notes: 'Light surface finishing' },
  { watchKey: 'w25', category: WatchExpenseCategory.REPAIR, amount: 40700, notes: 'Ultra-flat movement service' },
  { watchKey: 'w25', category: WatchExpenseCategory.POLISHING, amount: 10730, notes: 'Case and crown polishing' },
  { watchKey: 'w4', category: WatchExpenseCategory.POLISHING, amount: 7030, notes: 'Integrated bracelet and case light polish' },
  { watchKey: 'w28', category: WatchExpenseCategory.REPAIR, amount: 17580, notes: 'Calibre 2121 regulation and check' },
  { watchKey: 'w28', category: WatchExpenseCategory.POLISHING, amount: 7770, notes: 'Case polishing per buyer request' },
  { watchKey: 'w41', category: WatchExpenseCategory.REPAIR, amount: 25900, notes: 'Perpetual calendar mechanism check' },
  { watchKey: 'w41', category: WatchExpenseCategory.POLISHING, amount: 9440, notes: 'Full case polish' },
  { watchKey: 'w52', category: WatchExpenseCategory.REPAIR, amount: 16470, notes: 'Travel time mechanism verification' },
  { watchKey: 'w18', category: WatchExpenseCategory.REPAIR, amount: 13320, notes: 'Annual calendar module service' },
  { watchKey: 'w1', category: WatchExpenseCategory.POLISHING, amount: 5180, notes: 'Bracelet polish pre-listing' },
  { watchKey: 'w3', category: WatchExpenseCategory.LINKS, amount: 3610, notes: 'Extra links fitted for new owner' },
  { watchKey: 'w16', category: WatchExpenseCategory.POLISHING, amount: 4810, notes: 'Fluted bezel and case polish' },
  { watchKey: 'w40', category: WatchExpenseCategory.POLISHING, amount: 6290, notes: 'President bracelet and case polish' },
  { watchKey: 'w44', category: WatchExpenseCategory.POLISHING, amount: 5090, notes: 'Jubilee bracelet polish' },
  { watchKey: 'w49', category: WatchExpenseCategory.POLISHING, amount: 5920, notes: 'Diamond-set case light clean and polish' },
  { watchKey: 'w5', category: WatchExpenseCategory.SHIPPING, amount: 4070, notes: 'Express courier to buyer' },
  { watchKey: 'w33', category: WatchExpenseCategory.REPAIR, amount: 12580, notes: 'Interchangeable strap mechanism service' },
  { watchKey: 'w45', category: WatchExpenseCategory.REPAIR, amount: 10730, notes: 'Perpetual calendar service check' },
  { watchKey: 'w57', category: WatchExpenseCategory.REPAIR, amount: 14430, notes: 'Rubber bezel replacement and service' },
  { watchKey: 'w21', category: WatchExpenseCategory.REPAIR, amount: 11470, notes: 'Chronograph column wheel service' },
];

// ---------------------------------------------------------------------------
// Client seeds (40 total)
// ---------------------------------------------------------------------------

const clientSeeds: ClientSeed[] = [
  {
    key: 'c1',
    name: 'Alejandro Fuentes',
    email: 'alejandro.fuentes@example.com',
    phone: '+52 55 4821 3390',
    notes: 'Prefers investment-grade sports pieces with full set and low polish history.',
    tags: ['VIP', 'Rolex', 'Repeat Buyer'],
    budgetRange: '$463k-$1.11M MXN',
  },
  {
    key: 'c2',
    name: 'Renata Salcido',
    email: 'renata.salcido@example.com',
    phone: '+52 33 5710 2246',
    notes: 'Focused on modern Patek and AP references; values discreet transaction handling.',
    tags: ['Collector', 'Patek', 'AP'],
    budgetRange: '$740k-$2.59M MXN',
  },
  {
    key: 'c3',
    name: 'Emilio Duarte',
    email: 'emilio.duarte@example.com',
    phone: '+52 81 2940 5581',
    notes: 'First-time high-end buyer, strong interest in Rolex GMT and Submariner.',
    tags: ['New Lead', 'Rolex'],
    budgetRange: '$222k-$463k MXN',
  },
  {
    key: 'c4',
    name: 'Valentina Restrepo',
    email: 'valentina.restrepo@example.com',
    phone: '+57 1 555 7724',
    notes: 'Buys for family office portfolio, prefers complete documentation.',
    tags: ['Family Office', 'High Value'],
    budgetRange: '$1.29M-$4.63M MXN',
  },
  {
    key: 'c5',
    name: 'Rafael Quintana',
    email: 'rafael.quintana@example.com',
    phone: '+52 55 3068 9412',
    notes: 'Comfortable with minor wear if pricing is attractive; likes Omega and Tudor.',
    tags: ['Value Buyer', 'Omega', 'Tudor'],
    budgetRange: '$74k-$278k MXN',
  },
  {
    key: 'c6',
    name: 'Ximena Elizondo',
    email: 'ximena.elizondo@example.com',
    phone: '+52 33 4457 1180',
    notes: 'Seeking Cartier dress models for personal wear and gifting.',
    tags: ['Cartier', 'Gift Buyer'],
    budgetRange: '$111k-$370k MXN',
  },
  {
    key: 'c7',
    name: 'Marco Peña',
    email: 'marco.pena@example.com',
    phone: '+52 81 6623 0947',
    notes: 'Actively rotates inventory, asks for fast settlement on in-demand references.',
    tags: ['Dealer', 'Fast Close'],
    budgetRange: '$278k-$925k MXN',
  },
  {
    key: 'c8',
    name: 'Ariadna Solórzano',
    email: 'ariadna.solorzano@example.com',
    phone: '+52 222 514 3376',
    notes: 'Prefers under-the-radar independent and advanced complications.',
    tags: ['Niche Collector'],
    budgetRange: '$555k-$2.22M MXN',
  },
  {
    key: 'c9',
    name: 'Noelia Esparza',
    email: 'noelia.esparza@example.com',
    phone: '+971 4 555 6203',
    notes: 'Interested in RM and AP, frequently requests private viewing appointments.',
    tags: ['Ultra High Net Worth', 'RM', 'AP'],
    budgetRange: '$2.22M-$6.47M MXN',
  },
  {
    key: 'c10',
    name: 'Patricio Valdivia',
    email: 'patricio.valdivia@example.com',
    phone: '+52 55 7702 4419',
    notes: 'Buys and flips sports models every 2-3 months.',
    tags: ['Trader', 'Rolex'],
    budgetRange: '$333k-$833k MXN',
  },
  {
    key: 'c11',
    name: 'Julieta Barragán',
    email: 'julieta.barragan@example.com',
    phone: '+52 33 2286 5570',
    notes: 'Wants clean Cartier and Omega inventory for boutique resale.',
    tags: ['Wholesale', 'Cartier', 'Omega'],
    budgetRange: '$93k-$333k MXN',
  },
  {
    key: 'c12',
    name: 'Dorian Pacheco',
    email: 'dorian.pacheco@example.com',
    phone: '+52 55 9134 0287',
    notes: 'Interested in white-dial pieces and newer warranty cards.',
    tags: ['Rolex', 'Lead'],
    budgetRange: '$185k-$648k MXN',
  },
  {
    key: 'c13',
    name: 'Helena Rosales',
    email: 'helena.rosales@example.com',
    phone: '+52 81 4470 3392',
    notes: 'Focused on heirloom pieces and milestone gifts.',
    tags: ['Gift Buyer', 'Patek'],
    budgetRange: '$370k-$1.48M MXN',
  },
  {
    key: 'c14',
    name: 'Emiliano Fraga',
    email: 'emiliano.fraga@example.com',
    phone: '+52 55 2038 7761',
    notes: 'Wants immediate delivery; price-sensitive but decisive.',
    tags: ['Urgent', 'Tudor', 'Omega'],
    budgetRange: '$56k-$222k MXN',
  },
  {
    key: 'c15',
    name: 'Aranza Landeros',
    email: 'aranza.landeros@example.com',
    phone: '+52 998 214 4483',
    notes: 'Maintains annual acquisition plan for private collection.',
    tags: ['VIP', 'Annual Plan'],
    budgetRange: '$555k-$1.67M MXN',
  },
  {
    key: 'c16',
    name: 'Rodrigo Estrada',
    email: 'rodrigo.estrada@example.com',
    phone: '+34 91 555 8827',
    notes: 'Seeks modern AP and RM, willing to prepay for allocation-priority.',
    tags: ['AP', 'RM', 'Priority Client'],
    budgetRange: '$1.67M-$4.63M MXN',
  },
  {
    key: 'c17',
    name: 'Casimiro Blanco',
    email: 'casimiro.blanco@example.com',
    phone: '+52 55 6845 1103',
    notes: 'Looking for first serious watch purchase, likes clean steel sports pieces.',
    tags: ['New Lead', 'Rolex', 'Omega'],
    budgetRange: '$148k-$407k MXN',
  },
  {
    key: 'c18',
    name: 'Nadia Crespo',
    email: 'nadia.crespo@example.com',
    phone: '+52 33 7729 4416',
    notes: 'Shopping for dual-purpose watch wardrobe: one sport, one dress.',
    tags: ['Cartier', 'Rolex'],
    budgetRange: '$222k-$740k MXN',
  },
  // --- 22 new clients ---
  {
    key: 'c19',
    name: 'Víctor Aznar',
    email: 'victor.aznar@example.com',
    phone: '+52 55 3391 6620',
    notes: 'Prefers yellow gold Rolex sport models; acquisition-minded collector.',
    tags: ['VIP', 'Rolex', 'Repeat Buyer'],
    budgetRange: '$648k-$1.48M MXN',
  },
  {
    key: 'c20',
    name: 'Selena Torres',
    email: 'selena.torres@example.com',
    phone: '+52 664 220 5537',
    notes: 'Buys Cartier for personal use and high-end gifting; prefers full set.',
    tags: ['Cartier', 'Gift Buyer'],
    budgetRange: '$148k-$463k MXN',
  },
  {
    key: 'c21',
    name: 'Demetrio Valverde',
    email: 'demetrio.valverde@example.com',
    phone: '+54 11 5550 2298',
    notes: 'Ultra HNW collector, exclusively interested in RM and AP trophy pieces.',
    tags: ['Ultra High Net Worth', 'RM', 'AP'],
    budgetRange: '$2.77M-$9.25M MXN',
  },
  {
    key: 'c22',
    name: 'Fernanda Bravo',
    email: 'fernanda.bravo@example.com',
    phone: '+52 81 5583 7724',
    notes: 'Passionate IWC and JLC collector; seeks complete papers on all acquisitions.',
    tags: ['Collector', 'IWC', 'JLC'],
    budgetRange: '$185k-$740k MXN',
  },
  {
    key: 'c23',
    name: 'Tomás Reyes',
    email: 'tomas.reyes@example.com',
    phone: '+52 55 4462 0918',
    notes: 'Entry-level collector interested in Omega; responsive and quick to decide.',
    tags: ['New Lead', 'Omega'],
    budgetRange: '$93k-$222k MXN',
  },
  {
    key: 'c24',
    name: 'Estela Orozco',
    email: 'estela.orozco@example.com',
    phone: '+52 33 6017 4482',
    notes: 'Represents family office collecting Patek and Vacheron for portfolio diversification.',
    tags: ['VIP', 'Patek', 'Vacheron'],
    budgetRange: '$1.11M-$3.7M MXN',
  },
  {
    key: 'c25',
    name: 'Conrado Marín',
    email: 'conrado.marin@example.com',
    phone: '+52 55 8823 1067',
    notes: 'Gray market dealer looking for clean Rolex sport references at competitive margins.',
    tags: ['Dealer', 'Rolex'],
    budgetRange: '$370k-$1.11M MXN',
  },
  {
    key: 'c26',
    name: 'Prisila Nájera',
    email: 'prisila.najera@example.com',
    phone: '+52 222 447 5591',
    notes: 'Sophisticated collector with focus on PP and AP complications.',
    tags: ['Collector', 'Patek', 'AP'],
    budgetRange: '$833k-$2.77M MXN',
  },
  {
    key: 'c27',
    name: 'Baltazar Huerta',
    email: 'baltazar.huerta@example.com',
    phone: '+52 81 3396 2270',
    notes: 'Active trader in Rolex and Breitling; turnaround time under 30 days typically.',
    tags: ['Trader', 'Rolex', 'Breitling'],
    budgetRange: '$167k-$555k MXN',
  },
  {
    key: 'c28',
    name: 'Isabela Fontanez',
    email: 'isabela.fontanez@example.com',
    phone: '+34 93 555 6614',
    notes: 'European family office buyer; focuses on investment-grade trophy complications.',
    tags: ['Family Office', 'High Value'],
    budgetRange: '$1.48M-$6.47M MXN',
  },
  {
    key: 'c29',
    name: 'Renato Villalobos',
    email: 'renato.villalobos@example.com',
    phone: '+52 55 6210 8843',
    notes: 'Japanese collector with deep appreciation for JLC and Omega heritage pieces.',
    tags: ['Collector', 'JLC', 'Omega'],
    budgetRange: '$148k-$648k MXN',
  },
  {
    key: 'c30',
    name: 'Lucas Romano',
    email: 'lucas.romano@example.com',
    phone: '+54 11 5550 7726',
    notes: 'Milan-based dealer specializing in Hublot and AP for Italian market resale.',
    tags: ['Dealer', 'Hublot', 'AP'],
    budgetRange: '$222k-$925k MXN',
  },
  {
    key: 'c31',
    name: 'Carlos Guzmán',
    email: 'carlos.guzman@example.com',
    phone: '+52 55 7748 3392',
    notes: 'Trophy collector exclusively pursuing RM and PP grand complications.',
    tags: ['VIP', 'RM', 'Patek'],
    budgetRange: '$1.85M-$7.4M MXN',
  },
  {
    key: 'c32',
    name: 'Ámbar Hidalgo',
    email: 'ambar.hidalgo@example.com',
    phone: '+52 33 2954 6681',
    notes: 'First watch purchase; interested in accessible Tudor and Omega models.',
    tags: ['New Lead', 'Tudor', 'Omega'],
    budgetRange: '$56k-$167k MXN',
  },
  {
    key: 'c33',
    name: 'Sebastián Cruz',
    email: 'sebastian.cruz@example.com',
    phone: '+52 998 330 1147',
    notes: 'Consistent Rolex sport trader with strong network in Latin America.',
    tags: ['Trader', 'Rolex'],
    budgetRange: '$278k-$833k MXN',
  },
  {
    key: 'c34',
    name: 'Natalia Ibarra',
    email: 'natalia.ibarra@example.com',
    phone: '+52 81 4416 5529',
    notes: 'Collects Cartier and Vacheron; prefers elegant dress watches with provenance.',
    tags: ['Collector', 'Cartier', 'Vacheron'],
    budgetRange: '$370k-$1.39M MXN',
  },
  {
    key: 'c35',
    name: 'Fabián Obregón',
    email: 'fabian.obregon@example.com',
    phone: '+52 55 5027 8834',
    notes: 'New to AP; building first serious collection with focus on Royal Oak.',
    tags: ['New Lead', 'AP'],
    budgetRange: '$555k-$1.48M MXN',
  },
  {
    key: 'c36',
    name: 'Maite Zúñiga',
    email: 'maite.zuniga@example.com',
    phone: '+52 33 8813 4470',
    notes: 'Dual focus on PP and IWC; values provenance and original condition above all.',
    tags: ['VIP', 'Patek', 'IWC'],
    budgetRange: '$463k-$1.85M MXN',
  },
  {
    key: 'c37',
    name: 'Julio Cano',
    email: 'julio.cano@example.com',
    phone: '+52 55 2286 7719',
    notes: 'Family office mandate to acquire three significant pieces annually.',
    tags: ['Family Office', 'High Value'],
    budgetRange: '$925k-$4.63M MXN',
  },
  {
    key: 'c38',
    name: 'Marisol Cortés',
    email: 'marisol.cortes@example.com',
    phone: '+52 664 552 3391',
    notes: 'Growing Omega and Tudor collection; active on social media, good referral source.',
    tags: ['Collector', 'Omega', 'Tudor'],
    budgetRange: '$74k-$278k MXN',
  },
  {
    key: 'c39',
    name: 'Octavio Bermúdez',
    email: 'octavio.bermudez@example.com',
    phone: '+52 81 7734 4462',
    notes: 'Priority client: RM, AP, and Rolex; responds quickly and pays same-day.',
    tags: ['Priority Client', 'RM', 'AP', 'Rolex'],
    budgetRange: '$1.67M-$5.55M MXN',
  },
  {
    key: 'c40',
    name: 'Cecilia Paredes',
    email: 'cecilia.paredes@example.com',
    phone: '+52 55 4483 1206',
    notes: 'Seoul-based buyer focused on Cartier for personal wear and gifting occasions.',
    tags: ['Gift Buyer', 'Cartier'],
    budgetRange: '$130k-$407k MXN',
  },
];

// ---------------------------------------------------------------------------
// Operating expense seeds (60 total)
// ---------------------------------------------------------------------------

const operatingExpenseSeeds: OperatingExpenseSeed[] = [
  // GASOLINE ×8
  { category: OperatingExpenseCategory.GASOLINE, amount: 1330, notes: 'Fuel for client delivery run', daysAgoOffset: 4 },
  { category: OperatingExpenseCategory.GASOLINE, amount: 1650, notes: 'Round trip to auction house', daysAgoOffset: 18 },
  { category: OperatingExpenseCategory.GASOLINE, amount: 1440, notes: 'Delivery service — multiple drops', daysAgoOffset: 35 },
  { category: OperatingExpenseCategory.GASOLINE, amount: 1520, notes: 'City showroom visits', daysAgoOffset: 52 },
  { category: OperatingExpenseCategory.GASOLINE, amount: 1390, notes: 'Cross-town client meeting', daysAgoOffset: 68 },
  { category: OperatingExpenseCategory.GASOLINE, amount: 1570, notes: 'Airport watch collection run', daysAgoOffset: 95 },
  { category: OperatingExpenseCategory.GASOLINE, amount: 1680, notes: 'Pre-trade-show fuel costs', daysAgoOffset: 128 },
  { category: OperatingExpenseCategory.GASOLINE, amount: 1440, notes: 'Bulk fill before Miami fair', daysAgoOffset: 162 },
  // TOLLS ×6
  { category: OperatingExpenseCategory.TOLLS, amount: 330, notes: 'Expressway tolls for delivery', daysAgoOffset: 7 },
  { category: OperatingExpenseCategory.TOLLS, amount: 440, notes: 'Bridge toll — client pickup', daysAgoOffset: 24 },
  { category: OperatingExpenseCategory.TOLLS, amount: 410, notes: 'Highway tolls — auction run', daysAgoOffset: 47 },
  { category: OperatingExpenseCategory.TOLLS, amount: 650, notes: 'Toll fees for multi-stop route', daysAgoOffset: 82 },
  { category: OperatingExpenseCategory.TOLLS, amount: 520, notes: 'Airport express tolls', daysAgoOffset: 110 },
  { category: OperatingExpenseCategory.TOLLS, amount: 390, notes: 'Event venue access tolls', daysAgoOffset: 145 },
  // WATCHMAKER ×5
  { category: OperatingExpenseCategory.WATCHMAKER, amount: 3610, notes: 'Service consultation for client piece', daysAgoOffset: 12 },
  { category: OperatingExpenseCategory.WATCHMAKER, amount: 8330, notes: 'Movement inspection pre-sale', daysAgoOffset: 38 },
  { category: OperatingExpenseCategory.WATCHMAKER, amount: 16470, notes: 'Full service on consignment arrival', daysAgoOffset: 74 },
  { category: OperatingExpenseCategory.WATCHMAKER, amount: 5920, notes: 'Certification check for RM piece', daysAgoOffset: 103 },
  { category: OperatingExpenseCategory.WATCHMAKER, amount: 10730, notes: 'Pre-sale movement verification', daysAgoOffset: 149 },
  // PARKING ×7
  { category: OperatingExpenseCategory.PARKING, amount: 520, notes: 'Client meeting downtown', daysAgoOffset: 3 },
  { category: OperatingExpenseCategory.PARKING, amount: 650, notes: 'Trade event parking', daysAgoOffset: 11 },
  { category: OperatingExpenseCategory.PARKING, amount: 780, notes: 'Airport pick-up hold', daysAgoOffset: 29 },
  { category: OperatingExpenseCategory.PARKING, amount: 560, notes: 'Hotel valet for client dinner', daysAgoOffset: 43 },
  { category: OperatingExpenseCategory.PARKING, amount: 1020, notes: 'Hourly lot during private viewing', daysAgoOffset: 67 },
  { category: OperatingExpenseCategory.PARKING, amount: 700, notes: 'Long-term lot during travel week', daysAgoOffset: 91 },
  { category: OperatingExpenseCategory.PARKING, amount: 590, notes: 'Convention center — watch fair', daysAgoOffset: 130 },
  // MEALS ×8
  { category: OperatingExpenseCategory.MEALS, amount: 1260, notes: 'Working lunch with new supplier', daysAgoOffset: 6 },
  { category: OperatingExpenseCategory.MEALS, amount: 2680, notes: 'Client lunch after viewing appointment', daysAgoOffset: 15 },
  { category: OperatingExpenseCategory.MEALS, amount: 3890, notes: 'Team dinner after trade show', daysAgoOffset: 31 },
  { category: OperatingExpenseCategory.MEALS, amount: 1630, notes: 'Prospect onboarding meal', daysAgoOffset: 49 },
  { category: OperatingExpenseCategory.MEALS, amount: 3240, notes: 'Client relationship dinner', daysAgoOffset: 72 },
  { category: OperatingExpenseCategory.MEALS, amount: 1760, notes: 'Quarterly team lunch', daysAgoOffset: 88 },
  { category: OperatingExpenseCategory.MEALS, amount: 2220, notes: 'Networking dinner at Watches & Wonders', daysAgoOffset: 116 },
  { category: OperatingExpenseCategory.MEALS, amount: 1520, notes: 'Deal close celebration — team', daysAgoOffset: 155 },
  // FLIGHTS ×5
  { category: OperatingExpenseCategory.FLIGHTS, amount: 7770, notes: 'Miami–NY round trip for private viewing', daysAgoOffset: 22 },
  { category: OperatingExpenseCategory.FLIGHTS, amount: 14430, notes: 'LA collector visit — same-day flight', daysAgoOffset: 58 },
  { category: OperatingExpenseCategory.FLIGHTS, amount: 21280, notes: 'Geneva watch fair attendance', daysAgoOffset: 96 },
  { category: OperatingExpenseCategory.FLIGHTS, amount: 12030, notes: 'Chicago client deal trip', daysAgoOffset: 135 },
  { category: OperatingExpenseCategory.FLIGHTS, amount: 9620, notes: 'Dallas auction attendance', daysAgoOffset: 168 },
  // TRAVEL ×5
  { category: OperatingExpenseCategory.TRAVEL, amount: 3610, notes: 'Hotel stay — NY collector visit', daysAgoOffset: 23 },
  { category: OperatingExpenseCategory.TRAVEL, amount: 6290, notes: 'Transport and hotel — auction house trip', daysAgoOffset: 59 },
  { category: OperatingExpenseCategory.TRAVEL, amount: 10360, notes: 'Accommodation for Geneva fair', daysAgoOffset: 97 },
  { category: OperatingExpenseCategory.TRAVEL, amount: 5180, notes: 'Ground transport and hotel — Chicago', daysAgoOffset: 136 },
  { category: OperatingExpenseCategory.TRAVEL, amount: 4260, notes: 'Hotel — Dallas deal trip', daysAgoOffset: 169 },
  // MARKETING ×8
  { category: OperatingExpenseCategory.MARKETING, amount: 7030, notes: 'Instagram targeted ads campaign', daysAgoOffset: 5 },
  { category: OperatingExpenseCategory.MARKETING, amount: 15730, notes: 'Photography session — new inventory batch', daysAgoOffset: 14 },
  { category: OperatingExpenseCategory.MARKETING, amount: 22200, notes: 'Social media management monthly fee', daysAgoOffset: 28 },
  { category: OperatingExpenseCategory.MARKETING, amount: 12030, notes: 'Print materials for collector event', daysAgoOffset: 44 },
  { category: OperatingExpenseCategory.MARKETING, amount: 38850, notes: 'Watch fair booth graphics and setup', daysAgoOffset: 63 },
  { category: OperatingExpenseCategory.MARKETING, amount: 14430, notes: 'Email campaign — curated collector list', daysAgoOffset: 84 },
  { category: OperatingExpenseCategory.MARKETING, amount: 26830, notes: 'Sponsored content partnership', daysAgoOffset: 118 },
  { category: OperatingExpenseCategory.MARKETING, amount: 17020, notes: 'Event sponsorship placement', daysAgoOffset: 152 },
  // COMMISSIONS ×8
  { category: OperatingExpenseCategory.COMMISSIONS, amount: 22200, notes: 'Referral fee — Northbridge deal', daysAgoOffset: 8 },
  { category: OperatingExpenseCategory.COMMISSIONS, amount: 62900, notes: 'Broker commission on RM 035 sale', daysAgoOffset: 20 },
  { category: OperatingExpenseCategory.COMMISSIONS, amount: 107300, notes: 'Agent fee — PP Grand Complications private sale', daysAgoOffset: 36 },
  { category: OperatingExpenseCategory.COMMISSIONS, amount: 38850, notes: 'Referral commission Q1', daysAgoOffset: 61 },
  { category: OperatingExpenseCategory.COMMISSIONS, amount: 83250, notes: 'Partner fee — family office AP deal', daysAgoOffset: 79 },
  { category: OperatingExpenseCategory.COMMISSIONS, amount: 33300, notes: 'Commission for Patek Nautilus lead', daysAgoOffset: 107 },
  { category: OperatingExpenseCategory.COMMISSIONS, amount: 59200, notes: 'Broker fee — auction access arrangement', daysAgoOffset: 138 },
  { category: OperatingExpenseCategory.COMMISSIONS, amount: 48100, notes: 'Agent commission — AP Royal Oak Jumbo sale', daysAgoOffset: 170 },
];

const DEMO_SLUG = 'wristos-demo';

async function main() {
  const tenantName = process.env.SEED_TENANT_NAME ?? 'WristOS Demo Tenant';
  const tenantSlug = process.env.SEED_TENANT_SLUG ?? DEMO_SLUG;
  const roleName = process.env.SEED_ROLE_NAME ?? 'OWNER';
  const userEmail = (process.env.SEED_USER_EMAIL ?? 'owner@wristos.local').toLowerCase();
  const userPassword = process.env.SEED_USER_PASSWORD ?? 'ChangeMe123!';

  // Safety guard: refuse to wipe a non-demo tenant unless explicitly opted in.
  if (tenantSlug !== DEMO_SLUG && process.env.SEED_ALLOW_NONDEMO !== 'true') {
    console.error(
      `\n⛔  ABORTED — tenant slug "${tenantSlug}" is not the demo tenant ("${DEMO_SLUG}").\n` +
      `   This seed DELETES ALL business data for the target tenant before re-seeding.\n` +
      `   If you truly intend to wipe and reseed "${tenantSlug}", re-run with:\n` +
      `   SEED_ALLOW_NONDEMO=true npx prisma db seed\n`,
    );
    process.exit(1);
  }

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
    where: { tenantId_name: { tenantId: tenant.id, name: roleName } },
    update: {},
    create: { tenantId: tenant.id, name: roleName },
  });

  const user = await prisma.user.upsert({
    where: { email: userEmail },
    update: { passwordHash, status: UserStatus.ACTIVE },
    create: {
      email: userEmail,
      passwordHash,
      status: UserStatus.ACTIVE,
      displayName: 'WristOS Owner',
    },
  });

  await prisma.tenantUser.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    update: { roleId: role.id },
    create: { tenantId: tenant.id, userId: user.id, roleId: role.id },
  });

  // Reset tenant business data so seed is idempotent.
  await prisma.automationRun.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.automationRule.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.matchSuggestion.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.payment.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.deal.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.clientInteraction.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.clientPreference.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.operatingExpense.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.watch.deleteMany({ where: { tenantId: tenant.id } }); // cascades watchExpenses
  await prisma.client.deleteMany({ where: { tenantId: tenant.id } });

  // --- Watches ---
  const watchByKey = new Map<string, { id: string; brand: string; model: string; priceMin: number; priceMax: number }>();
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
        priceMin: new Prisma.Decimal(watch.priceMin),
        priceMax: new Prisma.Decimal(watch.priceMax),
        status: watch.status,
        ownershipType: watch.ownershipType,
        consignmentOwnerName:
          watch.ownershipType === WatchOwnershipType.CONSIGNMENT
            ? (watch.consignmentOwnerName ?? null)
            : null,
        consignmentSplitPercentage:
          watch.ownershipType === WatchOwnershipType.CONSIGNMENT &&
          watch.consignmentSplitPercentage !== undefined
            ? new Prisma.Decimal(watch.consignmentSplitPercentage)
            : null,
        createdAt: daysAgo(watch.createdAtDaysAgo),
      },
      select: { id: true, brand: true, model: true, priceMin: true, priceMax: true },
    });
    watchByKey.set(watch.key, {
      id: created.id,
      brand: created.brand,
      model: created.model,
      priceMin: Number(created.priceMin),
      priceMax: Number(created.priceMax),
    });
  }

  // --- Watch expenses ---
  let watchExpenseCount = 0;
  for (const expense of watchExpenseSeeds) {
    const watch = watchByKey.get(expense.watchKey);
    if (!watch) continue;
    await prisma.watchExpense.create({
      data: {
        tenantId: tenant.id,
        watchId: watch.id,
        category: expense.category,
        amount: new Prisma.Decimal(expense.amount),
        notes: expense.notes,
      },
    });
    watchExpenseCount += 1;
  }

  // --- Clients ---
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

  // --- Preferences ---
  const preferenceSeeds: Array<{
    clientKey: string;
    preferredBrands: string[];
    preferredModels: string[];
    budgetMin: number | null;
    budgetMax: number | null;
    notes: string | null;
  }> = [
    { clientKey: 'c1', preferredBrands: ['Rolex', 'Patek Philippe'], preferredModels: ['Submariner', 'GMT-Master', 'Aquanaut'], budgetMin: 370000, budgetMax: 1202500, notes: 'Prioritizes complete set and strong service history.' },
    { clientKey: 'c2', preferredBrands: ['Audemars Piguet', 'Patek Philippe'], preferredModels: ['Royal Oak', 'Nautilus'], budgetMin: 925000, budgetMax: 2960000, notes: 'Wants near-mint dial and bracelet condition.' },
    { clientKey: 'c3', preferredBrands: ['Rolex'], preferredModels: ['Submariner', 'Explorer'], budgetMin: 185000, budgetMax: 481000, notes: null },
    { clientKey: 'c4', preferredBrands: ['Richard Mille', 'Audemars Piguet'], preferredModels: ['RM 011', 'Royal Oak Jumbo'], budgetMin: 1665000, budgetMax: 5180000, notes: 'Open to consignment inventory if provenance is clear.' },
    { clientKey: 'c5', preferredBrands: ['Omega', 'Tudor'], preferredModels: ['Speedmaster', 'Black Bay'], budgetMin: 74000, budgetMax: 296000, notes: null },
    { clientKey: 'c6', preferredBrands: ['Cartier'], preferredModels: ['Santos', 'Tank', 'Ballon Bleu'], budgetMin: 111000, budgetMax: 370000, notes: 'Needs gift packaging and quick turnover.' },
    { clientKey: 'c7', preferredBrands: ['Rolex', 'Audemars Piguet'], preferredModels: ['Daytona', 'Royal Oak'], budgetMin: 333000, budgetMax: 1110000, notes: null },
    { clientKey: 'c8', preferredBrands: ['Patek Philippe', 'Audemars Piguet'], preferredModels: ['Calatrava', 'Code 11.59'], budgetMin: 462500, budgetMax: 2220000, notes: null },
    { clientKey: 'c9', preferredBrands: ['Richard Mille', 'Audemars Piguet'], preferredModels: ['RM 035', 'Royal Oak'], budgetMin: 2220000, budgetMax: 6475000, notes: 'Private viewing only.' },
    { clientKey: 'c10', preferredBrands: ['Rolex'], preferredModels: ['GMT-Master', 'Sky-Dweller', 'Datejust'], budgetMin: 277500, budgetMax: 925000, notes: null },
    { clientKey: 'c11', preferredBrands: ['Cartier', 'Omega'], preferredModels: ['Santos', 'Seamaster'], budgetMin: 92500, budgetMax: 370000, notes: 'Open to wholesale lots.' },
    { clientKey: 'c12', preferredBrands: ['Rolex'], preferredModels: ['Explorer II', 'Datejust'], budgetMin: 166500, budgetMax: 666000, notes: null },
    { clientKey: 'c13', preferredBrands: ['Patek Philippe', 'Cartier'], preferredModels: ['Calatrava', 'Tank'], budgetMin: 333000, budgetMax: 1665000, notes: null },
    { clientKey: 'c16', preferredBrands: ['Audemars Piguet', 'Richard Mille'], preferredModels: ['Royal Oak', 'RM 67'], budgetMin: 1572500, budgetMax: 4810000, notes: 'Responds quickly to allocation-level opportunities.' },
    { clientKey: 'c18', preferredBrands: ['Cartier', 'Rolex'], preferredModels: ['Santos', 'Datejust', 'Yacht-Master'], budgetMin: 222000, budgetMax: 832500, notes: null },
    // new clients
    { clientKey: 'c19', preferredBrands: ['Rolex'], preferredModels: ['Day-Date', 'Sky-Dweller', 'Datejust'], budgetMin: 555000, budgetMax: 1480000, notes: 'Prefers yellow or rose gold variants.' },
    { clientKey: 'c21', preferredBrands: ['Richard Mille', 'Audemars Piguet'], preferredModels: ['RM 011', 'RM 067', 'Royal Oak Perpetual'], budgetMin: 1850000, budgetMax: 9250000, notes: 'Exclusive trophy acquisitions only.' },
    { clientKey: 'c22', preferredBrands: ['IWC', 'Jaeger-LeCoultre'], preferredModels: ['Portugieser', 'Big Pilot', 'Reverso', 'Master Ultra Thin'], budgetMin: 148000, budgetMax: 740000, notes: null },
    { clientKey: 'c24', preferredBrands: ['Patek Philippe', 'Vacheron Constantin'], preferredModels: ['Nautilus', 'Annual Calendar', 'Overseas', 'Patrimony'], budgetMin: 925000, budgetMax: 3700000, notes: 'Provenance and documentation critical.' },
    { clientKey: 'c26', preferredBrands: ['Patek Philippe', 'Audemars Piguet'], preferredModels: ['Aquanaut', 'Royal Oak', 'Calatrava'], budgetMin: 740000, budgetMax: 2960000, notes: null },
    { clientKey: 'c28', preferredBrands: ['Audemars Piguet', 'Patek Philippe', 'Richard Mille'], preferredModels: ['Royal Oak Perpetual', 'Grand Complications', 'RM 035'], budgetMin: 1480000, budgetMax: 6475000, notes: 'Investment-grade only.' },
    { clientKey: 'c31', preferredBrands: ['Richard Mille', 'Patek Philippe'], preferredModels: ['RM 011', 'RM 067', 'Grand Complications', 'Nautilus'], budgetMin: 1850000, budgetMax: 7400000, notes: 'Will move fast on the right piece.' },
    { clientKey: 'c36', preferredBrands: ['Patek Philippe', 'IWC'], preferredModels: ['Calatrava', 'Annual Calendar', 'Portugieser', 'Big Pilot'], budgetMin: 407000, budgetMax: 1850000, notes: 'Original condition paramount.' },
    { clientKey: 'c39', preferredBrands: ['Richard Mille', 'Audemars Piguet', 'Rolex'], preferredModels: ['RM 035', 'Royal Oak Perpetual', 'Daytona'], budgetMin: 1480000, budgetMax: 5550000, notes: 'Same-day payment capability confirmed.' },
    { clientKey: 'c40', preferredBrands: ['Cartier'], preferredModels: ['Santos', 'Pasha', 'Tank', 'Ballon Bleu', 'Panthère'], budgetMin: 111000, budgetMax: 407000, notes: 'Gift packaging always required.' },
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

  // --- Client interactions ---
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

  // --- Deals ---
  const dealSeeds: DealSeed[] = [
    { key: 'd1', clientKey: 'c3', watchKey: 'w1', stage: DealStage.LEAD, expectedCloseInDays: 19, agreedPrice: 251600, notes: 'Initial quote sent. Awaiting callback after weekend travel.', createdAtDaysAgo: 9, updatedAtDaysAgo: 9 },
    { key: 'd2', clientKey: 'c10', watchKey: 'w2', stage: DealStage.PENDING_PAYMENT, expectedCloseInDays: 4, agreedPrice: 412550, notes: 'Deposit received verbally approved; final transfer pending.', createdAtDaysAgo: 16, updatedAtDaysAgo: 2 },
    { key: 'd3', clientKey: 'c2', watchKey: 'w6', stage: DealStage.NEGOTIATING, expectedCloseInDays: 12, agreedPrice: 1840750, notes: 'Client requested margin reduction tied to same-day wire.', createdAtDaysAgo: 21, updatedAtDaysAgo: 11 },
    { key: 'd4', clientKey: 'c6', watchKey: 'w8', stage: DealStage.CLOSED_WON, expectedCloseInDays: null, agreedPrice: 125800, notes: 'Gift sale completed with express delivery.', createdAtDaysAgo: 27, updatedAtDaysAgo: 14 },
    { key: 'd5', clientKey: 'c5', watchKey: 'w10', stage: DealStage.CLOSED_WON, expectedCloseInDays: null, agreedPrice: 118400, notes: 'Closed after short negotiation. Client requested payment split.', createdAtDaysAgo: 24, updatedAtDaysAgo: 8 },
    { key: 'd6', clientKey: 'c12', watchKey: 'w17', stage: DealStage.INTERESTED, expectedCloseInDays: 16, agreedPrice: 233100, notes: 'Client asked for macro photos and bracelet measurement.', createdAtDaysAgo: 6, updatedAtDaysAgo: 4 },
    { key: 'd7', clientKey: 'c4', watchKey: 'w14', stage: DealStage.CLOSED_LOST, expectedCloseInDays: null, agreedPrice: 2793500, notes: 'Client deferred decision to next quarter capital cycle.', createdAtDaysAgo: 40, updatedAtDaysAgo: 28 },
    { key: 'd8', clientKey: 'c16', watchKey: 'w25', stage: DealStage.NEGOTIATING, expectedCloseInDays: 9, agreedPrice: 3209750, notes: 'Holding for private preview. Counteroffer under discussion.', createdAtDaysAgo: 18, updatedAtDaysAgo: 15 },
    { key: 'd9', clientKey: 'c18', watchKey: 'w23', stage: DealStage.INTERESTED, expectedCloseInDays: 7, agreedPrice: 281200, notes: 'Client requested bundle quote with Cartier dress option.', createdAtDaysAgo: 10, updatedAtDaysAgo: 3 },
    { key: 'd10', clientKey: 'c9', watchKey: 'w15', stage: DealStage.CLOSED_WON, expectedCloseInDays: null, agreedPrice: 3885000, notes: 'Private sale completed after authentication review.', createdAtDaysAgo: 45, updatedAtDaysAgo: 30 },
    { key: 'd11', clientKey: 'c11', watchKey: 'w20', stage: DealStage.PENDING_PAYMENT, expectedCloseInDays: 2, agreedPrice: 111930, notes: 'Wholesale invoice issued; awaiting balance payment.', createdAtDaysAgo: 12, updatedAtDaysAgo: 5 },
    { key: 'd12', clientKey: 'c13', watchKey: 'w24', stage: DealStage.LEAD, expectedCloseInDays: 25, agreedPrice: 521700, notes: 'Initial introduction from referral partner.', createdAtDaysAgo: 8, updatedAtDaysAgo: 1 },
    { key: 'd13', clientKey: 'c7', watchKey: 'w29', stage: DealStage.NEGOTIATING, expectedCloseInDays: 5, agreedPrice: 449550, notes: 'Trade-in allowance being evaluated.', createdAtDaysAgo: 14, updatedAtDaysAgo: 13 },
    { key: 'd14', clientKey: 'c14', watchKey: 'w12', stage: DealStage.CLOSED_LOST, expectedCloseInDays: null, agreedPrice: 65680, notes: 'Client paused purchase due to competing offer.', createdAtDaysAgo: 19, updatedAtDaysAgo: 16 },
    { key: 'd15', clientKey: 'c15', watchKey: 'w18', stage: DealStage.INTERESTED, expectedCloseInDays: 11, agreedPrice: 710400, notes: 'Client requested hold while reviewing annual budget allocation.', createdAtDaysAgo: 11, updatedAtDaysAgo: 10 },
    // additional deals using new clients/watches
    { key: 'd16', clientKey: 'c22', watchKey: 'w31', stage: DealStage.INTERESTED, expectedCloseInDays: 14, agreedPrice: 188700, notes: 'Fiona reviewing Portugieser against comparable IWC.', createdAtDaysAgo: 5, updatedAtDaysAgo: 3 },
    { key: 'd17', clientKey: 'c29', watchKey: 'w32', stage: DealStage.NEGOTIATING, expectedCloseInDays: 8, agreedPrice: 229400, notes: 'Kenji requested JLC service record confirmation.', createdAtDaysAgo: 13, updatedAtDaysAgo: 10 },
    { key: 'd18', clientKey: 'c24', watchKey: 'w42', stage: DealStage.PENDING_PAYMENT, expectedCloseInDays: 3, agreedPrice: 3182000, notes: 'Stella committed — awaiting family office wire.', createdAtDaysAgo: 20, updatedAtDaysAgo: 4 },
    { key: 'd19', clientKey: 'c39', watchKey: 'w41', stage: DealStage.CLOSED_WON, expectedCloseInDays: null, agreedPrice: 1868500, notes: 'Owen confirmed same-day payment. Clean close.', createdAtDaysAgo: 35, updatedAtDaysAgo: 22 },
    { key: 'd20', clientKey: 'c27', watchKey: 'w44', stage: DealStage.LEAD, expectedCloseInDays: 21, agreedPrice: 421800, notes: 'Blake inquiring about Batman — wants quick flip.', createdAtDaysAgo: 4, updatedAtDaysAgo: 2 },
    { key: 'd21', clientKey: 'c31', watchKey: 'w42', stage: DealStage.NEGOTIATING, expectedCloseInDays: 7, agreedPrice: 3256000, notes: 'Charles counter-offered; documentation review underway.', createdAtDaysAgo: 22, updatedAtDaysAgo: 18 },
    { key: 'd22', clientKey: 'c40', watchKey: 'w48', stage: DealStage.CLOSED_WON, expectedCloseInDays: null, agreedPrice: 159100, notes: 'Cecilia — gift purchase, express delivery requested.', createdAtDaysAgo: 30, updatedAtDaysAgo: 17 },
  ];

  const peakDayOffsets = [
    176, 169, 163, 158, 152, 148, 143, 138, 132, 126, 121, 116, 110, 105, 99, 94,
    88, 83, 78, 73, 68, 63, 58, 53, 48, 43, 39, 34, 29, 24, 20, 16, 12, 9, 6, 3,
  ];
  const stagePattern: DealStage[] = [
    DealStage.CLOSED_WON, DealStage.CLOSED_WON, DealStage.CLOSED_LOST, DealStage.INTERESTED,
    DealStage.NEGOTIATING, DealStage.LEAD, DealStage.PENDING_PAYMENT, DealStage.CLOSED_WON,
    DealStage.INTERESTED, DealStage.NEGOTIATING, DealStage.CLOSED_WON, DealStage.CLOSED_LOST,
    DealStage.LEAD, DealStage.PENDING_PAYMENT, DealStage.CLOSED_WON, DealStage.INTERESTED,
    DealStage.NEGOTIATING, DealStage.CLOSED_WON, DealStage.LEAD, DealStage.INTERESTED,
    DealStage.NEGOTIATING, DealStage.PENDING_PAYMENT, DealStage.CLOSED_WON, DealStage.CLOSED_LOST,
    DealStage.INTERESTED, DealStage.NEGOTIATING, DealStage.CLOSED_WON, DealStage.LEAD,
    DealStage.PENDING_PAYMENT, DealStage.CLOSED_WON, DealStage.INTERESTED, DealStage.CLOSED_LOST,
    DealStage.NEGOTIATING, DealStage.PENDING_PAYMENT, DealStage.CLOSED_WON, DealStage.LEAD,
  ];

  const generatedDeals: DealSeed[] = stagePattern.map((stage, index) => {
    const client = clientSeeds[index % clientSeeds.length];
    const watch = watchSeeds[(index * 3 + 5) % watchSeeds.length];
    const basePrice = watch.priceMax;
    const agreedPrice = Math.round((basePrice * (0.94 + (index % 7) * 0.012)) / 10) * 10;
    const createdAtDaysAgo = peakDayOffsets[index];
    const stageProgressDays =
      stage === DealStage.LEAD ? 1
      : stage === DealStage.INTERESTED ? 4
      : stage === DealStage.NEGOTIATING ? 8
      : stage === DealStage.PENDING_PAYMENT ? 12
      : stage === DealStage.CLOSED_WON ? 18
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
        expectedCloseAt: deal.expectedCloseInDays === null ? null : daysFromNow(deal.expectedCloseInDays),
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
  await prisma.watch.update({ where: { id: watchByKey.get('w35')!.id }, data: { status: WatchStatus.RESERVED } });
  await prisma.watch.update({ where: { id: watchByKey.get('w3')!.id }, data: { status: WatchStatus.SOLD } });
  await prisma.watch.update({ where: { id: watchByKey.get('w15')!.id }, data: { status: WatchStatus.SOLD } });
  await prisma.watch.update({ where: { id: watchByKey.get('w28')!.id }, data: { status: WatchStatus.SOLD } });
  await prisma.watch.update({ where: { id: watchByKey.get('w58')!.id }, data: { status: WatchStatus.SOLD } });

  // --- Payments ---
  const paymentSeeds: PaymentSeed[] = [
    { dealKey: 'd4', amount: 125800, method: PaymentMethod.CARD, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: 14, notes: 'Single card settlement.' },
    { dealKey: 'd5', amount: 55500, method: PaymentMethod.TRANSFER, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: 9, notes: 'Deposit transfer received.' },
    { dealKey: 'd5', amount: 62900, method: PaymentMethod.CARD, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: 8, notes: 'Final balance settled.' },
    { dealKey: 'd10', amount: 1942500, method: PaymentMethod.TRANSFER, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: 32, notes: 'Initial tranche from private client desk.' },
    { dealKey: 'd10', amount: 1942500, method: PaymentMethod.TRANSFER, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: 30, notes: 'Final tranche confirmed.' },
    { dealKey: 'd2', amount: 92500, method: PaymentMethod.TRANSFER, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: 3, notes: 'Reservation deposit received.' },
    { dealKey: 'd2', amount: 320050, method: PaymentMethod.TRANSFER, status: PaymentStatus.PENDING, dueDateDaysOffset: 4, paidAtDaysAgo: null, notes: 'Final transfer expected before release.' },
    { dealKey: 'd11', amount: 46250, method: PaymentMethod.CASH, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: 5, notes: 'Cash component collected at showroom.' },
    { dealKey: 'd11', amount: 65680, method: PaymentMethod.TRANSFER, status: PaymentStatus.OVERDUE, dueDateDaysOffset: -3, paidAtDaysAgo: null, notes: 'Invoice overdue; reminder sent.' },
    { dealKey: 'd3', amount: 277500, method: PaymentMethod.TRANSFER, status: PaymentStatus.PENDING, dueDateDaysOffset: 10, paidAtDaysAgo: null, notes: 'Soft hold deposit requested.' },
    { dealKey: 'd8', amount: 462500, method: PaymentMethod.TRANSFER, status: PaymentStatus.PENDING, dueDateDaysOffset: 7, paidAtDaysAgo: null, notes: 'Allocation hold pending escrow confirmation.' },
    { dealKey: 'd9', amount: 46250, method: PaymentMethod.CARD, status: PaymentStatus.PENDING, dueDateDaysOffset: 6, paidAtDaysAgo: null, notes: 'Token payment link sent.' },
    { dealKey: 'd13', amount: 74000, method: PaymentMethod.CARD, status: PaymentStatus.PENDING, dueDateDaysOffset: -2, paidAtDaysAgo: null, notes: 'Advance expected after appraisal; currently overdue.' },
    { dealKey: 'd15', amount: 92500, method: PaymentMethod.TRANSFER, status: PaymentStatus.PENDING, dueDateDaysOffset: 9, paidAtDaysAgo: null, notes: 'Interest deposit pending approval.' },
    { dealKey: 'd18', amount: 925000, method: PaymentMethod.TRANSFER, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: 4, notes: 'Family office first tranche.' },
    { dealKey: 'd18', amount: 2257000, method: PaymentMethod.TRANSFER, status: PaymentStatus.PENDING, dueDateDaysOffset: 3, paidAtDaysAgo: null, notes: 'Balance wire expected on close date.' },
    { dealKey: 'd19', amount: 1868500, method: PaymentMethod.TRANSFER, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: 22, notes: 'Owen — same-day full payment confirmed.' },
    { dealKey: 'd22', amount: 159100, method: PaymentMethod.CARD, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: 17, notes: 'Gift purchase — single card settlement.' },
  ];

  const generatedPayments: PaymentSeed[] = [];
  for (const deal of allDealSeeds) {
    if (deal.stage === DealStage.CLOSED_WON) {
      const splitFactor = (deal.createdAtDaysAgo + deal.updatedAtDaysAgo) % 3;
      if (splitFactor === 0) {
        generatedPayments.push({ dealKey: deal.key, amount: Math.round(deal.agreedPrice * 0.4), method: PaymentMethod.TRANSFER, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: clamp(deal.updatedAtDaysAgo - 2, 1, 179), notes: 'Historical tranche 1 settled.' });
        generatedPayments.push({ dealKey: deal.key, amount: deal.agreedPrice - Math.round(deal.agreedPrice * 0.4), method: PaymentMethod.TRANSFER, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: clamp(deal.updatedAtDaysAgo - 1, 0, 179), notes: 'Historical tranche 2 settled.' });
      } else {
        generatedPayments.push({ dealKey: deal.key, amount: deal.agreedPrice, method: splitFactor === 1 ? PaymentMethod.CARD : PaymentMethod.TRANSFER, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: clamp(deal.updatedAtDaysAgo, 0, 179), notes: 'Historical single-settlement deal.' });
      }
      continue;
    }
    if (deal.stage === DealStage.PENDING_PAYMENT) {
      const deposit = Math.round(deal.agreedPrice * 0.22);
      const dueOffset = ((deal.updatedAtDaysAgo + deal.createdAtDaysAgo) % 9) - 3;
      generatedPayments.push({ dealKey: deal.key, amount: deposit, method: PaymentMethod.TRANSFER, status: PaymentStatus.PAID, dueDateDaysOffset: null, paidAtDaysAgo: clamp(deal.updatedAtDaysAgo + 2, 1, 179), notes: 'Deposit confirmed on pending-payment opportunity.' });
      generatedPayments.push({ dealKey: deal.key, amount: deal.agreedPrice - deposit, method: PaymentMethod.TRANSFER, status: PaymentStatus.PENDING, dueDateDaysOffset: dueOffset, paidAtDaysAgo: null, notes: dueOffset < 0 ? 'Balance now overdue pending reconciliation.' : 'Balance invoice open with agreed payment window.' });
      continue;
    }
    if (deal.stage === DealStage.NEGOTIATING || deal.stage === DealStage.INTERESTED) {
      if ((deal.createdAtDaysAgo + deal.updatedAtDaysAgo) % 2 === 0) {
        generatedPayments.push({ dealKey: deal.key, amount: Math.round(deal.agreedPrice * 0.1), method: PaymentMethod.CARD, status: PaymentStatus.PENDING, dueDateDaysOffset: 7 + ((deal.createdAtDaysAgo + deal.updatedAtDaysAgo) % 5), paidAtDaysAgo: null, notes: 'Token reservation payment requested.' });
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
        dueDate: payment.dueDateDaysOffset === null ? null : daysFromNow(payment.dueDateDaysOffset),
        paidAt: payment.paidAtDaysAgo === null ? null : daysAgo(payment.paidAtDaysAgo),
        notes: payment.notes,
      },
    });
    if (payment.paidAtDaysAgo !== null) {
      timelineCoverageDates.push(daysAgo(payment.paidAtDaysAgo));
    }
    paymentCount += 1;
  }

  // --- Match suggestions ---
  const candidateWatches = watchSeeds
    .filter((watch) => watch.status !== WatchStatus.SOLD)
    .map((watch) => ({ ...watch, id: watchByKey.get(watch.key)?.id ?? '' }))
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
        if (pref.preferredModels.some((modelToken) =>
          `${watch.model} ${watch.reference}`.toLowerCase().includes(modelToken.toLowerCase()),
        )) {
          score += 30;
          reasons.push(`Model affinity: ${watch.model}`);
        }
        const inBudget =
          (pref.budgetMin === null || watch.priceMax >= pref.budgetMin) &&
          (pref.budgetMax === null || watch.priceMin <= pref.budgetMax);
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

  // --- Operating expenses ---
  let operatingExpenseCount = 0;
  for (const expense of operatingExpenseSeeds) {
    await prisma.operatingExpense.create({
      data: {
        tenantId: tenant.id,
        category: expense.category,
        amount: new Prisma.Decimal(expense.amount),
        notes: expense.notes,
        expenseDate: daysAgo(expense.daysAgoOffset),
      },
    });
    operatingExpenseCount += 1;
    timelineCoverageDates.push(daysAgo(expense.daysAgoOffset));
  }

  // --- Automation rules & runs ---
  const staleDealThreshold = 10;
  const staleDealCount = allDealSeeds.filter((deal) => {
    const open = ([DealStage.LEAD, DealStage.INTERESTED, DealStage.NEGOTIATING, DealStage.PENDING_PAYMENT] as DealStage[]).includes(deal.stage);
    return open && deal.updatedAtDaysAgo > staleDealThreshold;
  }).length;

  const overduePaymentCount = allPaymentSeeds.filter(
    (p) => p.status === PaymentStatus.PENDING && p.dueDateDaysOffset !== null && p.dueDateDaysOffset < 0,
  ).length;

  const agingInventoryThreshold = 60;
  const agingInventoryCount = watchSeeds.filter(
    (w) => w.status !== WatchStatus.SOLD && w.createdAtDaysAgo > agingInventoryThreshold,
  ).length;

  const staleRule = await prisma.automationRule.create({ data: { tenantId: tenant.id, type: AutomationRuleType.STALE_DEAL, isEnabled: true, thresholdDays: staleDealThreshold } });
  const overdueRule = await prisma.automationRule.create({ data: { tenantId: tenant.id, type: AutomationRuleType.OVERDUE_PAYMENT, isEnabled: true, thresholdDays: 1 } });
  const agingRule = await prisma.automationRule.create({ data: { tenantId: tenant.id, type: AutomationRuleType.AGING_INVENTORY, isEnabled: true, thresholdDays: agingInventoryThreshold } });

  await prisma.automationRun.createMany({
    data: [
      { tenantId: tenant.id, ruleId: staleRule.id, status: AutomationRunStatus.SUCCESS, resultCount: staleDealCount, createdAt: daysAgo(1) },
      { tenantId: tenant.id, ruleId: overdueRule.id, status: AutomationRunStatus.SUCCESS, resultCount: overduePaymentCount, createdAt: daysAgo(1) },
      { tenantId: tenant.id, ruleId: agingRule.id, status: AutomationRunStatus.SUCCESS, resultCount: agingInventoryCount, createdAt: daysAgo(1) },
    ],
  });

  for (const watch of watchSeeds) {
    timelineCoverageDates.push(daysAgo(watch.createdAtDaysAgo));
  }
  const earliestDate = new Date(Math.min(...timelineCoverageDates.map((d) => d.getTime())));
  const latestDate = new Date(Math.max(...timelineCoverageDates.map((d) => d.getTime())));

  const watchReferenceCount = await seedWatchReferences(prisma);

  console.log('Seed complete');
  console.log({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    userEmail,
    role: role.name,
    counts: {
      watches: watchSeeds.length,
      watchExpenses: watchExpenseCount,
      clients: clientSeeds.length,
      clientPreferences: preferenceSeeds.length,
      interactions: interactionCount,
      deals: allDealSeeds.length,
      payments: paymentCount,
      matchSuggestions: matchSuggestionCount,
      operatingExpenses: operatingExpenseCount,
      automationRules: 3,
      automationRuns: 3,
      watchReferences: watchReferenceCount,
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
