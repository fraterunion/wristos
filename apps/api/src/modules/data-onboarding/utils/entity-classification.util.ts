import { DataImportEntityType } from '@prisma/client';

import { normalizeHeaderKey } from './header-normalization.util';

type EntityRule = {
  entity: DataImportEntityType;
  weight: number;
  patterns: string[];
};

const RULES: EntityRule[] = [
  {
    entity: DataImportEntityType.INVENTORY,
    weight: 2,
    patterns: ['marca', 'brand', 'modelo', 'model', 'referencia', 'reference', 'serie', 'serial', 'costo', 'cost', 'precio', 'price'],
  },
  {
    entity: DataImportEntityType.CLIENTS,
    weight: 2,
    patterns: ['cliente', 'client', 'nombre', 'name', 'telefono', 'phone', 'correo', 'email', 'whatsapp'],
  },
  {
    entity: DataImportEntityType.DEALS,
    weight: 2,
    patterns: ['venta', 'sale', 'comprador', 'buyer', 'precio_venta', 'sale_price', 'fecha_venta', 'sale_date', 'deal'],
  },
  {
    entity: DataImportEntityType.PAYMENTS,
    weight: 2,
    patterns: ['pago', 'payment', 'metodo', 'method', 'monto', 'amount', 'fecha_pago', 'paid_at'],
  },
  {
    entity: DataImportEntityType.EXPENSES,
    weight: 2,
    patterns: ['gasto', 'expense', 'categoria', 'category', 'proveedor', 'vendor', 'importe'],
  },
  {
    entity: DataImportEntityType.ACCOUNTS,
    weight: 1,
    patterns: ['cuenta', 'account', 'cxc', 'cxp', 'receivable', 'payable', 'saldo', 'balance'],
  },
  {
    entity: DataImportEntityType.TREASURY,
    weight: 1,
    patterns: ['tesoreria', 'treasury', 'efectivo', 'cash', 'banco', 'bank', 'cesar'],
  },
  {
    entity: DataImportEntityType.INVESTORS,
    weight: 2,
    patterns: ['inversor', 'investor', 'socio', 'partner', 'aportacion', 'contribution', 'distribucion', 'distribution'],
  },
  {
    entity: DataImportEntityType.RADAR,
    weight: 1,
    patterns: ['radar', 'listing', 'canal', 'channel', 'telegram', 'whatsapp_export'],
  },
];

const MIN_SCORE = 4;

export type ClassificationResult = {
  entityType: DataImportEntityType;
  score: number;
  evidence: Record<string, number>;
};

export function classifyEntityFromHeaders(headers: string[]): ClassificationResult {
  const normalized = headers.map((h) => normalizeHeaderKey(h)).filter(Boolean);
  const evidence: Record<string, number> = {};

  for (const rule of RULES) {
    let ruleScore = 0;
    for (const pattern of rule.patterns) {
      if (normalized.some((header) => header === pattern || header.includes(pattern))) {
        ruleScore += rule.weight;
      }
    }
    if (ruleScore > 0) {
      evidence[rule.entity] = ruleScore;
    }
  }

  const ranked = Object.entries(evidence).sort((a, b) => b[1] - a[1]);
  const [topEntity, topScore] = ranked[0] ?? [DataImportEntityType.UNKNOWN, 0];
  const secondScore = ranked[1]?.[1] ?? 0;

  if (topScore < MIN_SCORE || topScore === secondScore) {
    return {
      entityType: DataImportEntityType.UNKNOWN,
      score: topScore,
      evidence,
    };
  }

  return {
    entityType: topEntity as DataImportEntityType,
    score: topScore,
    evidence,
  };
}
