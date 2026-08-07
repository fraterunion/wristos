'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Bitcoin,
  Boxes,
  ChevronDown,
  CircleDollarSign,
  Landmark,
  PackagePlus,
  ReceiptText,
  Search,
  ShoppingCart,
  UserRoundSearch,
  WalletCards,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ConversationComposer } from '@/components/assistant/conversation-composer';
import { ConversationThread } from '@/components/assistant/conversation-thread';
import {
  AssistantMessageRequestError,
  AssistantRequestError,
  clearResumeHint,
  confirmAssistantActionRun,
  confirmResultToAssistantResponse,
  createAssistantAction,
  createAssistantMessageAction,
  readResumeHint,
  resumeAssistantWorkspace,
  writeResumeHint,
  type AssistantAction,
  type AssistantMessageAction,
} from '@/lib/assistant-api';
import type {
  AssistantHistoryItem,
  BusinessActionId,
  JsonValue,
  ReadAction,
  WritePreviewAction,
} from '@/lib/assistant-types';

const readCards: Array<{ id: ReadAction; label: string; detail: string; icon: typeof Landmark }> = [
  { id: 'GET_LIQUIDITY', label: 'Ver liquidez', detail: 'Caja, bancos, crypto y total', icon: Landmark },
  { id: 'GET_MONTHLY_PROFIT', label: 'Utilidad mensual', detail: 'Resumen del mes seleccionado', icon: BarChart3 },
  { id: 'SEARCH_INVENTORY', label: 'Buscar inventario', detail: 'Disponibilidad y referencias', icon: Boxes },
  { id: 'SEARCH_CLIENT', label: 'Buscar cliente', detail: 'Resultados del CRM', icon: UserRoundSearch },
  { id: 'GET_CLIENT_ACCOUNTS', label: 'Consultar cuentas', detail: 'Busca primero al cliente', icon: WalletCards },
];

const writeCards: Array<{ id: WritePreviewAction; label: string; href: string; icon: typeof Landmark }> = [
  { id: 'REGISTER_SALE', label: 'Preparar venta', href: '/ventas', icon: ReceiptText },
  { id: 'REGISTER_RECEIVABLE_PAYMENT', label: 'Preparar cobro CxC', href: '/cuentas', icon: CircleDollarSign },
  { id: 'REGISTER_PURCHASE', label: 'Preparar compra', href: '/inventory', icon: ShoppingCart },
  { id: 'REGISTER_EXPENSE', label: 'Preparar gasto', href: '/expenses', icon: WalletCards },
  { id: 'REGISTER_SETTLEMENT', label: 'Preparar liquidación', href: '/cuentas', icon: Landmark },
  { id: 'REGISTER_CRYPTO_POSITION', label: 'Preparar posición crypto', href: '/crypto', icon: PackagePlus },
  { id: 'REGISTER_CRYPTO_PRICE', label: 'Preparar precio crypto', href: '/crypto', icon: Bitcoin },
];

// Mobile-only copy: shorter, action-first labels for the chip row and the
// compact "Preparar acciones" rows. Desktop keeps the labels above unchanged.
const mobileSuggestionLabels: Partial<Record<ReadAction, string>> = {
  GET_LIQUIDITY: 'Ver liquidez',
  GET_MONTHLY_PROFIT: 'Ver utilidad',
  SEARCH_INVENTORY: 'Buscar reloj',
  SEARCH_CLIENT: 'Buscar cliente',
  GET_CLIENT_ACCOUNTS: 'Consultar cuentas',
};

const mobileWriteLabels: Partial<Record<WritePreviewAction, string>> = {
  REGISTER_SALE: 'Registrar venta',
  REGISTER_RECEIVABLE_PAYMENT: 'Registrar cobro',
  REGISTER_PURCHASE: 'Registrar compra',
  REGISTER_EXPENSE: 'Registrar gasto',
  REGISTER_SETTLEMENT: 'Liquidación',
  REGISTER_CRYPTO_POSITION: 'Posición crypto',
  REGISTER_CRYPTO_PRICE: 'Precio crypto',
};

const composerExamples = [
  'Vendí Batman en $350,000',
  'José me pagó 120,000',
  'Compré un Yacht Master',
  'Muéstrame mi liquidez',
];

const monthNames = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// Natural, first-person phrasing for the quick-action reads, so the thread
// shows what the user is asking for instead of a raw intent label.
function naturalReadText(action: ReadAction, params: { month: number; year: number; query: string }): string {
  switch (action) {
    case 'GET_LIQUIDITY':
      return 'Muéstrame mi liquidez.';
    case 'GET_MONTHLY_PROFIT':
      return `Muéstrame la utilidad de ${monthNames[params.month - 1]} de ${params.year}.`;
    case 'SEARCH_INVENTORY':
      return params.query ? `Busca ${params.query} en inventario.` : 'Busca en inventario.';
    case 'SEARCH_CLIENT':
      return params.query ? `Busca a ${params.query}.` : 'Busca un cliente.';
    case 'GET_CLIENT_ACCOUNTS':
      return params.query ? `Muéstrame las cuentas de ${params.query}.` : 'Muéstrame las cuentas de un cliente.';
    default:
      return 'Consulta.';
  }
}

type WorkspaceState = {
  workspaceId?: string;
  conversationId?: string;
  version?: number;
};

function initialMonth() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export default function AssistantPage() {
  const [workspace, setWorkspace] = useState<WorkspaceState>({});
  const [activeRead, setActiveRead] = useState<ReadAction | null>(null);
  const [history, setHistory] = useState<AssistantHistoryItem[]>([]);
  // Client-captured, session-only timestamps for grouping/labeling the
  // activity thread (Hoy/Ayer/hace N min) — never sent to the server.
  const [historyTimestamps, setHistoryTimestamps] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<AssistantAction | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<AssistantAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Mirrors pending/pendingLabel/retryAction/error above, for the free-form
  // natural-language endpoint. Kept separate from the structured-action
  // state (rather than unified) to avoid touching the existing, already
  //-verified quick-action flow — both share the same ConversationThread via
  // the combined values computed below.
  const [messagePending, setMessagePending] = useState<AssistantMessageAction | null>(null);
  const [messagePendingLabel, setMessagePendingLabel] = useState<string | null>(null);
  const [messageRetryAction, setMessageRetryAction] = useState<AssistantMessageAction | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [confirmingSale, setConfirmingSale] = useState(false);
  const [composerValue, setComposerValue] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [writeActionsOpen, setWriteActionsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [limit, setLimit] = useState(10);
  const [{ month, year }, setMonth] = useState(initialMonth);

  useEffect(() => {
    const hint = readResumeHint();
    if (!hint) return;
    let cancelled = false;
    void resumeAssistantWorkspace(hint.workspaceId)
      .then((resumed) => {
        if (cancelled || resumed.deletedAt) return;
        setWorkspace({
          workspaceId: resumed.id,
          conversationId: resumed.conversationId ?? hint.conversationId,
          version: resumed.version,
        });
      })
      .catch(() => clearResumeHint());
    return () => { cancelled = true; };
  }, []);

  // Purely cosmetic — cycles the composer's placeholder text, mirrors
  // the input's own value only, never read on submit.
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((index) => (index + 1) % composerExamples.length);
    }, 3200);
    return () => clearInterval(interval);
  }, []);

  const refreshWorkspaceVersion = useCallback(async (workspaceId: string) => {
    try {
      const resumed = await resumeAssistantWorkspace(workspaceId);
      setWorkspace({
        workspaceId: resumed.id,
        conversationId: resumed.conversationId ?? undefined,
        version: resumed.version,
      });
    } catch {
      clearResumeHint();
    }
  }, []);

  const runAction = useCallback(async (action: AssistantAction, label: string) => {
    if (pending || messagePending) return;
    setPending(action);
    setPendingLabel(label);
    setRetryAction(null);
    setError(null);
    try {
      const response = await action.execute();
      setHistory((items) => [{ id: response.requestId, label, intent: action.request.intent, entities: action.request.entities, response }, ...items]);
      setHistoryTimestamps((current) => ({ ...current, [response.requestId]: Date.now() }));
      setWorkspace((current) => ({
        ...current,
        workspaceId: response.workspaceId,
        conversationId: response.conversationId,
      }));
      writeResumeHint({ workspaceId: response.workspaceId, conversationId: response.conversationId });
      void refreshWorkspaceVersion(response.workspaceId);
    } catch (caught) {
      setRetryAction(action);
      if (caught instanceof AssistantRequestError) {
        setError(caught.message);
        if (caught.response) {
          const failedResponse = caught.response;
          setHistory((items) => [{ id: failedResponse.requestId, label, intent: action.request.intent, entities: action.request.entities, response: failedResponse }, ...items]);
          setHistoryTimestamps((current) => ({ ...current, [failedResponse.requestId]: Date.now() }));
        }
      } else {
        setError('Se perdió la conexión. Puedes reintentar la misma solicitud de forma segura.');
      }
    } finally {
      setPending(null);
      setPendingLabel(null);
    }
  }, [pending, messagePending, refreshWorkspaceVersion]);

  const runMessageAction = useCallback(async (action: AssistantMessageAction, label: string) => {
    if (pending || messagePending) return;
    setMessagePending(action);
    setMessagePendingLabel(label);
    setMessageRetryAction(null);
    setMessageError(null);
    try {
      const result = await action.execute();
      const id = result.response.requestId;
      setHistory((items) => [{ id, label, intent: result.resolvedIntent, entities: result.resolvedEntities, response: result.response }, ...items]);
      setHistoryTimestamps((current) => ({ ...current, [id]: Date.now() }));
      setWorkspace((current) => ({
        ...current,
        workspaceId: result.response.workspaceId,
        conversationId: result.response.conversationId,
      }));
      writeResumeHint({ workspaceId: result.response.workspaceId, conversationId: result.response.conversationId });
      void refreshWorkspaceVersion(result.response.workspaceId);
    } catch (caught) {
      setMessageRetryAction(action);
      if (caught instanceof AssistantMessageRequestError) {
        setMessageError(caught.message);
        if (caught.result) {
          const failedResult = caught.result;
          const id = failedResult.response.requestId;
          setHistory((items) => [{ id, label, intent: failedResult.resolvedIntent, entities: failedResult.resolvedEntities, response: failedResult.response }, ...items]);
          setHistoryTimestamps((current) => ({ ...current, [id]: Date.now() }));
        }
      } else {
        setMessageError('Se perdió la conexión. Puedes reintentar la misma solicitud de forma segura.');
      }
    } finally {
      setMessagePending(null);
      setMessagePendingLabel(null);
    }
  }, [pending, messagePending, refreshWorkspaceVersion]);

  const makeAction = useCallback((intent: BusinessActionId, entities: Record<string, JsonValue>, label: string, userDisplayText?: string) => {
    const action = createAssistantAction({
      intent,
      entities,
      userDisplayText,
      conversationId: workspace.conversationId,
      workspaceId: workspace.workspaceId,
      expectedWorkspaceVersion: workspace.version,
    });
    void runAction(action, label);
  }, [runAction, workspace]);

  const openRead = (action: ReadAction) => {
    setError(null);
    if (action === 'GET_LIQUIDITY') {
      makeAction(action, {}, naturalReadText('GET_LIQUIDITY', { month, year, query: '' }));
      return;
    }
    setActiveRead(action);
    setQuery('');
  };

  const submitRead = (event: FormEvent) => {
    event.preventDefault();
    if (!activeRead) return;
    const trimmed = query.trim();
    if (activeRead === 'GET_MONTHLY_PROFIT') {
      makeAction(activeRead, { year, month }, naturalReadText('GET_MONTHLY_PROFIT', { month, year, query: '' }));
    } else if (activeRead === 'SEARCH_INVENTORY') {
      makeAction(activeRead, { query: trimmed, status, limit }, naturalReadText('SEARCH_INVENTORY', { month, year, query: trimmed }), trimmed);
    } else {
      makeAction(
        'SEARCH_CLIENT',
        { query: trimmed, limit },
        naturalReadText(activeRead === 'GET_CLIENT_ACCOUNTS' ? 'GET_CLIENT_ACCOUNTS' : 'SEARCH_CLIENT', { month, year, query: trimmed }),
        trimmed,
      );
    }
    setActiveRead(null);
  };

  const selectClient = (id: string, label: string) => {
    makeAction('GET_CLIENT_ACCOUNTS', { clientId: id }, `Muéstrame las cuentas de ${label}.`);
  };

  const continueItem = useCallback((item: AssistantHistoryItem, entities: Record<string, JsonValue>) => {
    // 'UNKNOWN' never reached the orchestrator in the first place — there is
    // no structured intent to continue.
    if (item.intent === 'UNKNOWN') return;
    makeAction(item.intent, { ...item.entities, ...entities }, item.label);
  }, [makeAction]);

  const restartItem = useCallback((item: AssistantHistoryItem) => {
    if (item.intent === 'UNKNOWN') {
      // item.label is the user's own original text for a message-endpoint
      // item — "start over" means re-sending it, the same way retry does.
      const action = createAssistantMessageAction({ text: item.label, conversationId: workspace.conversationId, workspaceId: workspace.workspaceId });
      void runMessageAction(action, item.label);
      return;
    }
    makeAction(item.intent, {}, item.label);
  }, [makeAction, runMessageAction, workspace]);

  const manualHrefFor = useCallback((item: AssistantHistoryItem) => (item.intent === 'UNKNOWN' ? undefined : writeCards.find((card) => card.id === item.intent)?.href), []);

  const confirmSale = useCallback(async (item: AssistantHistoryItem, args: { actionRunId: string; planFingerprint: string }) => {
    if (pending || messagePending || confirmingSale || item.intent !== 'REGISTER_SALE') return;
    setError(null);
    setMessageError(null);
    setConfirmingSale(true);
    setMessagePendingLabel('Confirmar venta');
    try {
      const result = await confirmAssistantActionRun(args);
      // In-flight: keep the original preview so the user retries the SAME actionRun.
      if (result.interactionState === 'EXECUTING') {
        setMessageError(result.message);
        return;
      }
      const response = confirmResultToAssistantResponse(result, {
        requestId: item.response.requestId,
        conversationId: item.response.conversationId || workspace.conversationId || '',
        workspaceId: item.response.workspaceId || workspace.workspaceId || '',
        traceId: item.response.traceId,
      });
      const id = crypto.randomUUID();
      setHistory((current) => [
        {
          id,
          label: 'Confirmar venta',
          intent: 'REGISTER_SALE',
          entities: item.entities,
          response,
        },
        ...current,
      ]);
      setHistoryTimestamps((current) => ({ ...current, [id]: Date.now() }));
      if (response.workspaceId) {
        void refreshWorkspaceVersion(response.workspaceId);
      }
    } catch (error) {
      if (error instanceof AssistantRequestError) {
        setMessageError(error.message);
      } else {
        setMessageError('No pude confirmar la venta. Reintenta la misma confirmación.');
      }
    } finally {
      setConfirmingSale(false);
      setMessagePendingLabel(null);
    }
  }, [pending, messagePending, confirmingSale, refreshWorkspaceVersion, workspace.conversationId, workspace.workspaceId]);

  const submitComposer = (event: FormEvent) => {
    event.preventDefault();
    const text = composerValue.trim();
    if (!text) return;
    const action = createAssistantMessageAction({ text, conversationId: workspace.conversationId, workspaceId: workspace.workspaceId });
    setComposerValue('');
    void runMessageAction(action, text);
  };

  // True while either the structured or the natural-language flow has a
  // request in flight — both share one thread and must not overlap.
  const busy = !!pending || !!messagePending || confirmingSale;
  const combinedPendingLabel = confirmingSale ? 'Confirmar venta' : (pendingLabel ?? messagePendingLabel);
  const combinedError = error ?? messageError;
  const combinedOnRetry = retryAction
    ? () => void runAction(retryAction, 'Reintentando la última solicitud.')
    : messageRetryAction
      ? () => void runMessageAction(messageRetryAction, messageRetryAction.request.text)
      : undefined;

  const brief = useMemo(() => [
    { label: 'Liquidez', value: 'Consultar', action: () => openRead('GET_LIQUIDITY') },
    { label: 'Inventario', value: 'Buscar', action: () => openRead('SEARCH_INVENTORY') },
    { label: 'Cuentas', value: 'Consultar', action: () => openRead('GET_CLIENT_ACCOUNTS') },
  ], [workspace, pending]); // Workspace changes create actions with the current server version.

  const activeReadForm = activeRead ? (
    <section className="rounded-2xl border border-emerald-300/20 bg-panel p-4" aria-label="Formulario de consulta">
      <form onSubmit={submitRead} className="space-y-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold">{readCards.find((item) => item.id === activeRead)?.label}</h2><button type="button" onClick={() => setActiveRead(null)} className="text-sm text-muted">Cerrar</button></div>
        {activeRead === 'GET_MONTHLY_PROFIT' ? (
          <div className="grid grid-cols-2 gap-3">
            <label><span className="ui-field-label">Mes</span><select className="ui-input" value={month} onChange={(event) => setMonth((value) => ({ ...value, month: Number(event.target.value) }))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
            <label><span className="ui-field-label">Año</span><input className="ui-input" type="number" min="2020" max="2100" value={year} onChange={(event) => setMonth((value) => ({ ...value, year: Number(event.target.value) }))} /></label>
          </div>
        ) : (
          <>
            <label><span className="ui-field-label">{activeRead === 'SEARCH_INVENTORY' ? 'Referencia, marca o modelo' : 'Nombre del cliente'}</span><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden /><input className="ui-input pl-9" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} required autoFocus /></div></label>
            <div className="grid grid-cols-2 gap-3">
              {activeRead === 'SEARCH_INVENTORY' ? <label><span className="ui-field-label">Estado</span><select className="ui-input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ACTIVE">Activo</option><option value="AVAILABLE">Disponible</option><option value="RESERVED">Reservado</option></select></label> : null}
              <label><span className="ui-field-label">Límite</span><select className="ui-input" value={limit} onChange={(event) => setLimit(Number(event.target.value))}><option value={5}>5</option><option value={10}>10</option><option value={20}>20</option></select></label>
            </div>
          </>
        )}
        <button type="submit" className="ui-btn-primary min-h-11 w-full" disabled={busy}>{pending ? 'Consultando…' : 'Consultar'}</button>
      </form>
    </section>
  ) : null;

  const emptyState = (
    <section aria-label="Sin actividad todavía" className="space-y-2 px-1">
      <p className="text-sm font-medium text-white/70">¿Qué necesitas hacer?</p>
      <div className="grid grid-cols-1 gap-1.5">
        {composerExamples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setComposerValue(example)}
            className="rounded-xl border border-white/10 bg-panel px-3.5 py-2.5 text-left text-sm text-white/70 transition hover:border-emerald-300/25 hover:text-white"
          >
            {example}
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <div className="mx-auto max-w-6xl pb-4">
      {/* ---------------------------------------------------------------- */}
      {/* Mobile / tablet home — the assistant IS the app below `lg`.       */}
      {/* ---------------------------------------------------------------- */}
      <div className="space-y-4 lg:hidden">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Buenos días, César.</h1>
              <p className="mt-0.5 text-sm text-white/55">¿Qué pasó en el negocio?</p>
            </div>
            <span className="shrink-0 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200">Solo lectura</span>
          </div>

          <ConversationComposer
            variant="hero"
            value={composerValue}
            onChange={setComposerValue}
            onSubmit={submitComposer}
            placeholder={composerExamples[placeholderIndex]}
            notice={null}
          />
        </section>

        <section aria-label="Sugerencias rápidas" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {readCards.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => openRead(id)}
              disabled={busy}
              className="shrink-0 rounded-full border border-white/10 bg-panel px-3.5 py-2 text-xs font-medium text-white/80 transition hover:border-emerald-300/25 hover:text-white disabled:opacity-50"
            >
              {mobileSuggestionLabels[id] ?? label}
            </button>
          ))}
        </section>

        {activeReadForm}

        <ConversationThread
          history={history}
          pending={busy}
          pendingLabel={combinedPendingLabel}
          error={combinedError}
          onRetry={combinedOnRetry}
          selectClient={selectClient}
          onContinue={continueItem}
          onRestart={restartItem}
          onSearchAgain={() => openRead('SEARCH_CLIENT')}
          onConfirmSale={confirmSale}
          manualHrefFor={manualHrefFor}
          timestamps={historyTimestamps}
          emptyState={emptyState}
        />

        <section aria-labelledby="mobile-write-actions-title" className="overflow-hidden rounded-2xl border border-amber-300/15 bg-amber-400/[0.035]">
          <button
            type="button"
            onClick={() => setWriteActionsOpen((value) => !value)}
            className="flex min-h-11 w-full items-center justify-between px-3.5 py-3"
            aria-expanded={writeActionsOpen}
            aria-controls="mobile-write-actions-panel"
          >
            <span id="mobile-write-actions-title" className="text-sm font-semibold text-white/85">Preparar acciones</span>
            <ChevronDown className={`h-4 w-4 text-amber-200/70 transition-transform ${writeActionsOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {writeActionsOpen ? (
            <div id="mobile-write-actions-panel" className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
              {writeCards.map(({ id, label, href, icon: Icon }) => (
                <div key={id} className="flex min-h-[52px] items-center justify-between gap-2 px-3.5">
                  <button type="button" disabled={busy} onClick={() => makeAction(id, {}, label)} className="flex min-h-[52px] flex-1 items-center gap-2.5 text-left text-sm font-medium text-white/85 disabled:opacity-50">
                    <Icon className="h-4 w-4 shrink-0 text-amber-200" aria-hidden />
                    {mobileWriteLabels[id] ?? label}
                  </button>
                  <Link href={href} className="shrink-0 text-white/40" aria-label={`Abrir flujo manual: ${label}`}>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ))}
              <p className="px-3.5 py-2.5 text-[11px] leading-4 text-white/40">Crea una vista previa. Nunca ejecuta cambios.</p>
            </div>
          ) : null}
        </section>

        <section aria-label="Resumen del negocio" className="grid grid-cols-3 gap-2">
          {brief.map((item) => (
            <button key={item.label} type="button" onClick={item.action} disabled={busy} className="min-h-[52px] rounded-xl border border-white/10 bg-panel/60 p-2.5 text-left transition hover:border-white/20 disabled:opacity-50">
              <span className="block text-[10px] uppercase tracking-wide text-white/40">{item.label}</span>
              <span className="mt-0.5 block text-xs font-medium text-white/80">{item.value}</span>
            </button>
          ))}
        </section>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Desktop — layout unchanged; response rendering is conversational. */}
      {/* ---------------------------------------------------------------- */}
      <div className="hidden space-y-5 lg:block">
        <section className="overflow-hidden rounded-3xl border border-emerald-300/15 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.15),transparent_42%),linear-gradient(145deg,#171717,#0f0f0f)] p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-300/80">Asistente WristOS</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Buenos días, César.</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-white/60">Consulta la operación con acciones estructuradas, seguras y deterministas.</p>
            </div>
            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">Solo lectura</div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            {brief.map((item) => (
              <button key={item.label} type="button" onClick={item.action} disabled={busy} className="min-h-20 rounded-2xl border border-white/10 bg-black/20 p-3 text-left transition hover:border-white/20 disabled:opacity-50">
                <span className="block text-[11px] uppercase tracking-wide text-white/45">{item.label}</span>
                <span className="mt-2 block text-sm font-medium text-white">{item.value}</span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="read-actions-title">
          <div className="mb-3 flex items-end justify-between">
            <div><h2 id="read-actions-title" className="text-lg font-semibold">Consultas rápidas</h2><p className="mt-1 text-sm text-muted">Cinco lecturas aprobadas, sin mutaciones.</p></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {readCards.map(({ id, label, detail, icon: Icon }) => (
              <button key={id} type="button" onClick={() => openRead(id)} disabled={busy} className="group min-h-28 rounded-2xl border border-white/10 bg-panel p-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-300/25 disabled:opacity-50">
                <div className="flex items-center justify-between"><Icon className="h-5 w-5 text-emerald-300" aria-hidden /><ArrowRight className="h-4 w-4 text-white/25 transition group-hover:text-white/70" aria-hidden /></div>
                <p className="mt-4 text-sm font-semibold">{label}</p><p className="mt-1 text-xs leading-5 text-muted">{detail}</p>
              </button>
            ))}
          </div>
        </section>

        {activeReadForm}

        {history.length || busy || combinedError ? (
          <section className="space-y-3" aria-labelledby="results-title">
            <div>
              <h2 id="results-title" className="text-lg font-semibold">Conversaciones</h2>
              <p className="mt-1 text-xs text-muted">Solo esta sesión. La conversación canónica permanece en el servidor.</p>
            </div>
            <ConversationThread
              history={history}
              pending={busy}
              pendingLabel={combinedPendingLabel}
              error={combinedError}
              onRetry={combinedOnRetry}
              selectClient={selectClient}
              onContinue={continueItem}
              onRestart={restartItem}
              onSearchAgain={() => openRead('SEARCH_CLIENT')}
              onConfirmSale={confirmSale}
              manualHrefFor={manualHrefFor}
              timestamps={historyTimestamps}
            />
          </section>
        ) : null}

        <section aria-labelledby="write-actions-title" className="rounded-3xl border border-amber-300/15 bg-amber-400/[0.035] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3"><div><h2 id="write-actions-title" className="text-lg font-semibold">Preparar una acción</h2><p className="mt-1 text-sm text-white/55">Crea una vista previa o pide aclaraciones. Nunca ejecuta cambios.</p></div><ChevronDown className="mt-1 h-5 w-5 text-amber-200/70" aria-hidden /></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {writeCards.map(({ id, label, href, icon: Icon }) => (
              <div key={id} className="rounded-xl border border-white/10 bg-black/15 p-3">
                <button type="button" disabled={busy} onClick={() => makeAction(id, {}, label)} className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-medium disabled:opacity-50"><Icon className="h-4 w-4 text-amber-200" aria-hidden />{label}</button>
                <Link href={href} className="mt-2 inline-flex min-h-10 items-center text-xs text-white/50 hover:text-white">Abrir flujo manual <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
              </div>
            ))}
          </div>
        </section>

        <ConversationComposer
          variant="bar"
          value={composerValue}
          onChange={setComposerValue}
          onSubmit={submitComposer}
          placeholder={composerExamples[placeholderIndex]}
          notice={null}
        />
      </div>
    </div>
  );
}
