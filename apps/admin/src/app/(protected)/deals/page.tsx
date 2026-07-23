'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DeleteConfirmDialog } from '@/components/inventory/DeleteConfirmDialog';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type {
  Client,
  Deal,
  DealStage,
  Payment,
  PaymentMethod,
  PaymentStatus,
  PaymentSummary,
  Watch,
} from '@/types/domain';

const DEAL_STAGE_VALUES = [
  'LEAD',
  'INTERESTED',
  'NEGOTIATING',
  'PENDING_PAYMENT',
  'CLOSED_WON',
  'CLOSED_LOST',
 ] as const;
const dealStages: DealStage[] = [...DEAL_STAGE_VALUES];

const PAYMENT_METHOD_VALUES = ['TRANSFER', 'CASH', 'CARD', 'OTHER'] as const;
const paymentMethods: PaymentMethod[] = [...PAYMENT_METHOD_VALUES];
const PAYMENT_STATUS_VALUES = ['PENDING', 'PAID', 'OVERDUE'] as const;
const paymentStatuses: PaymentStatus[] = [...PAYMENT_STATUS_VALUES];

const createDealSchema = z.object({
  clientId: z.string().min(1, 'El cliente es obligatorio'),
  watchId: z.string().min(1, 'El reloj es obligatorio'),
  stage: z.enum(DEAL_STAGE_VALUES),
  expectedCloseAt: z.string().optional(),
  agreedPrice: z.coerce.number().min(0, 'El precio acordado debe ser mayor o igual a 0'),
  notes: z.string().optional(),
});

const editDealSchema = z.object({
  expectedCloseAt: z.string().optional(),
  agreedPrice: z.coerce.number().min(0, 'El precio acordado debe ser mayor o igual a 0'),
  notes: z.string().optional(),
});

const paymentSchema = z.object({
  amount: z.coerce.number().min(0, 'El monto debe ser mayor o igual a 0'),
  method: z.enum(PAYMENT_METHOD_VALUES),
  status: z.enum(PAYMENT_STATUS_VALUES),
  dueDate: z.string().optional(),
  paidAt: z.string().optional(),
  notes: z.string().optional(),
});

type CreateDealValues = z.infer<typeof createDealSchema>;
type EditDealValues = z.infer<typeof editDealSchema>;
type PaymentValues = z.infer<typeof paymentSchema>;

type DeleteTarget =
  | { kind: 'deal'; id: string; label: string }
  | { kind: 'payment'; id: string; label: string }
  | null;

function currency(value: string | number) {
  const n = typeof value === 'number' ? value : Number(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  LEAD: 'Prospecto',
  INTERESTED: 'Interesado',
  NEGOTIATING: 'Negociando',
  PENDING_PAYMENT: 'Pago pendiente',
  CLOSED_WON: 'Cerrado ganado',
  CLOSED_LOST: 'Cerrado perdido',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  WIRE: 'Transferencia',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  CRYPTO: 'Cripto',
  CHECK: 'Cheque',
  OTHER: 'Otro',
  BANCOS: 'Bancos',
  CESAR: 'César',
};

function readableStage(stage: DealStage) {
  return DEAL_STAGE_LABELS[stage] ?? stage.replaceAll('_', ' ');
}

function dealStageTone(stage: DealStage) {
  if (stage === 'CLOSED_WON') return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200';
  if (stage === 'CLOSED_LOST') return 'border-rose-500/40 bg-rose-500/15 text-rose-200';
  if (stage === 'PENDING_PAYMENT') return 'border-amber-500/40 bg-amber-500/15 text-amber-200';
  return 'border-white/15 bg-white/5 text-white/80';
}

function paymentStatusTone(status: PaymentStatus) {
  if (status === 'PAID') return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200';
  if (status === 'OVERDUE') return 'border-rose-500/40 bg-rose-500/15 text-rose-200';
  return 'border-amber-500/40 bg-amber-500/15 text-amber-200';
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(date);
}

function toDatetimeLocalValue(iso?: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);

  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const createDealForm = useForm<CreateDealValues>({
    resolver: zodResolver(createDealSchema),
    defaultValues: {
      clientId: '',
      watchId: '',
      stage: 'LEAD',
      expectedCloseAt: '',
      agreedPrice: 0,
      notes: '',
    },
  });

  const editDealForm = useForm<EditDealValues>({
    resolver: zodResolver(editDealSchema),
    defaultValues: {
      expectedCloseAt: '',
      agreedPrice: 0,
      notes: '',
    },
  });

  const paymentForm = useForm<PaymentValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      amount: 0,
      method: 'TRANSFER',
      status: 'PENDING',
      dueDate: '',
      paidAt: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    if (!detailModalOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailModalOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [detailModalOpen]);

  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );
  const watchesById = useMemo(
    () => new Map(watches.map((watch) => [watch.id, watch])),
    [watches],
  );

  const groupedDeals = useMemo(() => {
    const groups = Object.fromEntries(dealStages.map((stage) => [stage, [] as Deal[]])) as Record<
      DealStage,
      Deal[]
    >;
    deals.forEach((deal) => {
      groups[deal.stage].push(deal);
    });
    return groups;
  }, [deals]);

  const loadDealsPageData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dealsData, clientsData, watchesData] = await Promise.all([
        apiGet<Deal[]>('/deals', { authenticated: true }),
        apiGet<Client[]>('/crm/clients', { authenticated: true }),
        apiGet<Watch[]>('/inventory', { authenticated: true }),
      ]);
      void queryKeys.deals.list();
      setDeals(dealsData);
      setClients(clientsData);
      setWatches(watchesData);
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError ? caughtError.message : 'No se pudieron cargar las oportunidades.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSelectedDealData = useCallback(async (dealId: string) => {
    setDetailsLoading(true);
    setDetailError(null);
    try {
      const [dealData, summaryData, paymentsData] = await Promise.all([
        apiGet<Deal>(`/deals/${dealId}`, { authenticated: true }),
        apiGet<PaymentSummary>(`/deals/${dealId}/payment-summary`, { authenticated: true }),
        apiGet<Payment[]>('/payments', { authenticated: true, query: { dealId } }),
      ]);
      void queryKeys.deals.detail(dealId);
      void queryKeys.deals.paymentSummary(dealId);
      void queryKeys.deals.payments(dealId);
      setSelectedDeal(dealData);
      setPaymentSummary(summaryData);
      setPayments(paymentsData);
      editDealForm.reset({
        expectedCloseAt: toDatetimeLocalValue(dealData.expectedCloseAt),
        agreedPrice: Number(dealData.agreedPrice),
        notes: dealData.notes ?? '',
      });
      paymentForm.reset({
        amount: 0,
        method: 'TRANSFER',
        status: 'PENDING',
        dueDate: '',
        paidAt: '',
        notes: '',
      });
    } catch (caughtError) {
      setDetailError(
        caughtError instanceof ApiError
          ? caughtError.message
          : 'No se pudieron cargar los detalles de la oportunidad.',
      );
    } finally {
      setDetailsLoading(false);
    }
  }, [editDealForm, paymentForm]);

  useEffect(() => {
    void loadDealsPageData();
  }, [loadDealsPageData]);

  useEffect(() => {
    if (!selectedDealId) {
      setSelectedDeal(null);
      setPaymentSummary(null);
      setPayments([]);
      return;
    }
    void loadSelectedDealData(selectedDealId);
  }, [selectedDealId, loadSelectedDealData]);

  const createDeal = createDealForm.handleSubmit(async (values) => {
    try {
      const payload = {
        clientId: values.clientId,
        watchId: values.watchId,
        stage: values.stage,
        agreedPrice: values.agreedPrice,
        expectedCloseAt: values.expectedCloseAt
          ? new Date(values.expectedCloseAt).toISOString()
          : undefined,
        notes: values.notes?.trim() || undefined,
      };
      const created = await apiPost<Deal>('/deals', payload, { authenticated: true });
      setCreateOpen(false);
      setFlash({ type: 'success', message: 'Oportunidad creada correctamente.' });
      await loadDealsPageData();
      setSelectedDealId(created.id);
    } catch (caughtError) {
      setFlash({
        type: 'error',
        message: caughtError instanceof ApiError ? caughtError.message : 'No se pudo crear la oportunidad.',
      });
    }
  });

  const updateDeal = editDealForm.handleSubmit(async (values) => {
    if (!selectedDealId) return;
    try {
      await apiPatch<Deal>(
        `/deals/${selectedDealId}`,
        {
          expectedCloseAt: values.expectedCloseAt
            ? new Date(values.expectedCloseAt).toISOString()
            : null,
          agreedPrice: values.agreedPrice,
          notes: values.notes?.trim() || null,
        },
        { authenticated: true },
      );
      setEditOpen(false);
      setFlash({ type: 'success', message: 'Oportunidad actualizada correctamente.' });
      await loadDealsPageData();
      await loadSelectedDealData(selectedDealId);
    } catch (caughtError) {
      setFlash({
        type: 'error',
        message: caughtError instanceof ApiError ? caughtError.message : 'Error al actualizar la oportunidad.',
      });
    }
  });

  const updateDealStage = async (stage: DealStage) => {
    if (!selectedDealId) return;
    try {
      await apiPatch<Deal>(`/deals/${selectedDealId}/stage`, { stage }, { authenticated: true });
      setFlash({ type: 'success', message: `Etapa actualizada a ${readableStage(stage)}.` });
      await loadDealsPageData();
      await loadSelectedDealData(selectedDealId);
    } catch (caughtError) {
      setFlash({
        type: 'error',
        message:
          caughtError instanceof ApiError ? caughtError.message : 'No se pudo actualizar la etapa.',
      });
    }
  };

  const createPayment = paymentForm.handleSubmit(async (values) => {
    if (!selectedDealId) return;
    try {
      await apiPost<Payment>(
        '/payments',
        {
          dealId: selectedDealId,
          amount: values.amount,
          method: values.method,
          status: values.status,
          dueDate: values.dueDate ? new Date(values.dueDate).toISOString() : undefined,
          paidAt: values.paidAt ? new Date(values.paidAt).toISOString() : undefined,
          notes: values.notes?.trim() || undefined,
        },
        { authenticated: true },
      );
      setFlash({ type: 'success', message: 'Pago creado.' });
      await loadSelectedDealData(selectedDealId);
    } catch (caughtError) {
      setFlash({
        type: 'error',
        message:
          caughtError instanceof ApiError ? caughtError.message : 'No se pudo crear el pago.',
      });
    }
  });

  const markPaymentPaid = async (paymentId: string) => {
    if (!selectedDealId) return;
    try {
      await apiPatch<Payment>(
        `/payments/${paymentId}/mark-paid`,
        { paidAt: new Date().toISOString() },
        { authenticated: true },
      );
      setFlash({ type: 'success', message: 'Pago marcado como pagado.' });
      await loadSelectedDealData(selectedDealId);
    } catch (caughtError) {
      setFlash({
        type: 'error',
        message:
          caughtError instanceof ApiError ? caughtError.message : 'No se pudo marcar el pago.',
      });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      if (deleteTarget.kind === 'deal') {
        await apiDelete(`/deals/${deleteTarget.id}`, { authenticated: true });
        setFlash({ type: 'success', message: 'Oportunidad eliminada.' });
        setDetailModalOpen(false);
        setSelectedDealId(null);
        await loadDealsPageData();
      } else {
        await apiDelete(`/payments/${deleteTarget.id}`, { authenticated: true });
        setFlash({ type: 'success', message: 'Pago eliminado.' });
        if (selectedDealId) {
          await loadSelectedDealData(selectedDealId);
        }
      }
      setDeleteTarget(null);
    } catch (caughtError) {
      setFlash({
        type: 'error',
        message: caughtError instanceof ApiError ? caughtError.message : 'Error al eliminar.',
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Oportunidades</h1>
          <p className="ui-subtitle">
            Administra tu pipeline de ventas, movimiento de etapas y seguimiento de pagos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="ui-btn-primary px-4 py-2"
        >
          Crear oportunidad
        </button>
      </header>

      {flash ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            flash.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-100'
          }`}
        >
          {flash.message}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-12 rounded-xl bg-white/10" />
          <div className="h-72 rounded-xl bg-white/10" />
        </div>
      ) : error ? (
        <section className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-5">
          <p className="text-sm text-rose-100">{error}</p>
          <button type="button" onClick={() => void loadDealsPageData()} className="mt-3 underline">
            Retry
          </button>
        </section>
      ) : deals.length === 0 ? (
        <section className="rounded-xl border border-dashed border-white/15 bg-panel/60 p-12 text-center">
          <h2 className="text-lg font-semibold">Aún no hay oportunidades</h2>
          <p className="mt-2 text-sm text-muted">
            Crea tu primera oportunidad para comenzar a rastrear tu pipeline de ventas.
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="ui-btn-primary mt-5 px-4 py-2"
          >
            Crear primera oportunidad
          </button>
        </section>
      ) : (
        <div className="ui-card overflow-x-auto p-3 sm:p-4">
          <div className="grid min-w-[980px] grid-cols-6 gap-3">
            {dealStages.map((stage) => (
              <div key={stage} className="space-y-2 rounded-xl border border-white/10 bg-surface/40 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {readableStage(stage)}
                  </h3>
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-muted">
                    {groupedDeals[stage].length}
                  </span>
                </div>
                <div className="space-y-2">
                  {groupedDeals[stage].map((deal) => {
                    const client = clientsById.get(deal.clientId);
                    const watch = deal.watchId ? watchesById.get(deal.watchId) : undefined;
                    const active = detailModalOpen && deal.id === selectedDealId;
                    return (
                      <button
                        type="button"
                        key={deal.id}
                        onClick={() => {
                          setSelectedDealId(deal.id);
                          setDetailModalOpen(true);
                        }}
                        className={`w-full rounded-lg border p-3 text-left transition ${
                          active
                            ? 'border-accent/45 bg-accent/10'
                            : 'border-white/10 bg-panel hover:border-white/25'
                        }`}
                      >
                        <p className="text-sm font-semibold">{client?.name ?? 'Cliente desconocido'}</p>
                        <p className="mt-1 text-xs text-muted">
                          {watch
                            ? `${watch.brand} ${watch.model}`
                            : !deal.watchId
                              ? 'Venta histórica'
                              : 'Reloj desconocido'}
                        </p>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span className="font-medium text-white">{currency(deal.agreedPrice)}</span>
                          <span className="text-muted">{formatDate(deal.expectedCloseAt)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {detailModalOpen && selectedDealId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setDetailModalOpen(false)}
        >
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
          <div
            className="relative z-10 flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Fixed header */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-6 py-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">Detalles de la oportunidad</h2>
                {selectedDeal ? (
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {clientsById.get(selectedDeal.clientId)?.name ?? 'Cliente desconocido'}
                    {' · '}
                    {(() => {
                      const w = selectedDeal.watchId
                        ? watchesById.get(selectedDeal.watchId)
                        : undefined;
                      return w
                        ? `${w.brand} ${w.model}`
                        : !selectedDeal.watchId
                          ? 'Venta histórica'
                          : 'Reloj desconocido';
                    })()}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selectedDeal ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditOpen(true)}
                      className="ui-btn-secondary px-3 py-1.5 text-xs"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDeleteTarget({
                          kind: 'deal',
                          id: selectedDeal.id,
                          label: clientsById.get(selectedDeal.clientId)?.name ?? 'Deal',
                        })
                      }
                      className="ui-btn-danger px-3 py-1.5 text-xs"
                    >
                      Eliminar
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => setDetailModalOpen(false)}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-white/10 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {detailsLoading ? (
                <div className="space-y-3 animate-pulse">
                  <div className="h-8 rounded bg-white/10" />
                  <div className="h-28 rounded bg-white/10" />
                  <div className="h-28 rounded bg-white/10" />
                  <div className="h-40 rounded bg-white/10" />
                </div>
              ) : detailError ? (
                <p className="text-sm text-rose-200">{detailError}</p>
              ) : selectedDeal ? (
                <div className="space-y-5">
                  {/* Stage + meta */}
                  <section className="space-y-3 rounded-xl border border-white/10 bg-surface/40 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Etapa</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <select
                        value={selectedDeal.stage}
                        onChange={(e) => void updateDealStage(e.target.value as DealStage)}
                        className="ui-input w-auto min-w-44"
                      >
                        {dealStages.map((stage) => (
                          <option key={stage} value={stage}>
                            {readableStage(stage)}
                          </option>
                        ))}
                      </select>
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide ${dealStageTone(selectedDeal.stage)}`}
                      >
                        {readableStage(selectedDeal.stage)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-muted">Cierre esperado</p>
                        <p className="mt-0.5 font-medium">{formatDate(selectedDeal.expectedCloseAt)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Precio acordado</p>
                        <p className="mt-0.5 font-medium">{currency(selectedDeal.agreedPrice)}</p>
                      </div>
                    </div>
                    {selectedDeal.notes?.trim() ? (
                      <p className="text-sm text-muted">{selectedDeal.notes}</p>
                    ) : (
                      <p className="text-xs text-white/25">Sin notas.</p>
                    )}
                  </section>

                  {/* Payment summary */}
                  <section className="space-y-3 rounded-xl border border-white/10 bg-surface/40 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Resumen de pagos</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border border-white/10 p-3">
                        <p className="text-xs text-muted">Acordado</p>
                        <p className="mt-1 text-base font-semibold">
                          {currency(paymentSummary?.totalAgreedPrice ?? selectedDeal.agreedPrice)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/10 p-3">
                        <p className="text-xs text-muted">Pagado</p>
                        <p className="mt-1 text-base font-semibold text-emerald-300">
                          {currency(paymentSummary?.totalPaid ?? 0)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/10 p-3">
                        <p className="text-xs text-muted">Pendiente</p>
                        <p className="mt-1 text-base font-semibold text-amber-300">
                          {currency(paymentSummary?.pendingBalance ?? 0)}
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* Add payment */}
                  <section className="space-y-3 rounded-xl border border-white/10 bg-surface/40 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Agregar pago</p>
                    <form onSubmit={createPayment} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          {...paymentForm.register('amount', { valueAsNumber: true })}
                          placeholder="Monto"
                          className="ui-input"
                        />
                        <select {...paymentForm.register('method')} className="ui-input">
                          {paymentMethods.map((m) => (
                            <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m] ?? m}</option>
                          ))}
                        </select>
                        <select {...paymentForm.register('status')} className="ui-input">
                          {paymentStatuses.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-muted">Fecha de vencimiento</label>
                          <input
                            type="datetime-local"
                            {...paymentForm.register('dueDate')}
                            className="ui-input"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-muted">Pagado el</label>
                          <input
                            type="datetime-local"
                            {...paymentForm.register('paidAt')}
                            className="ui-input"
                          />
                        </div>
                      </div>
                      <textarea
                        rows={2}
                        {...paymentForm.register('notes')}
                        placeholder="Notas del pago"
                        className="ui-input"
                      />
                      {paymentForm.formState.errors.amount ? (
                        <p className="text-xs text-rose-300">
                          {paymentForm.formState.errors.amount.message}
                        </p>
                      ) : null}
                      <button type="submit" className="ui-btn-secondary px-3 py-2 text-sm">
                        Crear pago
                      </button>
                    </form>
                  </section>

                  {/* Payments list */}
                  <section className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Pagos</p>
                    {payments.length === 0 ? (
                      <p className="text-sm text-muted">Aún no hay pagos.</p>
                    ) : (
                      payments.map((payment) => (
                        <div
                          key={payment.id}
                          className="rounded-xl border border-white/10 bg-surface/40 p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold">{currency(payment.amount)}</p>
                            <span className="text-xs text-muted">{PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}</span>
                          </div>
                          <p className="mt-1 text-xs text-muted">
                            <span
                              className={`mr-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${paymentStatusTone(payment.status)}`}
                            >
                              {payment.status}
                            </span>
                            Due {formatDate(payment.dueDate)} · Paid {formatDate(payment.paidAt)}
                          </p>
                          {payment.notes ? (
                            <p className="mt-1 text-xs text-muted">{payment.notes}</p>
                          ) : null}
                          <div className="mt-2 flex gap-2">
                            {payment.status !== 'PAID' ? (
                              <button
                                type="button"
                                onClick={() => void markPaymentPaid(payment.id)}
                                className="ui-btn-secondary border-emerald-400/40 px-2 py-1 text-xs text-emerald-200"
                              >
                                Marcar pagado
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({
                                  kind: 'payment',
                                  id: payment.id,
                                  label: `payment ${currency(payment.amount)}`,
                                })
                              }
                              className="ui-btn-danger px-2 py-1 text-xs"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </section>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
          <button
            type="button"
            onClick={() => setCreateOpen(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close create deal modal"
          />
          <form
            onSubmit={createDeal}
            className="relative max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl border border-white/10 bg-panel/95 p-4 shadow-2xl backdrop-blur sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Crear oportunidad</h2>
                <p className="mt-1 text-sm text-muted">Agrega una nueva oportunidad de venta al pipeline.</p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded p-1 text-muted hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <select
                {...createDealForm.register('clientId')}
                className="ui-input"
              >
                <option value="">Seleccionar cliente</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              <select
                {...createDealForm.register('watchId')}
                className="ui-input"
              >
                <option value="">Seleccionar reloj</option>
                {watches.map((watch) => (
                  <option key={watch.id} value={watch.id}>
                    {watch.brand} {watch.model}
                  </option>
                ))}
              </select>
              <select
                {...createDealForm.register('stage')}
                className="ui-input"
              >
                {dealStages.map((stage) => (
                  <option key={stage} value={stage}>
                    {readableStage(stage)}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                {...createDealForm.register('expectedCloseAt')}
                className="ui-input"
              />
              <input
                type="number"
                step="0.01"
                min={0}
                {...createDealForm.register('agreedPrice', { valueAsNumber: true })}
                placeholder="Precio acordado"
                className="ui-input sm:col-span-2"
              />
              <textarea
                rows={3}
                {...createDealForm.register('notes')}
                placeholder="Notas de la oportunidad"
                className="ui-input sm:col-span-2"
              />
            </div>
            {(createDealForm.formState.errors.clientId ||
              createDealForm.formState.errors.watchId ||
              createDealForm.formState.errors.agreedPrice) ? (
              <p className="text-xs text-rose-300">
                {createDealForm.formState.errors.clientId?.message ||
                  createDealForm.formState.errors.watchId?.message ||
                  createDealForm.formState.errors.agreedPrice?.message}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="ui-btn-ghost px-3 py-2"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="ui-btn-primary px-4 py-2"
              >
                Crear oportunidad
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editOpen && selectedDeal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
          <button
            type="button"
            onClick={() => setEditOpen(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close edit deal modal"
          />
          <form
            onSubmit={updateDeal}
            className="relative max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-white/10 bg-panel/95 p-4 shadow-2xl backdrop-blur sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Editar oportunidad</h2>
                <p className="mt-1 text-sm text-muted">Actualiza la fecha de cierre, valor y notas.</p>
              </div>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded p-1 text-muted hover:bg-white/10"
              >
                ✕
              </button>
            </div>
            <input
              type="datetime-local"
              {...editDealForm.register('expectedCloseAt')}
              className="ui-input"
            />
            <input
              type="number"
              step="0.01"
              min={0}
              {...editDealForm.register('agreedPrice', { valueAsNumber: true })}
              className="ui-input"
            />
            <textarea
              rows={3}
              {...editDealForm.register('notes')}
              className="ui-input"
            />
            {editDealForm.formState.errors.agreedPrice ? (
              <p className="text-xs text-rose-300">{editDealForm.formState.errors.agreedPrice.message}</p>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="ui-btn-ghost px-3 py-2"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="ui-btn-primary px-4 py-2"
              >
                Guardar cambios
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.kind === 'payment' ? '¿Eliminar pago?' : '¿Eliminar oportunidad?'}
        description={
          deleteTarget
            ? `Esto eliminará permanentemente este registro.`
            : ''
        }
        loading={deleteLoading}
        onCancel={() => !deleteLoading && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
