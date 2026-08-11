/**
 * Deterministic ClarificationPresenter — maps planner/policy missing-field state
 * into one natural Spanish question (+ optional closed choices) at a time.
 *
 * Does NOT invent business values. Does NOT weaken planner validation.
 * Presentation + ordering only.
 */

export type ClarificationChoice = {
  label: string;
  value: string;
};

export type PresentedClarification = {
  field: string;
  question: string;
  choices?: ClarificationChoice[];
  /** True when no field-specific copy existed and fallback was used. */
  usedFallback: boolean;
  /** Remaining missing fields after the one being asked (internal). */
  remainingFields: string[];
};

export type ClarificationMissing = {
  entity: string;
  question?: string;
};

type PartialEntities = Record<string, unknown>;

const TREASURY_CHOICES: ClarificationChoice[] = [
  { label: 'Efectivo', value: 'CASH' },
  { label: 'Bancos', value: 'BANK' },
  { label: 'Cuenta César', value: 'CESAR' },
];

const CURRENCY_CHOICES: ClarificationChoice[] = [
  { label: 'Pesos', value: 'MXN' },
  { label: 'Dólares', value: 'USD' },
];

const PAYMENT_MODE_CHOICES: ClarificationChoice[] = [
  { label: 'Pagada', value: 'PAID' },
  { label: 'A crédito', value: 'CREDIT' },
  { label: 'Parcial', value: 'PARTIAL' },
];

/** Deterministic per-capability ask order. Lower index = ask first. */
const PRIORITY: Record<string, string[]> = {
  REGISTER_EXPENSE: ['amount', 'currency', 'source', 'sourceAccount', 'category', 'concept', 'date'],
  REGISTER_SALE: [
    'watchId',
    'watch',
    'customerId',
    'customer',
    'price',
    'amount',
    'currency',
    'paymentMode',
    'destination',
    'exchangeRateUsed',
  ],
  REGISTER_PURCHASE: [
    'watch',
    'brand',
    'model',
    'serial',
    'cost',
    'currency',
    'paymentMode',
    'initialPaymentAmount',
    'sourceAccount',
    'source',
    'seller',
    'acquiredAt',
  ],
  REGISTER_RECEIVABLE_PAYMENT: [
    'customerId',
    'accountId',
    'amount',
    'currency',
    'destination',
    'payableAccountId',
    'exchangeRateUsed',
  ],
  REGISTER_PAYABLE_PAYMENT: [
    'accountId',
    'amount',
    'currency',
    'sourceAccount',
    'source',
    'exchangeRateUsed',
  ],
  REGISTER_TREASURY_TRANSFER: [
    'amount',
    'currency',
    'sourceAccount',
    'destinationAccount',
    'source',
    'destination',
  ],
  REGISTER_CAPITAL_CONTRIBUTION: ['investorId', 'investor', 'amount', 'currency', 'account', 'contributedAt'],
  REGISTER_CAPITAL_DISTRIBUTION: ['investorId', 'investor', 'amount', 'currency', 'account'],
  CREATE_CLIENT: ['name', 'email', 'phone', 'allowProbableDuplicate'],
  UPDATE_CLIENT: ['clientId', 'client', 'operations', 'expectedUpdatedAt', 'name', 'email', 'phone'],
  CREATE_RECEIVABLE: ['counterpartyName', 'counterparty', 'clientQuery', 'amount', 'currency', 'dueDate', 'concept'],
  CREATE_PAYABLE: ['counterpartyName', 'counterparty', 'clientQuery', 'amount', 'currency', 'dueDate', 'concept'],
};

function asAmountLabel(entities: PartialEntities): string | null {
  const raw = entities.amount ?? entities.price ?? entities.cost ?? entities.purchaseAmount;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.round(raw));
  }
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.replace(/,/g, ''));
    if (Number.isFinite(n)) return String(Math.round(n));
    return raw.trim();
  }
  return null;
}

function looksTechnical(text: string): boolean {
  return (
    /has no currency|no treasury account|MISSING_|cashAccount|paymentMode|exchangeRateUsed|Provide\s+\w|field not specified|required field|Amount\s*'|Could be USD|MXN,\s*CAD|\([A-Z_]{3,}\)/i.test(
      text,
    ) || /^(Which |What |Who |Where |Provide )/i.test(text)
  );
}

function isSafeDomainQuestion(text: string | undefined): text is string {
  if (!text || !text.trim()) return false;
  if (looksTechnical(text)) return false;
  // Prefer Spanish conversational questions; allow Spanish hard-domain messages.
  return /[¿?]/.test(text) || /^(No |El |La |Solo |Ya |V1 )/i.test(text) || text.length <= 160;
}

function currencyQuestion(entities: PartialEntities, capability: string): PresentedClarification['question'] {
  const amount = asAmountLabel(entities);
  if (capability === 'REGISTER_EXPENSE' && amount) {
    return `¿Los ${amount} fueron en pesos o en dólares?`;
  }
  if (amount) {
    return `¿Los ${amount} fueron en pesos o en dólares?`;
  }
  if (capability === 'CREATE_RECEIVABLE' || capability === 'CREATE_PAYABLE') {
    return '¿Es en pesos o en dólares?';
  }
  return '¿Fue en pesos o en dólares?';
}

function partyLabel(entities: PartialEntities): string | null {
  for (const key of [
    'customerName',
    'clientLabel',
    'sellerLabel',
    'seller',
    'supplierName',
    'counterpartyName',
    'customerQuery',
    'clientQuery',
  ]) {
    const value = entities[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function amountQuestion(capability: string, entities: PartialEntities): string {
  if (capability === 'REGISTER_EXPENSE') return '¿De cuánto fue el gasto?';
  if (capability === 'REGISTER_SALE') {
    const who = partyLabel(entities);
    if (who) return `¿En cuánto se la vendiste a ${who}?`;
    const watch = typeof entities.watchLabel === 'string' ? entities.watchLabel : null;
    return watch ? `¿Por cuánto vendiste el ${watch}?` : '¿Por cuánto lo vendiste?';
  }
  if (capability === 'REGISTER_RECEIVABLE_PAYMENT') {
    const who = typeof entities.customerName === 'string' ? entities.customerName : null;
    return who ? `¿Cuánto te pagó ${who}?` : '¿De cuánto fue el pago?';
  }
  if (capability === 'REGISTER_PAYABLE_PAYMENT') return '¿De cuánto fue el pago?';
  if (capability === 'REGISTER_PURCHASE') return '¿De cuánto fue la compra?';
  if (capability === 'CREATE_RECEIVABLE' || capability === 'CREATE_PAYABLE') {
    return '¿De cuánto es la cuenta?';
  }
  if (capability === 'REGISTER_TREASURY_TRANSFER') return '¿De cuánto es la transferencia?';
  if (capability === 'REGISTER_CAPITAL_CONTRIBUTION') return '¿De cuánto es la aportación?';
  if (capability === 'REGISTER_CAPITAL_DISTRIBUTION') return '¿De cuánto es la distribución?';
  return '¿De cuánto fue?';
}

function treasuryQuestion(capability: string, field: string): string {
  if (field === 'destination' || field === 'destinationAccount') {
    if (capability === 'REGISTER_RECEIVABLE_PAYMENT') {
      return '¿En qué cuenta recibiste el dinero?';
    }
    if (capability === 'REGISTER_TREASURY_TRANSFER') {
      return '¿A qué cuenta va?';
    }
    return '¿A qué cuenta va?';
  }
  if (capability === 'REGISTER_EXPENSE') {
    return '¿Lo pagaste en Efectivo, Bancos o Cuenta César?';
  }
  if (capability === 'REGISTER_TREASURY_TRANSFER') {
    return '¿De qué cuenta sale?';
  }
  if (capability === 'REGISTER_RECEIVABLE_PAYMENT') {
    return '¿En qué cuenta recibiste el dinero?';
  }
  return '¿De dónde salió el dinero?';
}

function watchQuestion(capability: string, entities: PartialEntities): string {
  const who = partyLabel(entities);
  if (capability === 'REGISTER_SALE' && who) {
    return `¿Qué reloj le vendiste a ${who}?`;
  }
  if (capability === 'REGISTER_PURCHASE' && who) {
    return `¿Qué reloj le compraste a ${who}?`;
  }
  return '¿Qué reloj fue?';
}

function fieldPresentation(
  capability: string,
  field: string,
  entities: PartialEntities,
  domainQuestion?: string,
): Omit<PresentedClarification, 'remainingFields'> {
  const normalized = field.trim();

  if (normalized === 'currency') {
    return {
      field: 'currency',
      question: currencyQuestion(entities, capability),
      choices: CURRENCY_CHOICES,
      usedFallback: false,
    };
  }

  if (
    normalized === 'source' ||
    normalized === 'sourceAccount' ||
    normalized === 'destination' ||
    normalized === 'destinationAccount' ||
    normalized === 'account' ||
    normalized === 'cashAccount'
  ) {
    const mappedField =
      normalized === 'cashAccount'
        ? capability === 'REGISTER_RECEIVABLE_PAYMENT'
          ? 'destination'
          : 'source'
        : normalized;
    return {
      field: mappedField,
      question: treasuryQuestion(capability, mappedField),
      choices: TREASURY_CHOICES,
      usedFallback: false,
    };
  }

  if (normalized === 'paymentMode') {
    return {
      field: 'paymentMode',
      question: '¿La compra fue pagada, a crédito o parcialmente?',
      choices: PAYMENT_MODE_CHOICES,
      usedFallback: false,
    };
  }

  if (normalized === 'amount' || normalized === 'price' || normalized === 'cost') {
    return {
      field: normalized === 'price' ? 'price' : normalized === 'cost' ? 'cost' : 'amount',
      question: amountQuestion(capability, entities),
      usedFallback: false,
    };
  }

  if (normalized === 'initialPaymentAmount') {
    return {
      field: 'initialPaymentAmount',
      question: '¿Cuánto pagaste al momento?',
      usedFallback: false,
    };
  }

  if (normalized === 'customerId' || normalized === 'customer' || normalized === 'clientId' || normalized === 'client') {
    const sale = capability === 'REGISTER_SALE';
    const purchase = capability === 'REGISTER_PURCHASE';
    const update = capability === 'UPDATE_CLIENT';
    const watch = typeof entities.watchLabel === 'string' ? entities.watchLabel : null;
    return {
      field: normalized === 'clientId' || normalized === 'client' ? 'clientId' : 'customerId',
      question: sale
        ? watch
          ? `¿A quién le vendiste el ${watch}?`
          : '¿A quién se lo vendiste?'
        : purchase
          ? '¿A quién se lo compraste?'
          : update
            ? '¿Qué cliente quieres actualizar?'
            : '¿De qué cliente hablamos?',
      usedFallback: false,
    };
  }

  if (normalized === 'seller') {
    return { field: 'seller', question: '¿A quién se lo compraste?', usedFallback: false };
  }

  if (
    normalized === 'counterpartyName' ||
    normalized === 'counterparty' ||
    normalized === 'clientQuery'
  ) {
    return {
      field: normalized === 'clientQuery' ? 'clientQuery' : 'counterpartyName',
      question:
        capability === 'CREATE_PAYABLE' ? '¿A quién le debemos?' : '¿Quién nos debe?',
      usedFallback: false,
    };
  }

  if (normalized === 'watchId' || normalized === 'watch' || normalized === 'brand' || normalized === 'model') {
    return {
      field: normalized === 'watchId' ? 'watchId' : 'watch',
      question: watchQuestion(capability, entities),
      usedFallback: false,
    };
  }

  if (normalized === 'serial') {
    return { field: 'serial', question: '¿Cuál es el número de serie?', usedFallback: false };
  }

  if (normalized === 'reference') {
    return { field: 'reference', question: '¿Tienes la referencia del reloj?', usedFallback: false };
  }

  if (normalized === 'dueDate') {
    return { field: 'dueDate', question: '¿Cuándo vence?', usedFallback: false };
  }

  if (normalized === 'exchangeRateUsed' || normalized === 'fxRate' || normalized === 'exchangeRate') {
    return {
      field: normalized === 'exchangeRateUsed' ? 'exchangeRateUsed' : normalized,
      question: '¿Qué tipo de cambio usaste?',
      usedFallback: false,
    };
  }

  if (normalized === 'investorId' || normalized === 'investor') {
    return {
      field: 'investorId',
      question: '¿Para qué socio?',
      usedFallback: false,
    };
  }

  if (normalized === 'category') {
    if (isSafeDomainQuestion(domainQuestion)) {
      return { field: 'category', question: domainQuestion, usedFallback: false };
    }
    return { field: 'category', question: '¿Qué tipo de gasto fue?', usedFallback: false };
  }

  if (normalized === 'concept') {
    return { field: 'concept', question: '¿En qué fue el gasto?', usedFallback: false };
  }

  if (normalized === 'name') {
    return { field: 'name', question: '¿Cómo se llama el cliente?', usedFallback: false };
  }

  if (normalized === 'email') {
    return { field: 'email', question: '¿Cuál es el correo?', usedFallback: false };
  }

  if (normalized === 'phone') {
    return { field: 'phone', question: '¿Cuál es el teléfono?', usedFallback: false };
  }

  if (normalized === 'date' || normalized === 'acquiredAt' || normalized === 'contributedAt' || normalized === 'expenseDate') {
    return { field: normalized, question: '¿Qué fecha aplica?', usedFallback: false };
  }

  if (isSafeDomainQuestion(domainQuestion)) {
    return { field: normalized, question: domainQuestion, usedFallback: false };
  }

  return {
    field: normalized,
    question: 'Necesito un dato más para continuar.',
    usedFallback: true,
  };
}

function sortMissing(capability: string, missing: ClarificationMissing[]): ClarificationMissing[] {
  const order = PRIORITY[capability] ?? [];
  const rank = (entity: string) => {
    const idx = order.indexOf(entity);
    if (idx >= 0) return idx;
    // Treat cashAccount like source/destination for ordering.
    if (entity === 'cashAccount') {
      const alt = order.indexOf('source');
      if (alt >= 0) return alt;
    }
    return 1000 + entity.charCodeAt(0);
  };
  return [...missing].sort((a, b) => rank(a.entity) - rank(b.entity) || a.entity.localeCompare(b.entity));
}

/**
 * Pick exactly one clarification to show the user.
 */
export function presentClarification(args: {
  capability: string;
  missing: ClarificationMissing[];
  entities?: PartialEntities;
}): PresentedClarification | null {
  if (!args.missing.length) return null;
  const sorted = sortMissing(args.capability, args.missing);
  const first = sorted[0]!;
  const presented = fieldPresentation(
    args.capability,
    first.entity,
    args.entities ?? {},
    first.question,
  );
  return {
    ...presented,
    remainingFields: sorted.slice(1).map((m) => m.entity),
  };
}

/**
 * Present policy ambiguities (LLM reasons) without leaking technical copy.
 */
export function presentPolicyAmbiguities(args: {
  capability?: string;
  ambiguities: Array<{ field: string; reason?: string; candidates?: string[] }>;
  entities?: PartialEntities;
}): PresentedClarification | null {
  const missing = args.ambiguities.map((a) => ({
    entity: a.field,
    question: a.reason,
  }));
  return presentClarification({
    capability: args.capability ?? 'UNKNOWN',
    missing,
    entities: args.entities,
  });
}

/** Map a free-text / choice label answer into a canonical entity value when closed. */
export function mapClarificationAnswer(
  field: string,
  answer: string,
): { field: string; value: string } | null {
  const text = answer.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  if (field === 'currency') {
    if (/^(pesos?|mxn|mexicanos?)$/i.test(lower) || /peso/.test(lower)) {
      return { field: 'currency', value: 'MXN' };
    }
    if (/^(d[oó]lares?|usd|usdt?)$/i.test(lower) || /d[oó]lar/.test(lower)) {
      return { field: 'currency', value: 'USD' };
    }
  }

  if (
    field === 'source' ||
    field === 'sourceAccount' ||
    field === 'destination' ||
    field === 'destinationAccount' ||
    field === 'account' ||
    field === 'cashAccount'
  ) {
    if (/efectivo|cash/.test(lower)) return { field, value: 'CASH' };
    if (/bancos?|bank/.test(lower)) return { field, value: 'BANK' };
    if (/c[eé]sar/.test(lower)) return { field, value: 'CESAR' };
  }

  if (field === 'paymentMode') {
    if (/^pagad[ao]$|completo|paid/.test(lower)) return { field: 'paymentMode', value: 'PAID' };
    if (/cr[eé]dito|credit/.test(lower)) return { field: 'paymentMode', value: 'CREDIT' };
    if (/parcial|partial/.test(lower)) return { field: 'paymentMode', value: 'PARTIAL' };
  }

  return null;
}

export function buildConversationalMissingFieldsPayload(args: {
  capability: string;
  missing: ClarificationMissing[];
  entities?: PartialEntities;
  preface?: string;
}): {
  title: string;
  message: string;
  groups: Array<{
    id: string;
    label: string;
    fields: Array<{
      key: string;
      question: string;
      choices?: ClarificationChoice[];
    }>;
  }>;
  clarificationField: string;
  usedFallback: boolean;
  remainingFields: string[];
  unchanged: string;
  nextAction: string;
} {
  const presented = presentClarification(args);
  if (!presented) {
    return {
      title: 'Necesito un dato más',
      message: '¿Me puedes dar un poco más de información?',
      groups: [],
      clarificationField: '',
      usedFallback: true,
      remainingFields: [],
      unchanged: 'No se ejecutó ninguna acción.',
      nextAction: 'Responde con el dato solicitado.',
    };
  }

  const message = args.preface
    ? `${args.preface} ${presented.question}`.replace(/\s+/g, ' ').trim()
    : presented.question;

  return {
    title: 'Necesito un dato más',
    message,
    groups: [
      {
        id: 'required',
        label: 'Aclaración',
        fields: [
          {
            key: presented.field,
            question: presented.question,
            ...(presented.choices ? { choices: presented.choices } : {}),
          },
        ],
      },
    ],
    clarificationField: presented.field,
    usedFallback: presented.usedFallback,
    remainingFields: presented.remainingFields,
    unchanged: 'No se ejecutó ninguna acción.',
    nextAction: 'Responde en el chat o elige una opción.',
  };
}
