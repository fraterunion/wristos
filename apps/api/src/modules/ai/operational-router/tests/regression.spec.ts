import { OperationalIntentRouterService, toRawCandidateOutput } from '../operational-intent-router.service';
import { buildIntentCandidate } from '../../intent-adapter/intent-candidate';

/**
 * Regression corpus mirroring the task's own numbered examples (Bruce Wayne
 * regression, AP Elephant regression, full/partial sale, purchase, expense,
 * receivable/payable payment, transfer, negative, future, question,
 * ambiguous, messy/shorthand). Every HIGH_CONFIDENCE_OPERATION verdict is
 * also fed through the REAL buildIntentCandidate() — the same validation
 * gate a successful Claude call goes through — so this doubles as proof the
 * router's output is never trusted implicitly.
 */
describe('OperationalIntentRouterService — regression corpus', () => {
  const router = new OperationalIntentRouterService();
  const today = new Date().toISOString().slice(0, 10);

  function route(text: string) {
    return router.route(text);
  }

  function routeAndValidate(text: string) {
    const verdict = router.route(text);
    if (verdict.kind !== 'HIGH_CONFIDENCE_OPERATION') return { verdict, candidate: null };
    const rawOutput = toRawCandidateOutput(verdict);
    const result = buildIntentCandidate(rawOutput, today);
    return { verdict, candidate: result.kind === 'VALID' ? result.candidate : null, buildResult: result };
  }

  // --- §41/§42 — the exact regressions named in the bug report ---

  it('Bruce Wayne regression: "vendi bruce wayne en 500k" routes to REGISTER_SALE, never a rejection', () => {
    const { verdict, candidate } = routeAndValidate('vendi bruce wayne en 500k');
    expect(verdict.kind).toBe('HIGH_CONFIDENCE_OPERATION');
    expect(candidate?.intent).toBe('REGISTER_SALE');
    expect(candidate?.entities.watchQuery).toBe('bruce wayne');
    expect(candidate?.entities.price).toBe('500000.00');
    expect(candidate?.confidence).toBe('HIGH');
  });

  it('AP Elephant regression: "vendí ap elephant en 415k mxn" routes to REGISTER_SALE', () => {
    const { verdict, candidate } = routeAndValidate('vendí ap elephant en 415k mxn');
    expect(verdict.kind).toBe('HIGH_CONFIDENCE_OPERATION');
    expect(candidate?.intent).toBe('REGISTER_SALE');
    expect(candidate?.entities.watchQuery).toBe('ap elephant');
    expect(candidate?.entities.price).toBe('415000.00');
    expect(candidate?.entities.currency).toBe('MXN');
  });

  // --- §43/§44 — full and partial sale ---

  it('full rich sale: watch, price, currency, customer, and payment mode all resolve in one turn', () => {
    const { candidate } = routeAndValidate(
      'Vendí un Bruce Wayne en 500k MXN a Abraham Díaz y me pagó por Bancos.',
    );
    expect(candidate?.intent).toBe('REGISTER_SALE');
    expect(candidate?.entities.watchQuery).toBe('Bruce Wayne');
    expect(candidate?.entities.customerQuery).toBe('Abraham Díaz');
    expect(candidate?.entities.price).toBe('500000.00');
    expect(candidate?.entities.currency).toBe('MXN');
    expect(candidate?.entities.paymentMode).toBe('PAID');
    // entitySchemas.REGISTER_SALE now accepts `destination` (the planner
    // layer, business-actions.ts, already treated it as a known optional
    // field — reachable before this fix only via the closed-choice
    // clarification follow-up). A stated "...por Bancos." must survive
    // through buildIntentCandidate() in the same turn instead of forcing an
    // always-avoidable "¿Dónde se recibió el pago?" question.
    expect(candidate?.entities.destination).toBe('BANCOS');
    // Never a trusted watchId/customerId from the router itself.
    expect(candidate?.entities.watchId).toBeUndefined();
    expect(candidate?.entities.customerId).toBeUndefined();
  });

  it('partial sale: "Vendí un Bruce Wayne en 500k." resolves watch+amount, leaves currency and paymentMode for the planner', () => {
    const { candidate } = routeAndValidate('Vendí un Bruce Wayne en 500k.');
    expect(candidate?.intent).toBe('REGISTER_SALE');
    expect(candidate?.entities.watchQuery).toBe('Bruce Wayne');
    expect(candidate?.entities.price).toBe('500000.00');
    // No explicit currency word in the text -> must NOT be defaulted to MXN;
    // left absent so the planner asks ("¿Los 500 fueron en pesos o en
    // dólares?"), exactly as it already does for LLM-sourced candidates.
    expect(candidate?.entities.currency).toBeUndefined();
    expect(candidate?.entities.paymentMode).toBeUndefined();
    expect(candidate?.entities.customerQuery).toBeUndefined();
  });

  it('rich-sale-minus-currency: "Vendí un Bruce Wayne en 500k a Abraham Díaz y me pagó por Bancos." resolves every slot except currency, so the planner asks only pesos-or-dólares and nothing else', () => {
    const { candidate } = routeAndValidate(
      'Vendí un Bruce Wayne en 500k a Abraham Díaz y me pagó por Bancos.',
    );
    expect(candidate?.intent).toBe('REGISTER_SALE');
    expect(candidate?.entities.watchQuery).toBe('Bruce Wayne');
    expect(candidate?.entities.customerQuery).toBe('Abraham Díaz');
    expect(candidate?.entities.price).toBe('500000.00');
    expect(candidate?.entities.paymentMode).toBe('PAID');
    // The only genuinely missing planner-required field is currency — never
    // invented, never defaulted — everything else the message stated is
    // already retained above, so the planner's downstream clarification
    // (pre-existing ClarificationFieldLockService/planner logic, unchanged
    // by this router) asks exactly one targeted question and nothing else.
    expect(candidate?.entities.currency).toBeUndefined();
  });

  it('"Vendí el Elephant en 415 mil MXN." resolves', () => {
    const { candidate } = routeAndValidate('Vendí el Elephant en 415 mil MXN.');
    expect(candidate?.intent).toBe('REGISTER_SALE');
    expect(candidate?.entities.watchQuery).toBe('Elephant');
    expect(candidate?.entities.price).toBe('415000.00');
  });

  it('"Le vendí un Panda a Abraham por 300." resolves watch, customer, and amount', () => {
    const { candidate } = routeAndValidate('Le vendí un Panda a Abraham por 300.');
    expect(candidate?.intent).toBe('REGISTER_SALE');
    expect(candidate?.entities.watchQuery).toBe('Panda');
    expect(candidate?.entities.customerQuery).toBe('Abraham');
    expect(candidate?.entities.price).toBe('300.00');
  });

  it('"Se fue el Batman en 280k." resolves via the colloquial "se fue" verb', () => {
    const { candidate } = routeAndValidate('Se fue el Batman en 280k.');
    expect(candidate?.intent).toBe('REGISTER_SALE');
    expect(candidate?.entities.watchQuery).toBe('Batman');
    expect(candidate?.entities.price).toBe('280000.00');
  });

  // --- §45 — purchase ---

  it('rich purchase regression: watch, seller, cost, currency, payment mode, account all resolve', () => {
    const { candidate } = routeAndValidate('Compré un Pepsi en 280 mil pesos a José y pagué por Bancos.');
    expect(candidate?.intent).toBe('REGISTER_PURCHASE');
    expect(candidate?.entities.watchQuery).toBe('Pepsi');
    expect(candidate?.entities.sellerQuery).toBe('José');
    expect(candidate?.entities.cost).toBe('280000.00');
    expect(candidate?.entities.currency).toBe('MXN');
    expect(candidate?.entities.paymentMode).toBe('PAID');
    expect(candidate?.entities.sourceAccount).toBe('BANK');
    expect(candidate?.entities.acquiredAt).toBe(today);
  });

  it('purchase with partial/credit split: "pagué X ... y el resto quedó a crédito" -> PARTIAL', () => {
    const { candidate } = routeAndValidate(
      'Compré un AP Elephant a José en 350 mil pesos, pagué 100 de Bancos y el resto quedó a crédito.',
    );
    expect(candidate?.intent).toBe('REGISTER_PURCHASE');
    expect(candidate?.entities.cost).toBe('350000.00');
    expect(candidate?.entities.paymentMode).toBe('PARTIAL');
  });

  // --- §46 — expense ---

  it('expense regression: "Gasté 500 pesos en gasolina de Bancos." resolves all four required fields', () => {
    const { candidate } = routeAndValidate('Gasté 500 pesos en gasolina de Bancos.');
    expect(candidate?.intent).toBe('REGISTER_EXPENSE');
    expect(candidate?.entities.amount).toBe('500.00');
    expect(candidate?.entities.currency).toBe('MXN');
    expect(candidate?.entities.category).toBe('GASOLINE');
    expect(candidate?.entities.source).toBe('BANK');
  });

  it('"Gasté 1,500 pesos de gasolina y lo pagué en efectivo." resolves', () => {
    const { candidate } = routeAndValidate('Gasté 1,500 pesos de gasolina y lo pagué en efectivo.');
    expect(candidate?.intent).toBe('REGISTER_EXPENSE');
    expect(candidate?.entities.amount).toBe('1500.00');
    expect(candidate?.entities.category).toBe('GASOLINE');
    expect(candidate?.entities.source).toBe('CASH');
  });

  it('"Pagué gasolina" (no amount) is still strong expense evidence — capability confidence != field completeness', () => {
    const verdict = route('Pagué gasolina.');
    expect(verdict.kind).toBe('HIGH_CONFIDENCE_OPERATION');
    if (verdict.kind === 'HIGH_CONFIDENCE_OPERATION') {
      expect(verdict.capability).toBe('REGISTER_EXPENSE');
      expect(verdict.entities.amount).toBeUndefined();
    }
  });

  // --- §47/§26 — receivable payment ---

  it('receivable payment regression: "José me pagó 50 mil pesos por Bancos." is REGISTER_RECEIVABLE_PAYMENT, not UNKNOWN', () => {
    const { candidate } = routeAndValidate('José me pagó 50 mil pesos por Bancos.');
    expect(candidate?.intent).toBe('REGISTER_RECEIVABLE_PAYMENT');
    expect(candidate?.entities.customerQuery).toBe('José');
    expect(candidate?.entities.amount).toBe('50000.00');
    expect(candidate?.entities.destination).toBe('BANK');
  });

  it('"Abraham me depositó 50k." resolves', () => {
    const { candidate } = routeAndValidate('Abraham me depositó 50k.');
    expect(candidate?.intent).toBe('REGISTER_RECEIVABLE_PAYMENT');
    expect(candidate?.entities.customerQuery).toBe('Abraham');
    expect(candidate?.entities.amount).toBe('50000.00');
  });

  it('"Cobré la cuenta de Carlos en efectivo." (no amount stated) stays ambiguous, same as any genuinely missing amount', () => {
    const verdict = route('Cobré la cuenta de Carlos en efectivo.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"Cobré la cuenta de Carlos en efectivo, 90 mil." resolves once an amount is present (verb-first shape)', () => {
    const verdict = route('Cobré la cuenta de Carlos en efectivo, 90 mil.');
    expect(verdict.kind).toBe('HIGH_CONFIDENCE_OPERATION');
    if (verdict.kind === 'HIGH_CONFIDENCE_OPERATION') {
      expect(verdict.capability).toBe('REGISTER_RECEIVABLE_PAYMENT');
      expect(verdict.entities.destination).toBe('CASH');
    }
  });

  // --- §48/§27 — payable payment ---

  it('payable payment regression: "Le pagué a José 80 mil pesos desde Bancos." resolves', () => {
    const { candidate } = routeAndValidate('Le pagué a José 80 mil pesos desde Bancos.');
    expect(candidate?.intent).toBe('REGISTER_PAYABLE_PAYMENT');
    expect(candidate?.entities.counterpartyQuery).toBe('José');
    expect(candidate?.entities.amount).toBe('80000.00');
    expect(candidate?.entities.sourceAccount).toBe('BANK');
  });

  it('"Liquidé la cuenta del proveedor en efectivo." resolves without a stated amount', () => {
    const verdict = route('Liquidé la cuenta del proveedor en efectivo.');
    // No amount stated -> insufficient evidence by design (amount is required
    // for sufficientEvidence on this capability) -> falls to provider.
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  // --- §49/§28 — treasury transfer ---

  it('transfer regression: "Pasa 100 mil de Bancos a Efectivo." resolves, not REJECT_LOW_CONFIDENCE', () => {
    const { candidate } = routeAndValidate('Pasa 100 mil de Bancos a Efectivo.');
    expect(candidate?.intent).toBe('REGISTER_TREASURY_TRANSFER');
    expect(candidate?.entities.amount).toBe('100000.00');
    expect(candidate?.entities.sourceAccount).toBe('BANK');
    expect(candidate?.entities.destinationAccount).toBe('CASH');
    expect(candidate?.entities.currency).toBe('MXN');
  });

  it('reversed-order transfer: "Mueve 200k a Cuenta César desde Bancos." resolves regardless of clause order', () => {
    const { candidate } = routeAndValidate('Mueve 200k a Cuenta César desde Bancos.');
    expect(candidate?.intent).toBe('REGISTER_TREASURY_TRANSFER');
    expect(candidate?.entities.amount).toBe('200000.00');
    expect(candidate?.entities.destinationAccount).toBe('CESAR');
    expect(candidate?.entities.sourceAccount).toBe('BANK');
  });

  // --- §10/§11 — capital ---

  it('"César aportó 300 mil." resolves REGISTER_CAPITAL_CONTRIBUTION, account left for the planner to ask', () => {
    const { candidate } = routeAndValidate('César aportó 300 mil.');
    expect(candidate?.intent).toBe('REGISTER_CAPITAL_CONTRIBUTION');
    expect(candidate?.entities.investorQuery).toBe('César');
    expect(candidate?.entities.amount).toBe('300000.00');
    expect(candidate?.entities.contributedAt).toBe(today);
    expect(candidate?.entities.account).toBeUndefined();
  });

  it('"Diego Navarro retiró utilidad de 150k." resolves REGISTER_CAPITAL_DISTRIBUTION', () => {
    const { candidate } = routeAndValidate('Diego Navarro retiró utilidad de 150k.');
    expect(candidate?.intent).toBe('REGISTER_CAPITAL_DISTRIBUTION');
    expect(candidate?.entities.investorQuery).toBe('Diego Navarro');
    expect(candidate?.entities.amount).toBe('150000.00');
    expect(candidate?.entities.paidAt).toBe(today);
  });

  // --- §12/§13 — CxC / CxP creation ---

  it('"Abraham nos debe 100 mil." resolves CREATE_RECEIVABLE, currency left absent (no explicit currency word)', () => {
    const { candidate } = routeAndValidate('Abraham nos debe 100 mil.');
    expect(candidate?.intent).toBe('CREATE_RECEIVABLE');
    expect(candidate?.entities.counterpartyName).toBe('Abraham');
    expect(candidate?.entities.amount).toBe('100000.00');
    expect(candidate?.entities.currency).toBeUndefined();
  });

  it('"Registra una cuenta por cobrar a José por 80k." resolves CREATE_RECEIVABLE', () => {
    const { candidate } = routeAndValidate('Registra una cuenta por cobrar a José por 80k.');
    expect(candidate?.intent).toBe('CREATE_RECEIVABLE');
    expect(candidate?.entities.counterpartyName).toBe('José');
    expect(candidate?.entities.amount).toBe('80000.00');
  });

  it('"Le debemos 100 mil a Pepe." resolves CREATE_PAYABLE', () => {
    const { candidate } = routeAndValidate('Le debemos 100 mil a Pepe.');
    expect(candidate?.intent).toBe('CREATE_PAYABLE');
    expect(candidate?.entities.counterpartyName).toBe('Pepe');
    expect(candidate?.entities.amount).toBe('100000.00');
  });

  it('"Tenemos pendiente 50k con el relojero." resolves CREATE_PAYABLE, article stripped', () => {
    const { candidate } = routeAndValidate('Tenemos pendiente 50k con el relojero.');
    expect(candidate?.intent).toBe('CREATE_PAYABLE');
    expect(candidate?.entities.counterpartyName).toBe('relojero');
    expect(candidate?.entities.amount).toBe('50000.00');
  });

  // --- §50 — ambiguous payment must never silently pick a capability ---

  it('"Pagué 50 mil." alone stays ambiguous — never silently becomes REGISTER_EXPENSE', () => {
    const verdict = route('Pagué 50 mil.');
    expect(verdict.kind).toBe('AMBIGUOUS_OPERATION');
  });

  // --- §51/§34 — negation ---

  it('"No vendí el Bruce Wayne." never produces a REGISTER_SALE write', () => {
    const verdict = route('No vendí el Bruce Wayne.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"Todavía no le he pagado." never produces a write', () => {
    const verdict = route('Todavía no le he pagado.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"No me ha pagado." never produces a write', () => {
    const verdict = route('No me ha pagado.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  // --- §52/§35 — future / hypothetical ---

  it('"Voy a vender el Bruce Wayne en 500k." never produces a completed-event write (infinitive verb, excluded by lexicon design)', () => {
    const verdict = route('Voy a vender el Bruce Wayne en 500k.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"Si vendo el Pepsi en 300…" is blocked by the hypothetical-marker guard', () => {
    const verdict = route('Si vendo el Pepsi en 300 mil, avísame.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"Quiero comprar un Daytona." never produces a completed-event write', () => {
    const verdict = route('Quiero comprar un Daytona.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  // --- §53/§36 — questions ---

  it('"¿Vendimos el Bruce Wayne?" never routes as a new sale', () => {
    const verdict = route('¿Vendimos el Bruce Wayne?');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"¿Cuánto pagué por el Pepsi?" never routes as a write', () => {
    const verdict = route('¿Cuánto pagué por el Pepsi?');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"¿José ya me pagó?" never routes as REGISTER_RECEIVABLE_PAYMENT', () => {
    const verdict = route('¿José ya me pagó?');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  // --- §63 — messy dealer language: typos, shorthand, no punctuation ---

  it('"vendi bruce 500 bancos" (unpunctuated, no accents) still resolves the watch and amount', () => {
    const { candidate } = routeAndValidate('vendi bruce 500 bancos');
    expect(candidate?.intent).toBe('REGISTER_SALE');
    expect(candidate?.entities.watchQuery).toBe('bruce');
    expect(candidate?.entities.price).toBe('500.00');
  });

  it('"se fue elephant 415 abraham" resolves watch/amount, customer left for the planner (no "a" marker present)', () => {
    const verdict = route('se fue elephant 415 abraham');
    expect(verdict.kind).toBe('HIGH_CONFIDENCE_OPERATION');
    if (verdict.kind === 'HIGH_CONFIDENCE_OPERATION') {
      expect(verdict.capability).toBe('REGISTER_SALE');
      expect(verdict.entities.watchQuery).toBe('elephant');
    }
  });

  it('"jose ya me pago los 120" resolves REGISTER_RECEIVABLE_PAYMENT despite the question-shaped "ya" opener not applying (declarative, not interrogative)', () => {
    const verdict = route('jose ya me pago los 120');
    // "ya me" is treated as an interrogative opener only when it STARTS the
    // message; here it's mid-sentence, so the question guard correctly does
    // not fire, and the receivable-payment subject-before-verb shape wins.
    expect(verdict.kind).toBe('HIGH_CONFIDENCE_OPERATION');
    if (verdict.kind === 'HIGH_CONFIDENCE_OPERATION') {
      expect(verdict.capability).toBe('REGISTER_RECEIVABLE_PAYMENT');
    }
  });

  it('"pague 50 de gas" resolves REGISTER_EXPENSE via the "gas" category alias', () => {
    const { candidate } = routeAndValidate('pague 50 de gas');
    expect(candidate?.intent).toBe('REGISTER_EXPENSE');
    expect(candidate?.entities.category).toBe('GASOLINE');
    expect(candidate?.entities.amount).toBe('50.00');
  });

  it('"mueve 200 bancos cesar" (no explicit de/a markers) does not falsely resolve — falls through safely', () => {
    const verdict = route('mueve 200 bancos cesar');
    // No "de"/"a" marker words at all -> source/destination captures fail ->
    // insufficient evidence -> AMBIGUOUS, never a wrong-account guess.
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"le debemos 80 a pepe" resolves CREATE_PAYABLE', () => {
    const { candidate } = routeAndValidate('le debemos 80 a pepe');
    expect(candidate?.intent).toBe('CREATE_PAYABLE');
    expect(candidate?.entities.counterpartyName).toBe('pepe');
    expect(candidate?.entities.amount).toBe('80.00');
  });

  it('"abraham nos debe 100" resolves CREATE_RECEIVABLE', () => {
    const { candidate } = routeAndValidate('abraham nos debe 100');
    expect(candidate?.intent).toBe('CREATE_RECEIVABLE');
    expect(candidate?.entities.counterpartyName).toBe('abraham');
    expect(candidate?.entities.amount).toBe('100.00');
  });

  it('"compre panda 250 credito" resolves REGISTER_PURCHASE with paymentMode CREDIT', () => {
    const { candidate } = routeAndValidate('compre panda 250 credito');
    expect(candidate?.intent).toBe('REGISTER_PURCHASE');
    expect(candidate?.entities.watchQuery).toBe('panda');
    expect(candidate?.entities.paymentMode).toBe('CREDIT');
  });

  // --- NO_OPERATION_MATCH for genuinely unrelated small talk ---

  it('small talk with no operational verb falls through to the provider (NO_OPERATION_MATCH)', () => {
    const verdict = route('Buenos días, ¿cómo va todo?');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  // --- Hardening pass §5 — present-tense "vendo" safety ---
  // "Vendo…" is genuinely ambiguous (offer/listing vs. completed sale) unlike
  // "Vendí…", which only ever means the transaction already happened. A
  // false WRITE is more dangerous than a missed deterministic routing, so
  // present-tense-only evidence must NEVER reach HIGH_CONFIDENCE_OPERATION,
  // no matter how much else resolves.

  it('"Vendo un Batman en 300 mil." never reaches HIGH confidence — present tense alone is not a completed sale', () => {
    const verdict = route('Vendo un Batman en 300 mil.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"Estoy vendiendo un Batman." never reaches HIGH confidence (ongoing-offer sense, not completed)', () => {
    const verdict = route('Estoy vendiendo un Batman.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"Quiero vender un Batman." never reaches HIGH confidence (intent, not completed) — blocked by the future/hypothetical guard', () => {
    const verdict = route('Quiero vender un Batman.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('completed-event verbs (vendí/vendimos/se vendió/se fue/acabo de vender) remain the strongest deterministic routing', () => {
    for (const text of [
      'Vendí el Batman en 300 mil.',
      'Vendimos el Batman en 300 mil.',
      'Se vendió el Batman en 300 mil.',
      'Se fue el Batman en 300 mil.',
      'Acabo de vender el Batman en 300 mil.',
    ]) {
      const verdict = route(text);
      expect(verdict.kind).toBe('HIGH_CONFIDENCE_OPERATION');
      if (verdict.kind === 'HIGH_CONFIDENCE_OPERATION') {
        expect(verdict.capability).toBe('REGISTER_SALE');
      }
    }
  });

  // --- Hardening pass §6 — negation/question/future regression (exact task examples) ---

  it('"No vendí el Batman." never produces REGISTER_SALE', () => {
    const verdict = route('No vendí el Batman.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"Voy a vender el Batman." never produces a completed write', () => {
    const verdict = route('Voy a vender el Batman.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"Quiero vender el Batman." never produces a completed write', () => {
    const verdict = route('Quiero vender el Batman.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"¿Vendimos el Batman?" never produces a new sale', () => {
    const verdict = route('¿Vendimos el Batman?');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('"Vendí el Batman." (baseline positive control) still produces REGISTER_SALE', () => {
    const verdict = route('Vendí el Batman.');
    // No price stated -> sale lexicon's sufficientEvidence bar (watch+price)
    // is not met, so this alone is AMBIGUOUS, not HIGH — the point of this
    // test is that it's not blocked by negation/future/question guards the
    // way the four cases above are; add a price to see the HIGH path.
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
    const verdictWithPrice = route('Vendí el Batman en 300 mil.');
    expect(verdictWithPrice.kind).toBe('HIGH_CONFIDENCE_OPERATION');
  });

  // --- Hardening pass §7 — account alias / César collision regression ---
  // A person named César (investor/customer/seller/counterparty) must never
  // be misread as "Cuenta César" (the CESAR treasury account) unless
  // account-language context explicitly indicates Treasury/Capital semantics.

  it('"Vendí el Batman a César." — César is the customer, not a Treasury account (no destination emitted)', () => {
    const { candidate } = routeAndValidate('Vendí el Batman a César en 300 mil.');
    expect(candidate?.intent).toBe('REGISTER_SALE');
    expect(candidate?.entities.customerQuery).toBe('César');
  });

  it('"Vendí el Batman a César, me pagó por Bancos." — César stays the customer, BANK/BANCOS is the account, never CESAR', () => {
    const verdict = router.route('Vendí el Batman a César en 300 mil, me pagó por Bancos.');
    expect(verdict.kind).toBe('HIGH_CONFIDENCE_OPERATION');
    if (verdict.kind === 'HIGH_CONFIDENCE_OPERATION') {
      expect(verdict.entities.customerQuery).toBe('César');
      expect(verdict.entities.destination).toBe('BANCOS');
    }
  });

  it('"Me pagó César por Bancos." — César is the counterparty, BANK is the account, never CESAR', () => {
    const verdict = router.route('Me pagó César por Bancos, 50 mil pesos.');
    expect(verdict.kind).toBe('HIGH_CONFIDENCE_OPERATION');
    if (verdict.kind === 'HIGH_CONFIDENCE_OPERATION') {
      expect(verdict.capability).toBe('REGISTER_RECEIVABLE_PAYMENT');
      expect(verdict.entities.customerQuery).toBe('César');
      expect(verdict.entities.destination).toBe('BANK');
    }
  });

  it('"Le pagué a César por Bancos." — César is the counterparty, BANK is the account, never CESAR', () => {
    const verdict = router.route('Le pagué a César 50 mil pesos por Bancos.');
    expect(verdict.kind).toBe('HIGH_CONFIDENCE_OPERATION');
    if (verdict.kind === 'HIGH_CONFIDENCE_OPERATION') {
      expect(verdict.capability).toBe('REGISTER_PAYABLE_PAYMENT');
      expect(verdict.entities.counterpartyQuery).toBe('César');
      expect(verdict.entities.sourceAccount).toBe('BANK');
    }
  });

  it('"Le distribuí a César 80 mil en bancos." — César is the investor, BANK is the account, never CESAR', () => {
    const { candidate } = routeAndValidate('Le distribuí a César 80 mil en bancos.');
    expect(candidate?.intent).toBe('REGISTER_CAPITAL_DISTRIBUTION');
    expect(candidate?.entities.investorQuery).toBe('César');
    expect(candidate?.entities.account).toBe('BANK');
  });

  it('"Pasa 100 mil de Bancos a Cuenta César." — CESAR is a legitimate Treasury destination here (explicit account-language context)', () => {
    const { candidate } = routeAndValidate('Pasa 100 mil de Bancos a Cuenta César.');
    expect(candidate?.intent).toBe('REGISTER_TREASURY_TRANSFER');
    expect(candidate?.entities.sourceAccount).toBe('BANK');
    expect(candidate?.entities.destinationAccount).toBe('CESAR');
  });

  // --- Hardening pass §12 — updated eval corpus A–I ---

  it('§12.A "Vendí Bruce Wayne en 500k." routes deterministically to REGISTER_SALE with incomplete slots, not a rejection', () => {
    const { verdict, candidate } = routeAndValidate('Vendí Bruce Wayne en 500k.');
    expect(verdict.kind).toBe('HIGH_CONFIDENCE_OPERATION');
    expect(candidate?.intent).toBe('REGISTER_SALE');
    expect(candidate?.entities.currency).toBeUndefined();
  });

  it('§12.B "Vendí Bruce Wayne en 500k MXN." routes to REGISTER_SALE with currency resolved', () => {
    const { candidate } = routeAndValidate('Vendí Bruce Wayne en 500k MXN.');
    expect(candidate?.intent).toBe('REGISTER_SALE');
    expect(candidate?.entities.currency).toBe('MXN');
  });

  it('§12.C "Vendí Bruce Wayne en 500k MXN a Abraham Díaz y me pagó por Bancos." is a direct-preview candidate (all slots resolved)', () => {
    const { candidate } = routeAndValidate('Vendí Bruce Wayne en 500k MXN a Abraham Díaz y me pagó por Bancos.');
    expect(candidate?.intent).toBe('REGISTER_SALE');
    expect(candidate?.entities.watchQuery).toBe('Bruce Wayne');
    expect(candidate?.entities.price).toBe('500000.00');
    expect(candidate?.entities.currency).toBe('MXN');
    expect(candidate?.entities.customerQuery).toBe('Abraham Díaz');
    expect(candidate?.entities.paymentMode).toBe('PAID');
  });

  it('§12.D "Gasté 500 en gasolina." routes to REGISTER_EXPENSE with currency left missing', () => {
    const { candidate } = routeAndValidate('Gasté 500 en gasolina.');
    expect(candidate?.intent).toBe('REGISTER_EXPENSE');
    expect(candidate?.entities.amount).toBe('500.00');
    expect(candidate?.entities.category).toBe('GASOLINE');
    expect(candidate?.entities.currency).toBeUndefined();
  });

  it('§12.E "Gasté 500 pesos en gasolina de Bancos." is a complete expense candidate', () => {
    const { candidate } = routeAndValidate('Gasté 500 pesos en gasolina de Bancos.');
    expect(candidate?.intent).toBe('REGISTER_EXPENSE');
    expect(candidate?.entities.amount).toBe('500.00');
    expect(candidate?.entities.currency).toBe('MXN');
    expect(candidate?.entities.category).toBe('GASOLINE');
    expect(candidate?.entities.source).toBe('BANK');
  });

  it('§12.F "Vendo el Batman en 300." must NOT be confidently treated as a completed sale', () => {
    const verdict = route('Vendo el Batman en 300.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('§12.G "Quiero vender el Batman." is NO_WRITE', () => {
    const verdict = route('Quiero vender el Batman.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('§12.H "No vendí el Batman." is NO_WRITE', () => {
    const verdict = route('No vendí el Batman.');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });

  it('§12.I "¿Vendimos el Batman?" is NO_WRITE', () => {
    const verdict = route('¿Vendimos el Batman?');
    expect(verdict.kind).not.toBe('HIGH_CONFIDENCE_OPERATION');
  });
});
