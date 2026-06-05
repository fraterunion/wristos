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
import type { Client, ClientInteraction, ClientPreference } from '@/types/domain';

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

  const [draftFilters, setDraftFilters] = useState<ClientFilters>({ name: '', phone: '', tag: '' });
  const [appliedFilters, setAppliedFilters] = useState<ClientFilters>({ name: '', phone: '', tag: '' });

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [interactions, setInteractions] = useState<ClientInteraction[]>([]);
  const [preference, setPreference] = useState<ClientPreference | null>(null);
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

  const clientQuery = useMemo(() => {
    const query: Record<string, string> = {};
    if (appliedFilters.name.trim()) query.name = appliedFilters.name.trim();
    if (appliedFilters.phone.trim()) query.phone = appliedFilters.phone.trim();
    if (appliedFilters.tag.trim()) query.tag = appliedFilters.tag.trim();
    return query;
  }, [appliedFilters]);

  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    setClientsError(null);
    try {
      void queryKeys.crm.list(clientQuery);
      const data = await apiGet<Client[]>('/crm/clients', { authenticated: true, query: clientQuery });
      setClients(data);
      if (data.length === 0) {
        setSelectedClientId(null);
      } else if (initialClientId && data.some((c) => c.id === initialClientId)) {
        setSelectedClientId(initialClientId);
      } else if (!selectedClientId || !data.some((c) => c.id === selectedClientId)) {
        setSelectedClientId(data[0].id);
      }
    } catch (error) {
      setClientsError(error instanceof ApiError ? error.message : 'No se pudieron cargar los clientes.');
    } finally {
      setClientsLoading(false);
    }
  }, [clientQuery, selectedClientId, initialClientId]);

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
      const [client, interactionsData, preferenceData] = await Promise.all([
        apiGet<Client>(`/crm/clients/${clientId}`, { authenticated: true }),
        apiGet<ClientInteraction[]>(`/crm/clients/${clientId}/interactions`, { authenticated: true }),
        apiGet<ClientPreference | null>(`/crm/clients/${clientId}/preference`, { authenticated: true }),
      ]);
      void queryKeys.crm.clientDetail(clientId);
      void queryKeys.crm.clientInteractions(clientId);
      void queryKeys.crm.clientPreference(clientId);
      setSelectedClient(client);
      setInteractions(interactionsData);
      setPreference(preferenceData);
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
    if (!selectedClientId) {
      setSelectedClient(null);
      setInteractions([]);
      setPreference(null);
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
  }, [searchParams, pathname, router]);

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

      <section className="ui-card p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <input
            value={draftFilters.name}
            onChange={(event) => setDraftFilters((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Filtrar por nombre"
            className="ui-input"
          />
          <input
            value={draftFilters.phone}
            onChange={(event) => setDraftFilters((prev) => ({ ...prev, phone: event.target.value }))}
            placeholder="Filtrar por teléfono"
            className="ui-input"
          />
          <input
            value={draftFilters.tag}
            onChange={(event) => setDraftFilters((prev) => ({ ...prev, tag: event.target.value }))}
            placeholder="Filtrar por etiqueta"
            className="ui-input"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAppliedFilters({ ...draftFilters })}
              className="ui-btn-secondary flex-1 px-3 py-2"
            >
              Aplicar
            </button>
            <button
              type="button"
              onClick={() => {
                const clean = { name: '', phone: '', tag: '' };
                setDraftFilters(clean);
                setAppliedFilters(clean);
              }}
              className="ui-btn-ghost px-3 py-2"
            >
              Restablecer
            </button>
          </div>
        </div>
      </section>

      <section className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <article className="ui-card p-4">
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
          ) : (
            <div className="space-y-2">
              {clients.map((client) => {
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
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <h2 className="text-lg font-semibold">{selectedClient.name}</h2>
                  <p className="mt-1 text-sm text-muted">{selectedClient.email ?? 'Sin correo'} · {selectedClient.phone ?? 'Sin teléfono'}</p>
                  <p className="mt-1 text-xs text-muted">Presupuesto: {selectedClient.budgetRange ?? 'Sin especificar'}</p>
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

              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Notas</h3>
                <p className="mt-2 rounded-lg border border-white/10 bg-surface/60 p-3 text-sm text-white/90">
                  {selectedClient.notes?.trim() || 'Aún no hay notas.'}
                </p>
              </section>

              <ClientAccountsSummary clientId={selectedClient.id} />

              <section className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Agregar interacción</h3>
                <form onSubmit={submitInteraction} className="space-y-3 rounded-lg border border-white/10 bg-surface/50 p-3">
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
                  <button type="submit" className="ui-btn-secondary px-3 py-2">
                    Agregar interacción
                  </button>
                </form>

                <div className="space-y-2">
                  {interactions.length === 0 ? (
                    <p className="text-sm text-muted">Aún no hay interacciones.</p>
                  ) : (
                    interactions.map((item) => (
                      <div key={item.id} className="rounded-lg border border-white/10 bg-surface/50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-accent">{item.type}</span>
                          <span className="text-xs text-muted">{formatDateTime(item.occurredAt)}</span>
                        </div>
                        <p className="mt-2 text-sm">{item.notes}</p>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Preferencia del cliente</h3>
                <form onSubmit={submitPreference} className="space-y-3 rounded-lg border border-white/10 bg-surface/50 p-3">
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

