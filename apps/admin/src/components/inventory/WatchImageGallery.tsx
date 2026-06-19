'use client';

import { useCallback, useEffect, useState } from 'react';

import { DeleteConfirmDialog } from '@/components/inventory/DeleteConfirmDialog';
import { ApiError } from '@/lib/api-client';
import {
  createWatchImage,
  deleteWatchImage,
  listWatchImages,
  setPrimaryWatchImage,
  updateWatchImage,
  type WatchImage,
} from '@/lib/inventory-api';

type Props = {
  watchId: string | null;
  mode: 'create' | 'edit';
};

type ImageForm = {
  url: string;
  altText: string;
  sortOrder: string;
  isPrimary: boolean;
};

const EMPTY_FORM: ImageForm = {
  url: '',
  altText: '',
  sortOrder: '0',
  isPrimary: false,
};

function GalleryPreview({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (failed || !url.trim()) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/10">
        <span className="text-[10px] uppercase tracking-wide text-muted/60">Sin vista previa</span>
      </div>
    );
  }

  return (
    <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-graphite ring-1 ring-white/10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function ImageCard({
  image,
  watchId,
  busy,
  onRefresh,
  onError,
}: {
  image: WatchImage;
  watchId: string;
  busy: string | null;
  onRefresh: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ImageForm>({
    url: image.url,
    altText: image.altText ?? '',
    sortOrder: String(image.sortOrder),
    isPrimary: image.isPrimary,
  });
  const [saving, setSaving] = useState(false);
  const [settingPrimary, setSettingPrimary] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const cardBusy = busy === image.id || saving || deleting || settingPrimary;

  async function handleSetPrimary() {
    if (image.isPrimary || cardBusy) return;
    setSettingPrimary(true);
    onError(null);
    try {
      await setPrimaryWatchImage(watchId, image.id);
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'No se pudo establecer la imagen principal.');
    } finally {
      setSettingPrimary(false);
    }
  }

  async function handleSaveEdit() {
    const url = form.url.trim();
    if (!url) {
      onError('La URL es requerida.');
      return;
    }
    const sortOrder = Number(form.sortOrder);
    if (!Number.isFinite(sortOrder) || sortOrder < 0) {
      onError('El orden debe ser 0 o mayor.');
      return;
    }

    setSaving(true);
    onError(null);
    try {
      await updateWatchImage(watchId, image.id, {
        url,
        altText: form.altText.trim() || null,
        sortOrder,
        isPrimary: form.isPrimary,
      });
      setEditing(false);
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'No se pudo actualizar la imagen.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    onError(null);
    try {
      await deleteWatchImage(watchId, image.id);
      setDeleteOpen(false);
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'No se pudo eliminar la imagen.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <article className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <GalleryPreview url={editing ? form.url : image.url} alt={image.altText ?? 'Watch'} />

        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {image.isPrimary ? (
              <span className="inline-flex rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                Principal
              </span>
            ) : null}
            <span className="text-[10px] tabular-nums text-muted">Orden {image.sortOrder}</span>
          </div>

          {editing ? (
            <div className="space-y-2">
              <input
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="URL de imagen"
                className="ui-input text-xs"
              />
              <input
                value={form.altText}
                onChange={(e) => setForm((f) => ({ ...f, altText: e.target.value }))}
                placeholder="Texto alternativo"
                className="ui-input text-xs"
              />
              <input
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                placeholder="Orden"
                className="ui-input text-xs"
              />
              <label className="inline-flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={form.isPrimary}
                  onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))}
                  className="h-3.5 w-3.5 rounded border-white/30 bg-surface"
                />
                Principal
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={cardBusy}
                  onClick={() => void handleSaveEdit()}
                  className="ui-btn-primary px-2.5 py-1.5 text-xs"
                >
                  {saving ? '…' : 'Guardar'}
                </button>
                <button
                  type="button"
                  disabled={cardBusy}
                  onClick={() => {
                    setEditing(false);
                    setForm({
                      url: image.url,
                      altText: image.altText ?? '',
                      sortOrder: String(image.sortOrder),
                      isPrimary: image.isPrimary,
                    });
                  }}
                  className="ui-btn-ghost px-2.5 py-1.5 text-xs"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="truncate font-mono text-[11px] text-white/55" title={image.url}>
                {image.url}
              </p>
              {image.altText ? (
                <p className="truncate text-xs text-muted">{image.altText}</p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                {!image.isPrimary ? (
                  <button
                    type="button"
                    disabled={cardBusy}
                    onClick={() => void handleSetPrimary()}
                    className="text-[11px] font-medium text-emerald-400 hover:underline disabled:opacity-40"
                  >
                    {settingPrimary ? '…' : 'Principal'}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={cardBusy}
                  onClick={() => setEditing(true)}
                  className="text-[11px] font-medium text-white/70 hover:text-white disabled:opacity-40"
                >
                  Editar
                </button>
                <button
                  type="button"
                  disabled={cardBusy}
                  onClick={() => setDeleteOpen(true)}
                  className="text-[11px] font-medium text-rose-300 hover:text-rose-200 disabled:opacity-40"
                >
                  Eliminar
                </button>
              </div>
            </>
          )}
        </div>
      </article>

      <DeleteConfirmDialog
        open={deleteOpen}
        title="¿Eliminar imagen?"
        description="Esta imagen se quitará de la galería del reloj."
        loading={deleting}
        onCancel={() => !deleting && setDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}

export function WatchImageGallery({ watchId, mode }: Props) {
  const [images, setImages] = useState<WatchImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<ImageForm>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);

  const loadImages = useCallback(async () => {
    if (!watchId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listWatchImages(watchId);
      setImages(data);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'No se pudieron cargar las imágenes.',
      );
    } finally {
      setLoading(false);
    }
  }, [watchId]);

  useEffect(() => {
    if (mode === 'edit' && watchId) {
      void loadImages();
    } else {
      setImages([]);
      setAddForm(EMPTY_FORM);
      setError(null);
    }
  }, [mode, watchId, loadImages]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!watchId) return;

    const url = addForm.url.trim();
    if (!url) {
      setError('La URL es requerida.');
      return;
    }
    const sortOrder = Number(addForm.sortOrder);
    if (!Number.isFinite(sortOrder) || sortOrder < 0) {
      setError('El orden debe ser 0 o mayor.');
      return;
    }

    setAdding(true);
    setError(null);
    try {
      await createWatchImage(watchId, {
        url,
        altText: addForm.altText.trim() || undefined,
        sortOrder,
        isPrimary: addForm.isPrimary,
      });
      setAddForm(EMPTY_FORM);
      await loadImages();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo agregar la imagen.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Galería de imágenes
        </p>
        {mode === 'create' ? (
          <p className="mt-1 text-xs text-muted/70">Guarda el reloj para agregar imágenes.</p>
        ) : (
          <p className="mt-1 text-xs text-muted/70">
            Pega URLs de imágenes. La principal se usa en listados y storefront.
          </p>
        )}
      </div>

      {mode === 'edit' && watchId ? (
        <>
          <form onSubmit={handleAdd} className="mb-4 grid gap-2 sm:grid-cols-2">
            <input
              value={addForm.url}
              onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="URL de imagen"
              className="ui-input text-sm sm:col-span-2"
            />
            <input
              value={addForm.altText}
              onChange={(e) => setAddForm((f) => ({ ...f, altText: e.target.value }))}
              placeholder="Texto alternativo (opcional)"
              className="ui-input text-sm"
            />
            <input
              type="number"
              min={0}
              value={addForm.sortOrder}
              onChange={(e) => setAddForm((f) => ({ ...f, sortOrder: e.target.value }))}
              placeholder="Orden"
              className="ui-input text-sm"
            />
            <label className="inline-flex items-center gap-2 text-xs text-muted sm:col-span-2">
              <input
                type="checkbox"
                checked={addForm.isPrimary}
                onChange={(e) => setAddForm((f) => ({ ...f, isPrimary: e.target.checked }))}
                className="h-4 w-4 rounded border-white/30 bg-surface"
              />
              Marcar como principal
            </label>
            <button
              type="submit"
              disabled={adding || loading}
              className="ui-btn-secondary px-3 py-2 text-sm sm:col-span-2 sm:w-fit"
            >
              {adding ? 'Agregando…' : 'Agregar imagen'}
            </button>
          </form>

          {error ? (
            <p className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {error}
            </p>
          ) : null}

          {loading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-24 rounded-lg bg-white/5" />
              <div className="h-24 rounded-lg bg-white/5" />
            </div>
          ) : images.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center">
              <p className="text-sm text-muted">Aún no hay imágenes para este reloj.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {images.map((image) => (
                <ImageCard
                  key={image.id}
                  image={image}
                  watchId={watchId}
                  busy={busyId}
                  onRefresh={async () => {
                    setBusyId(image.id);
                    try {
                      await loadImages();
                    } finally {
                      setBusyId(null);
                    }
                  }}
                  onError={setError}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
