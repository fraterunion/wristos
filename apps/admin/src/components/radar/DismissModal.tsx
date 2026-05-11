'use client';

import { useEffect, useState } from 'react';

type Props = {
  open: boolean;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

export function DismissModal({ open, loading, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) setReason('');
  }, [open]);

  if (!open) return null;

  const handleConfirm = () => onConfirm(reason.trim());

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-3 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-panel/95 p-4 shadow-2xl backdrop-blur sm:p-6">
        <h3 className="text-lg font-semibold text-white">Dismiss listing</h3>
        <p className="mt-1 text-sm text-muted">
          Reason is optional — it will be appended to dealer notes.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Duplicate, already handled"
          rows={3}
          className="ui-input mt-4 resize-none"
          disabled={loading}
          autoFocus
        />
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="ui-btn-ghost px-4 py-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="ui-btn-danger bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
          >
            {loading ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      </div>
    </div>
  );
}
