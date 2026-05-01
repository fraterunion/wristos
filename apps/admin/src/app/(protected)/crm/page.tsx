'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DeleteConfirmDialog } from '@/components/inventory/DeleteConfirmDialog';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Client, ClientInteraction, ClientPreference } from '@/types/domain';

const interactionTypes = ['CALL', 'MESSAGE', 'MEETING', 'NOTE'] as const;

const clientSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().optional().refine((value) => !value || z.string().email().safeParse(value).success, {
    message: 'Enter a valid email',
  }),
  phone: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^[0-9+()\-\s]{7,20}$/.test(value), {
      message: 'Enter a valid phone-like format',
    }),
  notes: z.string().optional(),
  tagsInput: z.string().optional(),
  budgetRange: z.string().optional(),
});

const interactionSchema = z.object({
  type: z.enum(interactionTypes),
  notes: z.string().trim().min(1, 'Notes are required'),
  occurredAt: z.string().min(1, 'Date/time is required'),
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
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Min must be numeric', path: ['budgetMin'] });
    }
    if (max && Number.isNaN(Number(max))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Max must be numeric', path: ['budgetMax'] });
    }
    if (min && max && Number(min) > Number(max)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Min must be <= Max', path: ['budgetMax'] });
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

export default function CrmPage() {
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
      } else if (!selectedClientId || !data.some((c) => c.id === selectedClientId)) {
        setSelectedClientId(data[0].id);
      }
    } catch (error) {
      setClientsError(error instanceof ApiError ? error.message : 'Unable to load clients.');
    } finally {
      setClientsLoading(false);
    }
  }, [clientQuery, selectedClientId]);

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
      setDetailError(error instanceof ApiError ? error.message : 'Unable to load client details.');
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
        setFlash({ type: 'success', message: 'Client created successfully.' });
        setClientModalOpen(false);
        await loadClients();
        setSelectedClientId(created.id);
      } else if (selectedClientId) {
        await apiPatch<Client>(`/crm/clients/${selectedClientId}`, payload, { authenticated: true });
        setFlash({ type: 'success', message: 'Client updated successfully.' });
        setClientModalOpen(false);
        await loadClients();
        await loadClientDetails(selectedClientId);
      }
    } catch (error) {
      setFlash({
        type: 'error',
        message: error instanceof ApiError ? error.message : 'Failed to save client.',
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
      setFlash({ type: 'success', message: 'Interaction added.' });
      interactionForm.reset({
        type: values.type,
        notes: '',
        occurredAt: toDatetimeLocalValue(new Date().toISOString()),
      });
      await loadClientDetails(selectedClientId);
    } catch (error) {
      setFlash({
        type: 'error',
        message: error instanceof ApiError ? error.message : 'Could not add interaction.',
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
      setFlash({ type: 'success', message: 'Client preference saved.' });
      await loadClientDetails(selectedClientId);
    } catch (error) {
      setFlash({
        type: 'error',
        message: error instanceof ApiError ? error.message : 'Could not save preferences.',
      });
    }
  });

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiDelete(`/crm/clients/${deleteTarget.id}`, { authenticated: true });
      setFlash({ type: 'success', message: 'Client deleted.' });
      setDeleteTarget(null);
      await loadClients();
    } catch (error) {
      setFlash({
        type: 'error',
        message: error instanceof ApiError ? error.message : 'Could not delete client.',
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
          <p className="ui-subtitle">Manage clients, conversations, and buying preferences.</p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="ui-btn-primary px-4 py-2"
        >
          Add client
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
            placeholder="Filter by name"
            className="ui-input"
          />
          <input
            value={draftFilters.phone}
            onChange={(event) => setDraftFilters((prev) => ({ ...prev, phone: event.target.value }))}
            placeholder="Filter by phone"
            className="ui-input"
          />
          <input
            value={draftFilters.tag}
            onChange={(event) => setDraftFilters((prev) => ({ ...prev, tag: event.target.value }))}
            placeholder="Filter by tag"
            className="ui-input"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAppliedFilters({ ...draftFilters })}
              className="ui-btn-secondary flex-1 px-3 py-2"
            >
              Apply
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
              Reset
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
              <p className="text-lg font-medium">No clients found</p>
              <p className="mt-2 text-sm text-muted">Create your first client to start building your CRM pipeline.</p>
              <button
                type="button"
                onClick={openCreateModal}
                className="ui-btn-primary mt-5 px-4 py-2"
              >
                Add first client
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
                    onClick={() => setSelectedClientId(client.id)}
                    className={`w-full rounded-lg border p-4 text-left transition ${
                      isActive
                        ? 'border-accent/50 bg-accent/10'
                        : 'border-white/10 bg-surface/40 hover:border-white/20 hover:bg-surface/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{client.name}</p>
                        <p className="mt-1 text-xs text-muted">{client.email ?? 'No email'} · {client.phone ?? 'No phone'}</p>
                      </div>
                      <span className="text-xs text-muted">{client.budgetRange ?? 'No budget'}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(client.tags ?? []).length ? (
                        client.tags?.map((tag) => (
                          <span key={tag} className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-muted">
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted">No tags</span>
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
              Select a client to view details and interactions.
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
                  <p className="mt-1 text-sm text-muted">{selectedClient.email ?? 'No email'} · {selectedClient.phone ?? 'No phone'}</p>
                  <p className="mt-1 text-xs text-muted">Budget: {selectedClient.budgetRange ?? 'Not specified'}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={openEditModal} className="ui-btn-secondary px-3 py-2 text-xs">
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(selectedClient)}
                    className="ui-btn-danger px-3 py-2 text-xs"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Notes</h3>
                <p className="mt-2 rounded-lg border border-white/10 bg-surface/60 p-3 text-sm text-white/90">
                  {selectedClient.notes?.trim() || 'No notes yet.'}
                </p>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Add interaction</h3>
                <form onSubmit={submitInteraction} className="space-y-3 rounded-lg border border-white/10 bg-surface/50 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <select {...interactionForm.register('type')} className="ui-input">
                      {interactionTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <input type="datetime-local" {...interactionForm.register('occurredAt')} className="ui-input" />
                  </div>
                  <textarea
                    {...interactionForm.register('notes')}
                    rows={2}
                    placeholder="What happened?"
                    className="ui-input"
                  />
                  {interactionForm.formState.errors.notes ? (
                    <p className="text-xs text-rose-300">{interactionForm.formState.errors.notes.message}</p>
                  ) : null}
                  <button type="submit" className="ui-btn-secondary px-3 py-2">
                    Add interaction
                  </button>
                </form>

                <div className="space-y-2">
                  {interactions.length === 0 ? (
                    <p className="text-sm text-muted">No interactions yet.</p>
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
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Client preference</h3>
                <form onSubmit={submitPreference} className="space-y-3 rounded-lg border border-white/10 bg-surface/50 p-3">
                  <input
                    {...preferenceForm.register('preferredBrandsInput')}
                    placeholder="Preferred brands (comma-separated)"
                    className="ui-input"
                  />
                  <input
                    {...preferenceForm.register('preferredModelsInput')}
                    placeholder="Preferred models (comma-separated)"
                    className="ui-input"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      {...preferenceForm.register('budgetMin')}
                      placeholder="Budget min"
                      className="ui-input"
                    />
                    <input
                      {...preferenceForm.register('budgetMax')}
                      placeholder="Budget max"
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
                    placeholder="Preference notes"
                    className="ui-input"
                  />
                  <button type="submit" className="ui-btn-secondary px-3 py-2">
                    Save preference
                  </button>
                </form>
                {preference ? (
                  <p className="text-xs text-muted">Last updated {formatDateTime(preference.updatedAt)}</p>
                ) : (
                  <p className="text-xs text-muted">No saved preference yet.</p>
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
                  {clientModalMode === 'create' ? 'Create client' : 'Edit client'}
                </h2>
                <p className="mt-1 text-sm text-muted">Capture core profile and commercial context.</p>
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
                <input {...clientForm.register('name')} placeholder="Client name *" className="ui-input" />
                {clientForm.formState.errors.name ? (
                  <p className="mt-1 text-xs text-rose-300">{clientForm.formState.errors.name.message}</p>
                ) : null}
              </div>
              <input {...clientForm.register('email')} placeholder="Email" className="ui-input" />
              <input {...clientForm.register('phone')} placeholder="Phone" className="ui-input" />
              <input {...clientForm.register('tagsInput')} placeholder="Tags (comma-separated)" className="ui-input sm:col-span-2" />
              <input {...clientForm.register('budgetRange')} placeholder="Budget range (e.g. 8k-12k)" className="ui-input sm:col-span-2" />
              <textarea {...clientForm.register('notes')} rows={3} placeholder="Notes" className="ui-input sm:col-span-2" />
              {(clientForm.formState.errors.email || clientForm.formState.errors.phone) ? (
                <p className="text-xs text-rose-300 sm:col-span-2">
                  {clientForm.formState.errors.email?.message ?? clientForm.formState.errors.phone?.message}
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 pt-3">
              <button type="button" onClick={() => setClientModalOpen(false)} className="ui-btn-ghost px-3 py-2">
                Cancel
              </button>
              <button type="submit" className="ui-btn-primary px-4 py-2">
                {clientModalMode === 'create' ? 'Create client' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete client?"
        description={
          deleteTarget
            ? `This will archive ${deleteTarget.name} and remove it from active CRM views.`
            : ''
        }
        loading={deleteLoading}
        onCancel={() => !deleteLoading && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
