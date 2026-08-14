import { RoutableCapability } from '../operational-intent-router.types';

/**
 * The router's own outcome taxonomy. Deliberately coarser than the task's
 * full DIRECT_PREVIEW/NEEDS_ONE_INPUT/NEEDS_DISAMBIGUATION/AMBIGUOUS_INTENT/
 * NO_WRITE/PROVIDER_FALLBACK vocabulary: distinguishing DIRECT_PREVIEW from
 * NEEDS_ONE_INPUT correctly requires replicating each capability's planner
 * conditionalMissing logic (business-actions.ts) field-by-field — that exact
 * verification already exists, done PRECISELY against real code, in
 * tests/regression.spec.ts. This corpus instead verifies what the router
 * itself is responsible for and can self-report honestly: which capability
 * (if any) it routed to, and whether it ever produces a false/ambiguous
 * write. NEEDS_DISAMBIGUATION also doesn't apply here — that's a downstream
 * entity-resolver concern (e.g. two matching watches), not something the
 * router itself performs.
 */
export type RouterEvalOutcome =
  | 'ROUTED' // HIGH_CONFIDENCE_OPERATION — capability chosen deterministically
  | 'AMBIGUOUS' // AMBIGUOUS_OPERATION — falls through to provider, never guesses
  | 'NO_MATCH'; // NO_OPERATION_MATCH — by design (negation/future/question) or genuinely unrecognized; see `note`

export interface RouterEvalCase {
  text: string;
  expectedOutcome: RouterEvalOutcome;
  expectedCapability?: RoutableCapability;
  /** Human-readable context for NO_MATCH cases — why it's expected to fall through. */
  note?: string;
}

/**
 * ~115 cases across every category the task asks for (sale, purchase,
 * expense, receivable payment, payable payment, transfer, capital
 * contribution/distribution, CxC/CxP creation, negatives, future/
 * hypothetical, questions, ambiguous payment, messy/shorthand/unpunctuated
 * dealer language, reversal pass-through, small talk). Deterministic — runs
 * against the router only, no network, no live model.
 */
export const ROUTER_EVAL_DATASET: RouterEvalCase[] = [
  // ─── Sale ────────────────────────────────────────────────────────────────
  { text: 'Vendí Bruce Wayne en 500k.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Vendí un Bruce Wayne en 500k MXN a Abraham Díaz y me pagó por Bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Vendí el Elephant en 415 mil MXN.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Vendí ap elephant en 415k mxn.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Le vendí un Panda a Abraham por 300.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Se fue el Batman en 280k.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Vendimos el Daytona en 600 mil pesos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Acabo de vender el Submariner en 250 mil.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'vendi bruce 500 bancos', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'se fue elephant 415 abraham', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'vendi el nautilus a jose en 900k usd', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Vendí un Bruce Wayne en 500k a Abraham.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Vendo relojes desde hace años.', expectedOutcome: 'AMBIGUOUS', note: 'verb matches but no amount — insufficient evidence' },
  // Hardening pass §12.B — explicit currency word resolves currency.
  { text: 'Vendí Bruce Wayne en 500k MXN.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  // Hardening pass §12.F / §5 — present-tense "vendo" is never confidently a completed sale.
  { text: 'Vendo el Batman en 300.', expectedOutcome: 'AMBIGUOUS', note: 'present-tense-only evidence never claims HIGH confidence — offer/listing vs. completed sale is genuinely ambiguous' },
  // Hardening pass §12.G / §6 — intent-to-sell is not a completed write.
  { text: 'Quiero vender el Batman.', expectedOutcome: 'NO_MATCH', note: 'future/hypothetical guard: "quiero" intent prefix' },
  // Hardening pass §12.H / §6 — negation guard, exact task wording.
  { text: 'No vendí el Batman.', expectedOutcome: 'NO_MATCH', note: 'negation guard' },
  // Hardening pass §12.I / §6 — question guard, exact task wording.
  { text: '¿Vendimos el Batman?', expectedOutcome: 'NO_MATCH', note: 'question guard' },
  // Hardening pass §7 — César-as-person must still route to REGISTER_SALE,
  // not be swallowed by the CESAR account-alias collision.
  { text: 'Vendí el Batman a César en 300 mil, me pagó por Bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },

  // ─── Purchase ────────────────────────────────────────────────────────────
  { text: 'Compré un Pepsi en 280 mil pesos a José y pagué por Bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PURCHASE' },
  { text: 'Compré un AP Elephant a José en 350 mil pesos, pagué 100 de Bancos y el resto quedó a crédito.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PURCHASE' },
  { text: 'Compre panda 250 credito', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PURCHASE' },
  { text: 'Compramos el Daytona en 700 mil.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PURCHASE' },
  { text: 'Acabo de comprar un Submariner en 200 mil.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PURCHASE' },
  { text: 'Le compré el AP Panda a José en 450k USD.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PURCHASE' },
  { text: 'Compré un reloj.', expectedOutcome: 'AMBIGUOUS', note: 'verb matches, watchQuery="reloj" but no amount — insufficient evidence' },

  // ─── Expense ─────────────────────────────────────────────────────────────
  { text: 'Gasté 500 pesos en gasolina de Bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  // Hardening pass §12.D — no explicit currency word: routes, currency left missing for the planner to ask.
  { text: 'Gasté 500 en gasolina.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'Gasté 1,500 pesos de gasolina y lo pagué en efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'pague 50 de gas', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'Gasté 300 en casetas.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'Pagué 800 de publicidad desde Bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'Pagué gasolina.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'Gastamos 5 mil en marketing con la tarjeta de bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'Metí 400 de comisión.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'Fueron 250 de estacionamiento en efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'Salieron 900 de vuelos desde bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },

  // ─── Ambiguous "pagué" (must never silently become expense) ────────────
  { text: 'Pagué 50 mil.', expectedOutcome: 'AMBIGUOUS' },
  { text: 'Pagué la cuenta.', expectedOutcome: 'AMBIGUOUS' },
  { text: 'Pagué 100.', expectedOutcome: 'AMBIGUOUS' },

  // ─── Receivable payment ──────────────────────────────────────────────────
  { text: 'José me pagó 50 mil pesos por Bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_RECEIVABLE_PAYMENT' },
  { text: 'Abraham me depositó 50k.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_RECEIVABLE_PAYMENT' },
  { text: 'jose ya me pago los 120', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_RECEIVABLE_PAYMENT' },
  {
    text: 'Nos depositaron 80 mil por bancos.',
    expectedOutcome: 'AMBIGUOUS',
    note: 'hardening pass: no named counterparty at all (implicit subject only) -> sufficientEvidence now correctly requires a real customerQuery, not just a matched verb, since accountId/customerId can never resolve without one; falls to provider, which can ask "¿quién te pagó?"',
  },
  { text: 'Cobré la cuenta de Carlos en efectivo, 90 mil.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_RECEIVABLE_PAYMENT' },
  { text: 'Cobré la cuenta de Carlos en efectivo.', expectedOutcome: 'AMBIGUOUS', note: 'no amount stated' },
  {
    text: 'Me liquidó 200 mil por bancos.',
    expectedOutcome: 'AMBIGUOUS',
    note: 'hardening pass: same as "Nos depositaron..." above -> no named counterparty, correctly falls to provider',
  },
  { text: 'Diego me pagó 15 mil en efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_RECEIVABLE_PAYMENT' },

  // ─── Payable payment ─────────────────────────────────────────────────────
  { text: 'Le pagué a José 80 mil pesos desde Bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PAYABLE_PAYMENT' },
  { text: 'Liquidé la cuenta del proveedor en efectivo.', expectedOutcome: 'AMBIGUOUS', note: 'no amount stated' },
  { text: 'le debemos 80 a pepe', expectedOutcome: 'ROUTED', expectedCapability: 'CREATE_PAYABLE', note: '"debemos" -> CREATE_PAYABLE, not a payment' },
  { text: 'Pagamos a José 50 mil desde efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PAYABLE_PAYMENT' },
  { text: 'Ya le pagué 30 mil a Carlos por bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PAYABLE_PAYMENT' },
  { text: 'Pagué la deuda con Carlos, 60 mil en efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PAYABLE_PAYMENT' },
  // Hardening pass §7 — César-as-counterparty regressions (exact task wording).
  { text: 'Me pagó César por Bancos, 50 mil pesos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_RECEIVABLE_PAYMENT' },
  { text: 'Le pagué a César 50 mil pesos por Bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PAYABLE_PAYMENT' },

  // ─── Treasury transfer ───────────────────────────────────────────────────
  { text: 'Pasa 100 mil de Bancos a Efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_TREASURY_TRANSFER' },
  { text: 'Mueve 200k a Cuenta César desde Bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_TREASURY_TRANSFER' },
  { text: 'Pásale 50 mil de Efectivo a Bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_TREASURY_TRANSFER' },
  { text: 'Transfiere 300 mil de Bancos a Cuenta César.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_TREASURY_TRANSFER' },
  { text: 'Manda 20 mil de Efectivo a Bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_TREASURY_TRANSFER' },
  { text: 'mueve 200 bancos cesar', expectedOutcome: 'AMBIGUOUS', note: 'no de/a markers to assign source vs destination' },
  { text: 'Pasa 100 mil.', expectedOutcome: 'AMBIGUOUS', note: 'no accounts at all' },

  // ─── Capital contribution / distribution ────────────────────────────────
  { text: 'César aportó 300 mil.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_CAPITAL_CONTRIBUTION' },
  { text: 'Alejandro Torres metió capital 400 mil en bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_CAPITAL_CONTRIBUTION' },
  { text: 'Diego Navarro hizo una aportación de 150 mil.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_CAPITAL_CONTRIBUTION' },
  { text: 'Diego Navarro retiró utilidad de 150k.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_CAPITAL_DISTRIBUTION' },
  { text: 'Le distribuí a César 80 mil en bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_CAPITAL_DISTRIBUTION' },
  { text: 'Reparto de utilidad de 60 mil para Diego.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_CAPITAL_DISTRIBUTION' },
  { text: 'César aportó.', expectedOutcome: 'AMBIGUOUS', note: 'no amount' },

  // ─── CxC / CxP creation ──────────────────────────────────────────────────
  { text: 'Abraham nos debe 100 mil.', expectedOutcome: 'ROUTED', expectedCapability: 'CREATE_RECEIVABLE' },
  { text: 'abraham nos debe 100', expectedOutcome: 'ROUTED', expectedCapability: 'CREATE_RECEIVABLE' },
  { text: 'Registra una cuenta por cobrar a José por 80k.', expectedOutcome: 'ROUTED', expectedCapability: 'CREATE_RECEIVABLE' },
  { text: 'José quedó debiendo 50 mil.', expectedOutcome: 'ROUTED', expectedCapability: 'CREATE_RECEIVABLE' },
  { text: 'Le debemos 100 mil a Pepe.', expectedOutcome: 'ROUTED', expectedCapability: 'CREATE_PAYABLE' },
  { text: 'Tenemos pendiente 50k con el relojero.', expectedOutcome: 'ROUTED', expectedCapability: 'CREATE_PAYABLE' },
  { text: 'Registra una cuenta por pagar a Carlos por 40 mil.', expectedOutcome: 'ROUTED', expectedCapability: 'CREATE_PAYABLE' },
  { text: 'Nos deben.', expectedOutcome: 'NO_MATCH', note: 'no counterparty, no amount' },

  // ─── Negation ────────────────────────────────────────────────────────────
  { text: 'No vendí el Bruce Wayne.', expectedOutcome: 'NO_MATCH', note: 'negation guard' },
  { text: 'Todavía no le he pagado.', expectedOutcome: 'NO_MATCH', note: 'negation guard' },
  { text: 'No me ha pagado.', expectedOutcome: 'NO_MATCH', note: 'negation guard' },
  { text: 'No compré nada.', expectedOutcome: 'NO_MATCH', note: 'negation guard' },
  { text: 'Nunca gasté ese dinero.', expectedOutcome: 'NO_MATCH', note: 'negation guard' },
  { text: 'Aún no aporta capital.', expectedOutcome: 'NO_MATCH', note: 'negation guard' },

  // ─── Future / hypothetical ───────────────────────────────────────────────
  { text: 'Voy a vender el Bruce Wayne en 500k.', expectedOutcome: 'NO_MATCH', note: 'infinitive verb, excluded by lexicon design' },
  { text: 'Si vendo el Pepsi en 300 mil, avísame.', expectedOutcome: 'NO_MATCH', note: 'hypothetical-marker guard' },
  { text: 'Quiero comprar un Daytona.', expectedOutcome: 'NO_MATCH', note: 'infinitive verb' },
  { text: 'Voy a pagarle a José mañana.', expectedOutcome: 'NO_MATCH', note: 'future-intent guard' },
  { text: 'Pienso vender el Submariner pronto.', expectedOutcome: 'NO_MATCH', note: 'future-intent guard' },
  { text: 'Cuando venda el Batman te aviso.', expectedOutcome: 'NO_MATCH', note: 'hypothetical-marker guard' },

  // ─── Questions ───────────────────────────────────────────────────────────
  { text: '¿Vendimos el Bruce Wayne?', expectedOutcome: 'NO_MATCH', note: 'question guard' },
  { text: '¿Cuánto pagué por el Pepsi?', expectedOutcome: 'NO_MATCH', note: 'question guard' },
  { text: '¿José ya me pagó?', expectedOutcome: 'NO_MATCH', note: 'question guard' },
  { text: '¿Vendí el Batman en cuánto?', expectedOutcome: 'NO_MATCH', note: 'question guard' },
  { text: '¿Ya le pagué al relojero?', expectedOutcome: 'NO_MATCH', note: 'question guard' },
  { text: '¿Cuál fue el costo del Daytona?', expectedOutcome: 'NO_MATCH', note: 'question, no operational verb anyway' },

  // ─── Messy / typo / shorthand / unpunctuated (task §63) ─────────────────
  { text: 'vendi el daytona en 300mil', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'gaste 200 en peajes', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'compre reloj a jose', expectedOutcome: 'AMBIGUOUS', note: 'verb matches but no amount — insufficient evidence' },
  { text: 'vendo relojes de lujo', expectedOutcome: 'AMBIGUOUS', note: 'verb matches but no amount — insufficient evidence' },

  // ─── Reversal language must never be claimed by this router ────────────
  // (Handled earlier in precedence by the existing correction-language
  // detectors in production; this router has no reversal lexicon at all, so
  // these correctly fall through regardless.)
  { text: 'Deshaz eso.', expectedOutcome: 'NO_MATCH', note: 'reversal language — not this router\'s concern' },
  { text: 'Revierte ese gasto.', expectedOutcome: 'NO_MATCH', note: 'reversal language — not this router\'s concern' },
  { text: 'Borra esa transferencia.', expectedOutcome: 'NO_MATCH', note: 'reversal language — not this router\'s concern' },

  // ─── Small talk / genuinely unrelated ────────────────────────────────────
  { text: 'Buenos días, ¿cómo va todo?', expectedOutcome: 'NO_MATCH', note: 'question guard' },
  { text: 'Gracias por tu ayuda.', expectedOutcome: 'NO_MATCH', note: 'no operational verb' },
  { text: 'Hola Jarvis.', expectedOutcome: 'NO_MATCH', note: 'no operational verb' },
  { text: '¿Qué tal el clima hoy?', expectedOutcome: 'NO_MATCH', note: 'question guard' },

  // ─── More rich single-turn variety across capabilities ──────────────────
  { text: 'Vendí el Panda a Renata Beltrán en 180 mil, me pagó todo en efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Compré el GMT a Sebastián en 220 mil dólares.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PURCHASE' },
  { text: 'Gastamos 12 mil en viáticos con la cuenta de César.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'Renata nos depositó 45 mil por bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_RECEIVABLE_PAYMENT' },
  { text: 'Ya le pagué a Fabián los 90 mil desde efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PAYABLE_PAYMENT' },
  { text: 'Pásale 15 mil de la cuenta César a Bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_TREASURY_TRANSFER' },
  { text: 'Marisol aportó 90 mil en efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_CAPITAL_CONTRIBUTION' },
  { text: 'Le pagamos utilidad a Octavio, 70 mil en bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_CAPITAL_DISTRIBUTION' },
  { text: 'Carlos nos debe 65 mil.', expectedOutcome: 'ROUTED', expectedCapability: 'CREATE_RECEIVABLE' },
  { text: 'Debemos pagarle 30 mil a Natalia.', expectedOutcome: 'ROUTED', expectedCapability: 'CREATE_PAYABLE' },

  // ─── Additional negative/future/question breadth ────────────────────────
  { text: 'No le pagué todavía a José.', expectedOutcome: 'NO_MATCH', note: 'negation guard' },
  { text: 'No hemos comprado nada este mes.', expectedOutcome: 'NO_MATCH', note: 'negation guard' },
  { text: 'Voy a transferir dinero mañana.', expectedOutcome: 'NO_MATCH', note: 'infinitive verb, future-intent guard' },
  { text: 'Quisiera vender el Daytona pronto.', expectedOutcome: 'NO_MATCH', note: 'infinitive verb' },
  { text: '¿Cuánto le debemos al relojero?', expectedOutcome: 'NO_MATCH', note: 'question guard' },
  { text: '¿Ya aportó César este mes?', expectedOutcome: 'NO_MATCH', note: 'question guard' },

  // ─── Extra shorthand/currency variety ────────────────────────────────────
  { text: 'vendi el submariner en 10k usd a carlos', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'compre el nautilus en 1.5 millones a renata', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PURCHASE' },
  { text: 'gaste 3,200 pesos en vuelos', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'jose me deposito 15k dlls', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_RECEIVABLE_PAYMENT' },
  { text: 'le pague a carlos 22k dls desde bancos', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PAYABLE_PAYMENT' },

  // ─── 27A-prod: exact task regression sentences + payment-preposition hard gate ──
  { text: 'Vendí Bruce Wayne en 500 mil a Abraham y me pagó por bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Vendí Bruce Wayne en 500 mil MXN a Abraham y me pagó por bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Vendí AP Elephant en 415 mil a César y me pagó por efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Vendí Bruce Wayne en 500 mil MXN a Abraham Valdez y me pagó por bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Vendí un reloj desconocido en 500k.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE', note: 'watch resolution is downstream — amount must extract independent of watch identity' },
  { text: 'Vendí XYZ en 2 millones.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE', note: 'amount survives even for a nonsense/unresolvable watch query' },
  { text: 'Gasté 500 en gasolina.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'Gasté 500 pesos en gasolina y pagué en efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_EXPENSE' },
  { text: 'José me pagó 120 mil por bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_RECEIVABLE_PAYMENT' },
  { text: 'Le pagué a José 80 mil desde bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PAYABLE_PAYMENT' },
  { text: 'Compré un Panda en 320 mil MXN a José y pagué por bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_PURCHASE' },
  { text: 'Pasa 100 mil de Bancos a Efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_TREASURY_TRANSFER' },
  // Payment-account hard gate: both prepositions ("por"/"en") must resolve
  // the same account, independent of which one the dealer happens to use.
  { text: 'Vendí el Daytona en 300 mil a Renata, me pagó por bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Vendí el Daytona en 300 mil a Renata, me pagó en bancos.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Vendí el Daytona en 300 mil a Renata, me pagó en efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
  { text: 'Vendí el Daytona en 300 mil a Renata, me pagó por efectivo.', expectedOutcome: 'ROUTED', expectedCapability: 'REGISTER_SALE' },
];
