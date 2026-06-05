'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { DeleteConfirmDialog } from '@/components/inventory/DeleteConfirmDialog';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api-client';
import { listAccountEntries } from '@/lib/cuentas-api';
import { queryKeys } from '@/lib/query-keys';
import type { Client, ClientInteraction, ClientPreference, Deal, DealStage, Watch } from '@/types/domain';

const interactionTypes = ['CALL', 'MESSAGE', 'MEETING', 'NOTE'] as const;

const INTERACTION_TYPE_LABELS: Record<typeof interactionTypes[number], string> = {
  CALL: 'Llamada',
  MESSAGE: 'Mensaje',
  MEETING: 'Reunión',
  NOTE: 'Nota',
};

const clientSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio'),
  email: z.string().trim().optional().refine((value) => !value || z.string().email().safeParse(value).success, {
    message: 'Ingresa un email válido',
  }),
  phone: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^[0-9+()\-\s]{7,20}$/.test(value), {
      message: 'Ingresa un teléfono válido',
    }),
  notes: z.string().optional(),
  tagsInput: z.string().optional(),
  budgetRange: z.string().optional(),
});

const interactionSchema = z.object({
  type: z.enum(interactionTypes),
  notes: z.string().trim().min(1, 'Las notas son obligatorias'),
  occurredAt: z.string().min(1, 'La fecha y hora son obligatorias'),
});

const preferenceSchema = z
  .object({
    preferredBrandsInput: z.string().optional(),
    preferredModelsInput: z.string().optional(),
    budgetMin: z.string().optional(),
    budgetMax: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const min = value.budgetMin?.trim();
    const max = value.budgetMax?.trim();
    if (min && Number.isNaN(Number(min))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El mínimo debe ser numérico', path: ['budgetMin'] });
    }
    if (max && Number.isNaN(Number(max))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El máximo debe ser numérico', path: ['budgetMax'] });
    }
    if (min && max && Number(min) > Number(max)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El mínimo debe ser menor o igual al máximo', path: ['budgetMax'] });
    }
  });

type ClientFormValues = z.infer<typeof clientSchema>;
type InteractionFormValues = z.infer<typeof interactionSchema>;
type PreferenceFormValues = z.infer<typeof preferenceSchema>;

type ClientFilters = { name: string; phone: string; tag: string };

const EMPTY_FILTERS: ClientFilters = { name: '', phone: '', tag: '' };

function sortClientsByName(clients: Client[]) {
  return [...clients].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

function filterClients(clients: Client[], filters: ClientFilters) {
  const nameQuery = filters.name.trim().toLowerCase();
  const phoneQuery = filters.phone.trim();
  const tagQuery = filters.tag.trim().toLowerCase();

  return sortClientsByName(clients).filter((client) => {
    if (nameQuery && !client.name.toLowerCase().includes(nameQuery)) return false;
    if (phoneQuery && !(client.phone ?? '').includes(phoneQuery)) return false;
    if (tagQuery && !(client.tags ?? []).some((tag) => tag.toLowerCase().includes(tagQuery))) {
      return false;
    }
    return true;
  });
}

function hasActiveFilters(filters: ClientFilters) {
  return Boolean(filters.name.trim() || filters.phone.trim() || filters.tag.trim());
}

function parseList(input?: string) {
  if (!input) return [];
  return input
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function toDatetimeLocalValue(iso: string) {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function fmtMxn(value: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtDateShort(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

const OPEN_DEAL_STAGES: DealStage[] = ['LEAD', 'INTERESTED', 'NEGOTIATING', 'PENDING_PAYMENT'];

const DEAL_STAGE_PROBABILITY: Record<DealStage, number> = {
  LEAD: 20,
  INTERESTED: 40,
  NEGOTIATING: 60,
  PENDING_PAYMENT: 80,
  CLOSED_WON: 100,
  CLOSED_LOST: 0,
};

const DEAL_STAGE_NEXT_STEP: Record<DealStage, string> = {
  LEAD: 'Calificar interés',
  INTERESTED: 'Agendar seguimiento',
  NEGOTIATING: 'Definir términos',
  PENDING_PAYMENT: 'Enviar cotización',
  CLOSED_WON: 'Entrega completada',
  CLOSED_LOST: 'Archivada',
};

function watchTitle(watch: Watch | undefined) {
  if (!watch) return 'Reloj sin identificar';
  return `${watch.brand} ${watch.model}`.trim();
}

function formatRelativeDays(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Hace 1 día';
  return `Hace ${days} días`;
}

function OpportunityCard({
  deal,
  watch,
}: {
  deal: Deal;
  watch: Watch | undefined;
}) {
  const probability = DEAL_STAGE_PROBABILITY[deal.stage];
  const nextStep = deal.notes?.trim() || DEAL_STAGE_NEXT_STEP[deal.stage];

  return (
    <article className="rounded-xl border border-white/[0.08] bg-surface/40 p-4">
      <h4 className="text-base font-semibold tracking-tight text-white">{watchTitle(watch)}</h4>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-white/40">Probabilidad:</dt>
          <dd className="font-medium tabular-nums text-white">{probability}%</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-white/40">Valor estimado:</dt>
          <dd className="font-medium tabular-nums text-white">{fmtMxn(Number(deal.agreedPrice))}</dd>
        </div>
        <div>
          <dt className="text-white/40">Próximo paso:</dt>
          <dd className="mt-0.5 font-medium text-white/85">{nextStep}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-white/40">Fecha objetivo:</dt>
          <dd className="font-medium tabular-nums text-white/85">
            {deal.expectedCloseAt ? fmtDateShort(deal.expectedCloseAt) : 'Sin fecha'}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-white/40">Status:</dt>
          <dd className="font-medium text-emerald-400/90">Activa</dd>
        </div>
      </dl>
    </article>
  );
}

const OPEN_ACCOUNT_STATUSES = new Set(['OPEN', 'PARTIAL', 'OVERDUE']);

function ClientAccountsSummary({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(true);
  const [porCobrar, setPorCobrar] = useState(0);
  const [porPagar, setPorPagar] = useState(0);
  const [openCount, setOpenCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listAccountEntries({ clientId })
      .then((entries) => {
        if (cancelled) return;
        setPorCobrar(
          entries
            .filter((entry) => entry.type === 'RECEIVABLE')
            .reduce((sum, entry) => sum + Number(entry.balance), 0),
        );
        setPorPagar(
          entries
            .filter((entry) => entry.type === 'PAYABLE')
            .reduce((sum, entry) => sum + Number(entry.balance), 0),
        );
        setOpenCount(entries.filter((entry) => OPEN_ACCOUNT_STATUSES.has(entry.status)).length);
      })
      .catch(() => {
        if (!cancelled) {
          setPorCobrar(0);
          setPorPagar(0);
          setOpenCount(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <section className="rounded-xl border border-white/[0.08] bg-surface/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Resumen financiero
        </h3>
        <Link
          href={`/cuentas?clientId=${clientId}`}
          className="text-xs font-medium text-emerald-400 underline-offset-4 transition hover:text-white hover:underline"
        >
          Ver cuentas →
        </Link>
      </div>
      {loading ? (
        <div className="mt-4 h-16 animate-pulse rounded-lg bg-white/10" />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
              Por cobrar
            </p>
            <p
              className={`mt-1 text-lg font-semibold tabular-nums ${
                porCobrar > 0 ? 'text-emerald-400' : 'text-white/50'
              }`}
            >
              {fmtMxn(porCobrar)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
              Por pagar
            </p>
            <p
              className={`mt-1 text-lg font-semibold tabular-nums ${
                porPagar > 0 ? 'text-amber-400' : 'text-white/50'
              }`}
            >
              {fmtMxn(porPagar)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
              Cuentas abiertas
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-white">{openCount}</p>
          </div>
        </div>
      )}
    </section>
  );
}

export default function CrmWorkspace({ initialClientId }: { initialClientId?: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [filters, setFilters] = useState<ClientFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [interactions, setInteractions] = useState<ClientInteraction[]>([]);
  const [preference, setPreference] = useState<ClientPreference | null>(null);
  const [clientDeals, setClientDeals] = useState<Deal[]>([]);
  const [watchesById, setWatchesById] = useState<Map<string, Watch>>(new Map());
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [clientModalMode, setClientModalMode] = useState<'create' | 'edit'>('create');
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const clientForm = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: { name: '', email: '', phone: '', notes: '', tagsInput: '', budgetRange: '' },
  });
  const interactionForm = useForm<InteractionFormValues>({
    resolver: zodResolver(interactionSchema),
    defaultValues: { type: 'NOTE', notes: '', occurredAt: toDatetimeLocalValue(new Date().toISOString()) },
  });
  const preferenceForm = useForm<PreferenceFormValues>({
    resolver: zodResolver(preferenceSchema),
    defaultValues: { preferredBrandsInput: '', preferredModelsInput: '', budgetMin: '', budgetMax: '', notes: '' },
  });

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const filteredClients = useMemo(
    () => filterClients(clients, filters),
    [clients, filters],
  );

  const activeFilters = hasActiveFilters(filters);

  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    setClientsError(null);
    try {
      void queryKeys.crm.list({});
      const data = await apiGet<Client[]>('/crm/clients', { authenticated: true });
      setClients(data);
    } catch (error) {
      setClientsError(error instanceof ApiError ? error.message : 'No se pudieron cargar los clientes.');
    } finally {
      setClientsLoading(false);
    }
  }, []);

  const selectClient = useCallback(
    (clientId: string) => {
      setSelectedClientId(clientId);
      if (/^\/crm\/[^/]+$/.test(pathname)) {
        router.replace(`/crm/${clientId}`, { scroll: false });
      }
    },
    [pathname, router],
  );

  const loadClientDetails = useCallback(async (clientId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const [client, interactionsData, preferenceData, dealsData, watchesData] = await Promise.all([
        apiGet<Client>(`/crm/clients/${clientId}`, { authenticated: true }),
        apiGet<ClientInteraction[]>(`/crm/clients/${clientId}/interactions`, { authenticated: true }),
        apiGet<ClientPreference | null>(`/crm/clients/${clientId}/preference`, { authenticated: true }),
        apiGet<Deal[]>('/deals', { authenticated: true, query: { clientId } }),
        apiGet<Watch[]>('/inventory', { authenticated: true }),
      ]);
      void queryKeys.crm.clientDetail(clientId);
      void queryKeys.crm.clientInteractions(clientId);
      void queryKeys.crm.clientPreference(clientId);
      setSelectedClient(client);
      setInteractions(interactionsData);
      setPreference(preferenceData);
      setClientDeals(dealsData);
      setWatchesById(new Map(watchesData.map((watch) => [watch.id, watch])));
      preferenceForm.reset({
        preferredBrandsInput: preferenceData?.preferredBrands?.join(', ') ?? '',
        preferredModelsInput: preferenceData?.preferredModels?.join(', ') ?? '',
        budgetMin: preferenceData?.budgetMin ?? '',
        budgetMax: preferenceData?.budgetMax ?? '',
        notes: preferenceData?.notes ?? '',
      });
    } catch (error) {
      setDetailError(error instanceof ApiError ? error.message : 'No se pudieron cargar los detalles del cliente.');
    } finally {
      setDetailLoading(false);
    }
  }, [preferenceForm]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useEffect(() => {
    if (clientsLoading) return;

    if (filteredClients.length === 0) {
      if (selectedClientId !== null) setSelectedClientId(null);
      return;
    }

    if (selectedClientId && filteredClients.some((client) => client.id === selectedClientId)) {
      return;
    }

    if (initialClientId && filteredClients.some((client) => client.id === initialClientId)) {
      setSelectedClientId(initialClientId);
      return;
    }

    setSelectedClientId(filteredClients[0].id);
  }, [filteredClients, clientsLoading, selectedClientId, initialClientId]);

  useEffect(() => {
    if (!selectedClientId) {
      setSelectedClient(null);
      setInteractions([]);
      setPreference(null);
      setClientDeals([]);
      setWatchesById(new Map());
      return;
    }
    void loadClientDetails(selectedClientId);
  }, [selectedClientId, loadClientDetails]);

  useEffect(() => {
    if (searchParams.get('action') !== 'create') return;
    setClientModalMode('create');
    clientForm.reset({ name: '', email: '', phone: '', notes: '', tagsInput: '', budgetRange: '' });
    setClientModalOpen(true);
    router.replace(pathname, { scroll: false });
  }, [searchParams, pathname, router, clientForm]);

  const clientInsights = useMemo(() => {
    const wonDeals = clientDeals.filter((deal) => deal.stage === 'CLOSED_WON');
    const openDeals = clientDeals.filter((deal) => OPEN_DEAL_STAGES.includes(deal.stage));
    const historicalValue = wonDeals.reduce((sum, deal) => sum + Number(deal.agreedPrice), 0);
    const lastPurchase = [...wonDeals].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
    const lastInteraction = [...interactions].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    )[0];
    const nextOpenDeal = [...openDeals].sort((a, b) => {
      const aDate = a.expectedCloseAt ?? a.updatedAt;
      const bDate = b.expectedCloseAt ?? b.updatedAt;
      return new Date(aDate).getTime() - new Date(bDate).getTime();
    })[0];

    return {
      wonDeals,
      openDeals,
      historicalValue,
      lastPurchase,
      lastInteraction,
      nextAction: nextOpenDeal
        ? {
            action: `${DEAL_STAGE_NEXT_STEP[nextOpenDeal.stage]} ${watchTitle(watchesById.get(nextOpenDeal.watchId))}`,
            due: nextOpenDeal.expectedCloseAt,
          }
        : null,
    };
  }, [clientDeals, interactions, watchesById]);

  const openCreateModal = () => {
    setClientModalMode('create');
    clientForm.reset({ name: '', email: '', phone: '', notes: '', tagsInput: '', budgetRange: '' });
    setClientModalOpen(true);
  };

  const openEditModal = () => {
    if (!selectedClient) return;
    setClientModalMode('edit');
    clientForm.reset({
      name: selectedClient.name,
      email: selectedClient.email ?? '',
      phone: selectedClient.phone ?? '',
      notes: selectedClient.notes ?? '',
      tagsInput: selectedClient.tags?.join(', ') ?? '',
      budgetRange: selectedClient.budgetRange ?? '',
    });
    setClientModalOpen(true);
  };

  const submitClient = clientForm.handleSubmit(async (values) => {
    const payload = {
      name: values.name.trim(),
      email: values.email?.trim() || (clientModalMode === 'edit' ? null : undefined),
      phone: values.phone?.trim() || (clientModalMode === 'edit' ? null : undefined),
      notes: values.notes?.trim() || (clientModalMode === 'edit' ? null : undefined),
      tags: parseList(values.tagsInput),
      budgetRange: values.budgetRange?.trim() || (clientModalMode === 'edit' ? null : undefined),
    };

    try {
      if (clientModalMode === 'create') {
        const created = await apiPost<Client>('/crm/clients', payload, { authenticated: true });
        setFlash({ type: 'success', message: 'Cliente creado correctamente.' });
        setClientModalOpen(false);
        await loadClients();
        setSelectedClientId(created.id);
      } else if (selectedClientId) {
        await apiPatch<Client>(`/crm/clients/${selectedClientId}`, payload, { authenticated: true });
        setFlash({ type: 'success', message: 'Cliente actualizado correctamente.' });
        setClientModalOpen(false);
        await loadClients();
        await loadClientDetails(selectedClientId);
      }
    } catch (error) {
      setFlash({
        type: 'error',
        message: error instanceof ApiError ? error.message : 'Error al guardar el cliente.',
      });
    }
  });

  const submitInteraction = interactionForm.handleSubmit(async (values) => {
    if (!selectedClientId) return;
    try {
      await apiPost<ClientInteraction>(
        `/crm/clients/${selectedClientId}/interactions`,
        {
          type: values.type,
          notes: values.notes.trim(),
          occurredAt: new Date(values.occurredAt).toISOString(),
        },
        { authenticated: true },
      );
      setFlash({ type: 'success', message: 'Interacción agregada.' });
      interactionForm.reset({
        type: values.type,
        notes: '',
        occurredAt: toDatetimeLocalValue(new Date().toISOString()),
      });
      await loadClientDetails(selectedClientId);
    } catch (error) {
      setFlash({
        type: 'error',
        message: error instanceof ApiError ? error.message : 'No se pudo agregar la interacción.',
      });
    }
  });

  const submitPreference = preferenceForm.handleSubmit(async (values) => {
    if (!selectedClientId) return;
    try {
      await apiPut<ClientPreference>(
        `/crm/clients/${selectedClientId}/preference`,
        {
          preferredBrands: parseList(values.preferredBrandsInput),
          preferredModels: parseList(values.preferredModelsInput),
          budgetMin: values.budgetMin?.trim() ? Number(values.budgetMin) : null,
          budgetMax: values.budgetMax?.trim() ? Number(values.budgetMax) : null,
          notes: values.notes?.trim() || null,
        },
        { authenticated: true },
      );
      setFlash({ type: 'success', message: 'Preferencia del cliente guardada.' });
      await loadClientDetails(selectedClientId);
    } catch (error) {
      setFlash({
        type: 'error',
        message: error instanceof ApiError ? error.message : 'No se pudieron guardar las preferencias.',
      });
    }
  });

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiDelete(`/crm/clients/${deleteTarget.id}`, { authenticated: true });
      setFlash({ type: 'success', message: 'Cliente eliminado.' });
      setDeleteTarget(null);
      await loadClients();
    } catch (error) {
      setFlash({
        type: 'error',
        message: error instanceof ApiError ? error.message : 'No se pudo eliminar el cliente.',
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
  }

  return (
    <div className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">CRM</h1>
          <p className="ui-subtitle">Administra clientes, conversaciones y preferencias de compra.</p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="ui-btn-primary px-4 py-2"
        >
          Agregar cliente
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

      <section className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <article className="ui-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFiltersOpen((open) => !open)}
                className="ui-btn-ghost px-3 py-1.5 text-xs"
              >
                {filtersOpen ? 'Ocultar filtros' : 'Filtros'}
              </button>
              {activeFilters && !filtersOpen ? (
                <span className="text-[11px] text-white/35">Filtrando</span>
              ) : null}
            </div>
            {activeFilters ? (
              <button type="button" onClick={resetFilters} className="ui-btn-ghost px-3 py-1.5 text-xs">
                Restablecer
              </button>
            ) : null}
          </div>

          {filtersOpen ? (
            <div className="mb-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <input
                  value={filters.name}
                  onChange={(event) => setFilters((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Filtrar por nombre"
                  className="ui-input"
                />
                <input
                  value={filters.phone}
                  onChange={(event) => setFilters((prev) => ({ ...prev, phone: event.target.value }))}
                  placeholder="Filtrar por teléfono"
                  className="ui-input"
                />
                <input
                  value={filters.tag}
                  onChange={(event) => setFilters((prev) => ({ ...prev, tag: event.target.value }))}
                  placeholder="Filtrar por etiqueta"
                  className="ui-input"
                />
              </div>
            </div>
          ) : null}

          {clientsLoading ? (
            <div className="space-y-3 animate-pulse">
              {Array.from({ length: 7 }).map((_, index) => (
                <div key={index} className="h-16 rounded-lg bg-white/10" />
              ))}
            </div>
          ) : clientsError ? (
            <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 p-4 text-sm text-rose-100">
              <p>{clientsError}</p>
              <button type="button" onClick={() => void loadClients()} className="mt-3 underline">
                Retry
              </button>
            </div>
          ) : clients.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 p-10 text-center">
              <p className="text-lg font-medium">No se encontraron clientes</p>
              <p className="mt-2 text-sm text-muted">Crea tu primer cliente para comenzar tu pipeline de CRM.</p>
              <button
                type="button"
                onClick={openCreateModal}
                className="ui-btn-primary mt-5 px-4 py-2"
              >
                Agregar primer cliente
              </button>
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 px-6 py-10 text-center">
              <p className="text-sm text-white/55">No encontramos clientes con esos filtros.</p>
              <button type="button" onClick={resetFilters} className="ui-btn-ghost mt-4 px-3 py-1.5 text-xs">
                Restablecer filtros
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredClients.map((client) => {
                const isActive = client.id === selectedClientId;
                return (
                  <button
                    type="button"
                    key={client.id}
                    onClick={() => selectClient(client.id)}
                    className={`w-full rounded-lg border p-4 text-left transition ${
                      isActive
                        ? 'border-accent/50 bg-accent/10'
                        : 'border-white/10 bg-surface/40 hover:border-white/20 hover:bg-surface/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{client.name}</p>
                        <p className="mt-1 text-xs text-muted">{client.email ?? 'Sin correo'} · {client.phone ?? 'Sin teléfono'}</p>
                      </div>
                      <span className="text-xs text-muted">{client.budgetRange ?? 'Sin presupuesto'}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(client.tags ?? []).length ? (
                        client.tags?.map((tag) => (
                          <span key={tag} className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-muted">
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted">Sin etiquetas</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </article>

        <article className="ui-card">
          {!selectedClientId ? (
            <div className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-muted">
              Selecciona un cliente para ver sus detalles e interacciones.
            </div>
          ) : detailLoading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-7 w-2/3 rounded bg-white/10" />
              <div className="h-24 rounded bg-white/10" />
              <div className="h-32 rounded bg-white/10" />
              <div className="h-32 rounded bg-white/10" />
            </div>
          ) : detailError ? (
            <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 p-4 text-sm text-rose-100">
              {detailError}
            </div>
          ) : selectedClient ? (
            <div className="space-y-4 p-4">
              <header className="border-b border-white/[0.08] pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-semibold tracking-tight text-white">{selectedClient.name}</h2>
                    <p className="mt-1 text-sm text-white/45">
                      {selectedClient.email ?? 'Sin correo'} · {selectedClient.phone ?? 'Sin teléfono'}
                    </p>
                    {(selectedClient.tags ?? []).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selectedClient.tags?.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-white/45"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={openEditModal} className="ui-btn-secondary px-3 py-2 text-xs">
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(selectedClient)}
                      className="ui-btn-danger px-3 py-2 text-xs"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
                      Valor histórico
                    </p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-white">
                      {fmtMxn(clientInsights.historicalValue)}
                    </p>
                    <p className="mt-2 text-sm text-white/50">
                      {clientInsights.wonDeals.length}{' '}
                      {clientInsights.wonDeals.length === 1 ? 'compra' : 'compras'}
                    </p>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-white/40">Última compra:</p>
                      <p className="mt-0.5 font-medium text-white">
                        {clientInsights.lastPurchase
                          ? watchTitle(watchesById.get(clientInsights.lastPurchase.watchId))
                          : 'Sin compras'}
                      </p>
                    </div>
                    <div>
                      <p className="text-white/40">Última interacción:</p>
                      <p className="mt-0.5 font-medium text-white">
                        {clientInsights.lastInteraction
                          ? formatRelativeDays(clientInsights.lastInteraction.occurredAt)
                          : 'Sin interacciones'}
                      </p>
                    </div>
                  </div>
                </div>
              </header>

              <ClientAccountsSummary clientId={selectedClient.id} />

              <section className="rounded-xl border border-white/[0.08] bg-surface/40 p-4">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
                  Próxima acción
                </p>
                {clientInsights.nextAction ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-base font-semibold leading-snug text-white">
                      {clientInsights.nextAction.action}
                    </p>
                    {clientInsights.nextAction.due ? (
                      <p className="text-sm text-white/55">
                        Fecha objetivo:{' '}
                        <span className="tabular-nums text-white/75">
                          {fmtDateShort(clientInsights.nextAction.due)}
                        </span>
                      </p>
                    ) : null}
                    <p className="text-sm text-white/55">
                      Status: <span className="font-medium text-amber-400/90">Pendiente</span>
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-white/40">Sin seguimiento programado</p>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
                    Oportunidades
                  </h3>
                  <span className="text-xs tabular-nums text-white/35">
                    {clientInsights.openDeals.length}
                  </span>
                </div>
                {clientInsights.openDeals.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/[0.08] px-4 py-5 text-sm text-white/40">
                    No hay oportunidades activas.
                  </p>
                ) : (
                  <div className="grid gap-3">
                    {clientInsights.openDeals.map((deal) => (
                      <OpportunityCard
                        key={deal.id}
                        deal={deal}
                        watch={watchesById.get(deal.watchId)}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
                  Actividad
                </h3>
                <form onSubmit={submitInteraction} className="space-y-3 rounded-xl border border-white/[0.08] bg-surface/40 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <select {...interactionForm.register('type')} className="ui-input">
                      {interactionTypes.map((type) => (
                        <option key={type} value={type}>
                          {INTERACTION_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                    <input type="datetime-local" {...interactionForm.register('occurredAt')} className="ui-input" />
                  </div>
                  <textarea
                    {...interactionForm.register('notes')}
                    rows={2}
                    placeholder="¿Qué ocurrió?"
                    className="ui-input"
                  />
                  {interactionForm.formState.errors.notes ? (
                    <p className="text-xs text-rose-300">{interactionForm.formState.errors.notes.message}</p>
                  ) : null}
                  <button type="submit" className="ui-btn-secondary px-3 py-2 text-xs">
                    Agregar interacción
                  </button>
                </form>

                {interactions.length === 0 ? (
                  <p className="text-sm text-white/40">Aún no hay actividad registrada.</p>
                ) : (
                  <ul className="space-y-0 divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-surface/30">
                    {interactions.map((item) => (
                      <li key={item.id} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-emerald-400/90">
                            {INTERACTION_TYPE_LABELS[item.type]}
                          </span>
                          <span className="text-xs tabular-nums text-white/35">
                            {formatDateTime(item.occurredAt)}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed text-white/75">{item.notes}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {selectedClient.notes?.trim() ? (
                <section className="rounded-xl border border-white/[0.08] bg-surface/40 p-4">
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">Notas</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/75">{selectedClient.notes}</p>
                </section>
              ) : null}

              <section className="space-y-3">
                <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
                  Preferencia del cliente
                </h3>
                <form onSubmit={submitPreference} className="space-y-3 rounded-xl border border-white/[0.08] bg-surface/40 p-3">
                  <input
                    {...preferenceForm.register('preferredBrandsInput')}
                    placeholder="Marcas preferidas (separadas por comas)"
                    className="ui-input"
                  />
                  <input
                    {...preferenceForm.register('preferredModelsInput')}
                    placeholder="Modelos preferidos (separados por comas)"
                    className="ui-input"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      {...preferenceForm.register('budgetMin')}
                      placeholder="Presupuesto mínimo"
                      className="ui-input"
                    />
                    <input
                      {...preferenceForm.register('budgetMax')}
                      placeholder="Presupuesto máximo"
                      className="ui-input"
                    />
                  </div>
                  {(preferenceForm.formState.errors.budgetMin || preferenceForm.formState.errors.budgetMax) ? (
                    <p className="text-xs text-rose-300">
                      {preferenceForm.formState.errors.budgetMin?.message ?? preferenceForm.formState.errors.budgetMax?.message}
                    </p>
                  ) : null}
                  <textarea
                    {...preferenceForm.register('notes')}
                    rows={2}
                    placeholder="Notas de preferencia"
                    className="ui-input"
                  />
                  <button type="submit" className="ui-btn-secondary px-3 py-2">
                    Guardar preferencia
                  </button>
                </form>
                {preference ? (
                  <p className="text-xs text-muted">Última actualización: {formatDateTime(preference.updatedAt)}</p>
                ) : (
                  <p className="text-xs text-muted">Aún no hay preferencia guardada.</p>
                )}
              </section>
            </div>
          ) : null}
        </article>
      </section>

      {clientModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
          <button
            type="button"
            aria-label="Close modal"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setClientModalOpen(false)}
          />
          <form
            onSubmit={submitClient}
            className="relative max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-white/10 bg-panel/95 p-4 shadow-2xl backdrop-blur sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {clientModalMode === 'create' ? 'Crear cliente' : 'Editar cliente'}
                </h2>
                <p className="mt-1 text-sm text-muted">Captura el perfil y contexto comercial.</p>
              </div>
              <button
                type="button"
                onClick={() => setClientModalOpen(false)}
                className="rounded p-1 text-muted hover:bg-white/10"
              >
                ✕
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <input {...clientForm.register('name')} placeholder="Nombre del cliente *" className="ui-input" />
                {clientForm.formState.errors.name ? (
                  <p className="mt-1 text-xs text-rose-300">{clientForm.formState.errors.name.message}</p>
                ) : null}
              </div>
              <input {...clientForm.register('email')} placeholder="Email" className="ui-input" />
              <input {...clientForm.register('phone')} placeholder="Phone" className="ui-input" />
              <input {...clientForm.register('tagsInput')} placeholder="Etiquetas (separadas por comas)" className="ui-input sm:col-span-2" />
              <input {...clientForm.register('budgetRange')} placeholder="Rango de presupuesto (ej. 8k-12k)" className="ui-input sm:col-span-2" />
              <textarea {...clientForm.register('notes')} rows={3} placeholder="Notes" className="ui-input sm:col-span-2" />
              {(clientForm.formState.errors.email || clientForm.formState.errors.phone) ? (
                <p className="text-xs text-rose-300 sm:col-span-2">
                  {clientForm.formState.errors.email?.message ?? clientForm.formState.errors.phone?.message}
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 pt-3">
              <button type="button" onClick={() => setClientModalOpen(false)} className="ui-btn-ghost px-3 py-2">
                Cancelar
              </button>
              <button type="submit" className="ui-btn-primary px-4 py-2">
                {clientModalMode === 'create' ? 'Crear cliente' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        title="¿Eliminar cliente?"
        description={
          deleteTarget
            ? `Esto archivará a ${deleteTarget.name} y eliminará sus datos de la vista activa.`
            : ''
        }
        loading={deleteLoading}
        onCancel={() => !deleteLoading && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

