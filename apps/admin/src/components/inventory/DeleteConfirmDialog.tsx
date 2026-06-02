'use client';

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Eliminar',
  loading = false,
  onCancel,
  onConfirm,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-3 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-panel/95 p-4 shadow-2xl backdrop-blur sm:p-6">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm text-muted">{description}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="ui-btn-ghost px-4 py-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="ui-btn-danger bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500"
          >
            {loading ? 'Eliminando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
