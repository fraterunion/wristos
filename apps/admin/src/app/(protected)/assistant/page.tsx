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
  LoaderCircle,
  Mic,
  PackagePlus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  ShoppingCart,
  UserRoundSearch,
  WalletCards,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AssistantResponseRenderer } from '@/components/assistant/assistant-response-renderer';
import {
  AssistantRequestError,
  clearResumeHint,
  createAssistantAction,
  readResumeHint,
  resumeAssistantWorkspace,
  writeResumeHint,
  type AssistantAction,
} from '@/lib/assistant-api';
import type {
  AssistantHistoryItem,
  BusinessActionId,
  JsonValue,
  ReadAction,
  StructuredAssistantResponse,
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
  const [pending, setPending] = useState<AssistantAction | null>(null);
  const [retryAction, setRetryAction] = useState<AssistantAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composerNotice, setComposerNotice] = useState(false);
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
    if (pending) return;
    setPending(action);
    setRetryAction(null);
    setError(null);
    try {
      const response = await action.execute();
      setHistory((items) => [{ id: response.requestId, label, intent: action.request.intent, entities: action.request.entities, response }, ...items]);
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
          setHistory((items) => [{ id: caught.response!.requestId, label, intent: action.request.intent, entities: action.request.entities, response: caught.response! }, ...items]);
        }
      } else {
        setError('Se perdió la conexión. Puedes reintentar la misma solicitud de forma segura.');
      }
    } finally {
      setPending(null);
    }
  }, [pending, refreshWorkspaceVersion]);

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
      makeAction(action, {}, 'Liquidez');
      return;
    }
    setActiveRead(action);
    setQuery('');
  };

  const submitRead = (event: FormEvent) => {
    event.preventDefault();
    if (!activeRead) return;
    if (activeRead === 'GET_MONTHLY_PROFIT') {
      makeAction(activeRead, { year, month }, 'Utilidad mensual');
    } else if (activeRead === 'SEARCH_INVENTORY') {
      makeAction(activeRead, { query: query.trim(), status, limit }, 'Búsqueda de inventario', query.trim());
    } else {
      makeAction('SEARCH_CLIENT', { query: query.trim(), limit }, activeRead === 'GET_CLIENT_ACCOUNTS' ? 'Buscar cliente para cuentas' : 'Búsqueda de cliente', query.trim());
    }
    setActiveRead(null);
  };

  const selectClient = (id: string, label: string) => {
    makeAction('GET_CLIENT_ACCOUNTS', { clientId: id }, `Cuentas de ${label}`);
  };

  const brief = useMemo(() => [
    { label: 'Liquidez', value: 'Consultar', action: () => openRead('GET_LIQUIDITY') },
    { label: 'Inventario', value: 'Buscar', action: () => openRead('SEARCH_INVENTORY') },
    { label: 'Cuentas', value: 'Consultar', action: () => openRead('GET_CLIENT_ACCOUNTS') },
  ], [workspace, pending]); // Workspace changes create actions with the current server version.

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-4">
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
            <button key={item.label} type="button" onClick={item.action} disabled={!!pending} className="min-h-20 rounded-2xl border border-white/10 bg-black/20 p-3 text-left transition hover:border-white/20 disabled:opacity-50">
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
            <button key={id} type="button" onClick={() => openRead(id)} disabled={!!pending} className="group min-h-28 rounded-2xl border border-white/10 bg-panel p-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-300/25 disabled:opacity-50">
              <div className="flex items-center justify-between"><Icon className="h-5 w-5 text-emerald-300" aria-hidden /><ArrowRight className="h-4 w-4 text-white/25 transition group-hover:text-white/70" aria-hidden /></div>
              <p className="mt-4 text-sm font-semibold">{label}</p><p className="mt-1 text-xs leading-5 text-muted">{detail}</p>
            </button>
          ))}
        </div>
      </section>

      {activeRead ? (
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
            <button type="submit" className="ui-btn-primary min-h-11 w-full" disabled={!!pending}>{pending ? 'Consultando…' : 'Consultar'}</button>
          </form>
        </section>
      ) : null}

      {pending ? <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-panel p-5 text-sm text-muted" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />Consultando datos autorizados…</div> : null}
      {error ? <div className="rounded-2xl border border-rose-400/25 bg-rose-500/[0.07] p-4"><p className="text-sm text-rose-100">{error}</p>{retryAction ? <button type="button" className="ui-btn-secondary mt-3 min-h-11 gap-2" onClick={() => void runAction(retryAction, 'Reintento seguro')}><RefreshCw className="h-4 w-4" />Reintentar la misma solicitud</button> : null}</div> : null}

      {history.length ? <section className="space-y-3" aria-labelledby="results-title"><div><h2 id="results-title" className="text-lg font-semibold">Actividad reciente</h2><p className="mt-1 text-xs text-muted">Solo esta sesión. La conversación canónica permanece en el servidor.</p></div>{history.map((item) => <div key={item.id}><p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">{item.label}</p><AssistantResponseRenderer response={item.response} onSelectClient={selectClient} onContinue={(entities) => makeAction(item.intent, { ...item.entities, ...entities }, item.label)} /></div>)}</section> : null}

      <section aria-labelledby="write-actions-title" className="rounded-3xl border border-amber-300/15 bg-amber-400/[0.035] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3"><div><h2 id="write-actions-title" className="text-lg font-semibold">Preparar una acción</h2><p className="mt-1 text-sm text-white/55">Crea una vista previa o pide aclaraciones. Nunca ejecuta cambios.</p></div><ChevronDown className="mt-1 h-5 w-5 text-amber-200/70" aria-hidden /></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {writeCards.map(({ id, label, href, icon: Icon }) => (
            <div key={id} className="rounded-xl border border-white/10 bg-black/15 p-3">
              <button type="button" disabled={!!pending} onClick={() => makeAction(id, {}, label)} className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-medium disabled:opacity-50"><Icon className="h-4 w-4 text-amber-200" aria-hidden />{label}</button>
              <Link href={href} className="mt-2 inline-flex min-h-10 items-center text-xs text-white/50 hover:text-white">Abrir flujo manual <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
            </div>
          ))}
        </div>
      </section>

      <section className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 rounded-2xl border border-white/15 bg-panel/95 p-3 shadow-2xl shadow-black/40 backdrop-blur lg:bottom-3" aria-label="Compositor del asistente">
        <form onSubmit={(event) => { event.preventDefault(); setComposerNotice(true); }} className="flex items-center gap-2">
          <input className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-white/35" placeholder="Escribe una solicitud…" aria-label="Solicitud en lenguaje natural, próximamente" />
          <button type="button" disabled className="rounded-xl p-3 text-white/20" aria-label="Micrófono no disponible" title="Próximamente"><Mic className="h-5 w-5" /></button>
          <button type="submit" className="rounded-xl bg-white p-3 text-black" aria-label="Enviar"><Send className="h-5 w-5" /></button>
        </form>
        {composerNotice ? <p className="mt-2 px-2 text-xs text-amber-200">La entrada libre estará disponible más adelante. Usa una acción estructurada.</p> : null}
      </section>
    </div>
  );
}
