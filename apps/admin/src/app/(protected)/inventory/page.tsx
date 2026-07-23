'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { DeleteConfirmDialog } from '@/components/inventory/DeleteConfirmDialog';
import { StatusBadge } from '@/components/inventory/StatusBadge';
import { WatchFormModal } from '@/components/inventory/WatchFormModal';
import { WatchImageLightbox } from '@/components/inventory/WatchImageLightbox';
import { apiDelete, apiGet, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Watch, WatchStatus } from '@/types/domain';

type AppliedFilters = {
  status: '' | 'AVAILABLE' | 'RESERVED';
  brand: string;
  model: string;
};

const ACTIVE_INVENTORY_STATUSES: WatchStatus[] = ['AVAILABLE', 'RESERVED'];

const INVENTORY_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'AVAILABLE', label: 'Disponible' },
  { value: 'RESERVED', label: 'Reservado' },
] as const;

function formatMoney(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function dash(value: string | null | undefined) {
  if (value === null || value === undefined || value.trim() === '') return '—';
  return value;
}

export default function InventoryPage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const [watches, setWatches] = useState<Watch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [draftFilters, setDraftFilters] = useState<AppliedFilters>({
    status: '',
    brand: '',
    model: '',
  });
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>({
    status: '',
    brand: '',
    model: '',
  });

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingWatch, setEditingWatch] = useState<Watch | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Watch | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [catalogLoading, setCatalogLoading] = useState(false);

  const [lightboxWatch, setLightboxWatch] = useState<Watch | null>(null);

  const listQueryFilter = useMemo(() => {
    const q: Record<string, string> = {};
    if (appliedFilters.status) q.status = appliedFilters.status;
    const brand = appliedFilters.brand.trim();
    if (brand) q.brand = brand;
    const model = appliedFilters.model.trim();
    if (model) q.model = model;
    return q;
  }, [appliedFilters.status, appliedFilters.brand, appliedFilters.model]);

  const loadWatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      void queryKeys.inventory.list(listQueryFilter);
      const data = await apiGet<Watch[]>('/inventory', {
        authenticated: true,
        query: listQueryFilter,
      });
      setWatches(data);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'No se pudo cargar el inventario.',
      );
    } finally {
      setLoading(false);
    }
  }, [listQueryFilter]);

  useEffect(() => {
    void loadWatches();
  }, [loadWatches]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    if (searchParams.get('action') !== 'create') return;
    setFormMode('create');
    setEditingWatch(null);
    setFormOpen(true);
    router.replace(pathname, { scroll: false });
  }, [searchParams, pathname, router]);

  const applyFilters = () => {
    setAppliedFilters({ ...draftFilters });
  };

  const resetFilters = () => {
    const empty: AppliedFilters = { status: '', brand: '', model: '' };
    setDraftFilters(empty);
    setAppliedFilters(empty);
  };

  const openCreate = () => {
    setFormMode('create');
    setEditingWatch(null);
    setFormOpen(true);
  };

  const openEdit = (watch: Watch) => {
    setFormMode('edit');
    setEditingWatch(watch);
    setFormOpen(true);
  };

  const handleSaved = (payload: { mode: 'create' | 'edit' }) => {
    void loadWatches();
    setFlash({
      type: 'success',
      message:
        payload.mode === 'create'
          ? 'Reloj agregado al inventario.'
          : 'Reloj actualizado correctamente.',
    });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiDelete(`/inventory/${deleteTarget.id}`, { authenticated: true });
      setDeleteTarget(null);
      void loadWatches();
      setFlash({ type: 'success', message: 'Reloj eliminado del inventario.' });
    } catch (caught) {
      setFlash({
        type: 'error',
        message:
          caught instanceof ApiError ? caught.message : 'No se pudo eliminar este reloj.',
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleGenerateCatalog = async () => {
    const available = watches.filter((w) => w.status === 'AVAILABLE');
    if (available.length === 0) {
      setFlash({ type: 'error', message: 'No hay relojes disponibles para el catálogo.' });
      return;
    }
    setCatalogLoading(true);
    try {
      const { generateCatalogPdf } = await import('@/components/inventory/catalog-pdf');
      await generateCatalogPdf(available);
    } catch {
      setFlash({ type: 'error', message: 'No se pudo generar el catálogo. Intenta de nuevo.' });
    } finally {
      setCatalogLoading(false);
    }
  };

  const visibleWatches = useMemo(
    () => watches.filter((w) => ACTIVE_INVENTORY_STATUSES.includes(w.status)),
    [watches],
  );

  const empty = !loading && !error && visibleWatches.length === 0;

  return (
    <div className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Inventario</h1>
          <p className="ui-subtitle max-w-2xl">
            Administra tu stock de relojes, propiedad y estado de los listados en un solo lugar.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleGenerateCatalog()}
            disabled={catalogLoading}
            className="ui-btn-secondary px-5 py-2.5 disabled:opacity-60"
          >
            {catalogLoading ? 'Generando…' : 'Generar catálogo'}
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="ui-btn-primary px-5 py-2.5"
          >
            Agregar reloj
          </button>
        </div>
      </header>

      {flash ? (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${
            flash.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-100'
          }`}
        >
          {flash.message}
        </div>
      ) : null}

      <section className="ui-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Filtros
            </h2>
            <p className="mt-1 text-xs text-muted/90">Refina la lista por estado, marca o modelo.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className="ui-btn-ghost px-3 py-2"
            >
              Restablecer
            </button>
            <button
              type="button"
              onClick={applyFilters}
              className="ui-btn-secondary px-4 py-2"
            >
              Aplicar filtros
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
              Estado
            </span>
            <select
              value={draftFilters.status}
              onChange={(e) =>
                setDraftFilters((f) => ({
                  ...f,
                  status: e.target.value as AppliedFilters['status'],
                }))
              }
              className="ui-input"
            >
              <option value="">Todos</option>
              {INVENTORY_STATUS_FILTER_OPTIONS.filter((o) => o.value !== '').map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
              Marca contiene
            </span>
            <input
              value={draftFilters.brand}
              onChange={(e) => setDraftFilters((f) => ({ ...f, brand: e.target.value }))}
              placeholder="ej. Rolex"
              className="ui-input"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
              Modelo contiene
            </span>
            <input
              value={draftFilters.model}
              onChange={(e) => setDraftFilters((f) => ({ ...f, model: e.target.value }))}
              placeholder="ej. Submariner"
              className="ui-input"
            />
          </label>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-500/35 bg-rose-500/10 p-6">
          <h3 className="text-sm font-semibold text-rose-100">No se pudo cargar el inventario</h3>
          <p className="mt-2 text-sm text-rose-100/90">{error}</p>
          <button
            type="button"
            onClick={() => void loadWatches()}
            className="ui-btn-danger mt-4 px-4 py-2 text-rose-50"
          >
            Intentar de nuevo
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-12 rounded-xl bg-white/10" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-white/5" />
          ))}
        </div>
      ) : null}

      {empty ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-panel/50 px-4 py-12 text-center sm:px-8 sm:py-16">
          <p className="text-lg font-medium text-white">Aún no hay relojes en el inventario</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Comienza agregando tu primera pieza. Registra costo, precio, estado y consignación en un solo registro.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="ui-btn-primary mt-6 px-5 py-2.5"
          >
            Agregar tu primer reloj
          </button>
        </div>
      ) : null}

      {!loading && !error && visibleWatches.length > 0 ? (
        <div className="ui-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-surface/80 text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium w-16">Foto</th>
                  <th className="px-4 py-3 font-medium">Marca / Modelo</th>
                  <th className="px-4 py-3 font-medium">Serie</th>
                  <th className="px-4 py-3 font-medium">Condición</th>
                  <th className="px-4 py-3 font-medium text-right">Rango de precio</th>
                  <th className="px-4 py-3 font-medium text-right">Costo efectivo</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Propiedad</th>
                  <th className="px-4 py-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleWatches.map((watch) => (
                  <tr
                    key={watch.id}
                    className="border-b border-white/5 transition duration-150 hover:bg-white/[0.05]"
                  >
                    <td className="px-4 py-3">
                      {watch.imageUrl ? (
                        <button
                          type="button"
                          onClick={() => setLightboxWatch(watch)}
                          className="group h-10 w-10 cursor-zoom-in overflow-hidden rounded ring-1 ring-white/10 transition duration-150 hover:ring-white/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          aria-label={`View photo of ${watch.brand} ${watch.model}`}
                        >
                          <img
                            src={watch.imageUrl}
                            alt={`${watch.brand} ${watch.model}`}
                            className="h-full w-full object-cover transition duration-150 group-hover:brightness-110"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                        </button>
                      ) : (
                        <div className="h-10 w-10 rounded bg-white/5 ring-1 ring-white/10" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{watch.brand}</div>
                      <div className="text-xs text-muted">{watch.model}</div>
                      {watch.isPublished ? (
                        <div className="mt-1.5 flex flex-col items-start gap-0.5">
                          <span className="inline-flex rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                            Publicado
                          </span>
                          {watch.publicSlug ? (
                            <span className="font-mono text-[10px] text-muted/70">
                              /{watch.publicSlug}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{dash(watch.serialNumber)}</td>
                    <td className="px-4 py-3 text-muted">{dash(watch.condition)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-white">
                      {watch.priceMin == null && watch.priceMax == null
                        ? '—'
                        : watch.priceMin === watch.priceMax || watch.priceMax == null
                          ? formatMoney(watch.priceMin ?? watch.priceMax)
                          : watch.priceMin == null
                            ? formatMoney(watch.priceMax)
                            : `${formatMoney(watch.priceMin)} – ${formatMoney(watch.priceMax)}`}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className="font-medium text-white">{formatMoney(watch.effectiveCost)}</span>
                      {watch.expenses.length > 0 ? (
                        <div className="text-xs text-muted">
                          Base {formatMoney(watch.cost)} + {watch.expenses.length} exp.
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={watch.status} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted">
                        {watch.ownershipType === 'CONSIGNMENT' ? 'Consignación' : 'Propio'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(watch)}
                        className="mr-2 text-xs font-medium text-accent hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(watch)}
                        className="text-xs font-medium text-rose-300 hover:text-rose-200 hover:underline"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <WatchFormModal
        mode={formMode}
        watch={editingWatch}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
      />

      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        title="¿Quitar reloj del inventario?"
        description={
          deleteTarget
            ? `Esto archivará "${deleteTarget.brand} ${deleteTarget.model}" y lo quitará de los listados activos.`
            : ''
        }
        loading={deleteLoading}
        onCancel={() => !deleteLoading && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

      <WatchImageLightbox
        watch={lightboxWatch}
        onClose={() => setLightboxWatch(null)}
      />
    </div>
  );
}
