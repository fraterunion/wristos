'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiPatch, apiPost, ApiError } from '@/lib/api-client';
import type { Watch } from '@/types/domain';

import {
  buildCreateWatchBody,
  buildUpdateWatchBody,
  defaultWatchFormValues,
  WATCH_OWNERSHIP_VALUES,
  WATCH_STATUS_VALUES,
  watchFormSchema,
  type WatchFormValues,
  watchToFormValues,
} from './watch-form-schema';

type Props = {
  mode: 'create' | 'edit';
  watch: Watch | null;
  open: boolean;
  onClose: () => void;
  onSaved: (payload: { mode: 'create' | 'edit' }) => void;
};

export function WatchFormModal({ mode, watch, open, onClose, onSaved }: Props) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<WatchFormValues>({
    resolver: zodResolver(watchFormSchema),
    defaultValues: defaultWatchFormValues,
  });

  const { register, handleSubmit, reset, watch: watchForm, formState, setValue, clearErrors } = form;
  const ownershipType = watchForm('ownershipType');

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    if (mode === 'edit' && watch) {
      reset(watchToFormValues(watch));
    } else {
      reset(defaultWatchFormValues);
    }
  }, [open, mode, watch, reset]);

  useEffect(() => {
    if (!open) return;
    if (ownershipType !== 'OWNED') return;

    // Hidden consignment fields should never block submit when ownership is OWNED.
    setValue('consignmentOwnerName', '');
    setValue('consignmentSplitPercentage', '');
    clearErrors(['consignmentOwnerName', 'consignmentSplitPercentage']);
  }, [ownershipType, open, setValue, clearErrors]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (mode === 'create') {
        await apiPost<Watch>('/inventory', buildCreateWatchBody(values), {
          authenticated: true,
        });
      } else if (watch) {
        await apiPatch<Watch>(`/inventory/${watch.id}`, buildUpdateWatchBody(values), {
          authenticated: true,
        });
      }
      onSaved({ mode });
      onClose();
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  });

  if (!open) return null;

  const title = mode === 'create' ? 'Add watch to inventory' : 'Edit watch';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-panel/95 shadow-2xl backdrop-blur">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-white/10 bg-panel/95 px-6 py-4 backdrop-blur">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <p className="mt-0.5 text-sm text-muted">
              {mode === 'create'
                ? 'Capture core listing details. You can refine later.'
                : 'Update listing details for this timepiece.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn-ghost rounded-lg p-2"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-5 px-6 py-5">
          {submitError ? (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {submitError}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Brand
              </span>
              <input
                {...register('brand')}
                className="ui-input"
                autoComplete="off"
              />
              {formState.errors.brand ? (
                <p className="ui-error">{formState.errors.brand.message}</p>
              ) : null}
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Model
              </span>
              <input
                {...register('model')}
                className="ui-input"
                autoComplete="off"
              />
              {formState.errors.model ? (
                <p className="ui-error">{formState.errors.model.message}</p>
              ) : null}
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Reference
              </span>
              <input
                {...register('reference')}
                className="ui-input"
                placeholder="Optional"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Serial number
              </span>
              <input
                {...register('serialNumber')}
                className="ui-input"
                placeholder="Optional"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
              Condition
            </span>
            <input
              {...register('condition')}
              className="ui-input"
              placeholder="e.g. Excellent, Full set"
            />
            {formState.errors.condition ? (
              <p className="ui-error">{formState.errors.condition.message}</p>
            ) : null}
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Cost (USD)
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                {...register('cost', { valueAsNumber: true })}
                className="ui-input"
              />
              {formState.errors.cost ? (
                <p className="ui-error">{formState.errors.cost.message}</p>
              ) : null}
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Price (USD)
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                {...register('price', { valueAsNumber: true })}
                className="ui-input"
              />
              {formState.errors.price ? (
                <p className="ui-error">{formState.errors.price.message}</p>
              ) : null}
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Status
              </span>
              <select
                {...register('status')}
                className="ui-input"
              >
                {WATCH_STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Ownership
              </span>
              <select
                {...register('ownershipType')}
                className="ui-input"
              >
                {WATCH_OWNERSHIP_VALUES.map((o) => (
                  <option key={o} value={o}>
                    {o === 'OWNED' ? 'Owned' : 'Consignment'}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {ownershipType === 'CONSIGNMENT' ? (
            <div className="rounded-xl border border-accent/25 bg-accent/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-accent">
                Consignment details
              </p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs text-muted">Owner name</span>
                  <input
                    {...register('consignmentOwnerName')}
                    className="ui-input"
                    placeholder="Consignor name"
                  />
                  {formState.errors.consignmentOwnerName ? (
                    <p className="ui-error">
                      {formState.errors.consignmentOwnerName.message}
                    </p>
                  ) : null}
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs text-muted">Split %</span>
                  <input
                    {...register('consignmentSplitPercentage')}
                    className="ui-input"
                    placeholder="0–100"
                  />
                  {formState.errors.consignmentSplitPercentage ? (
                    <p className="ui-error">
                      {formState.errors.consignmentSplitPercentage.message}
                    </p>
                  ) : null}
                </label>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-3 border-t border-white/10 pt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="ui-btn-ghost px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="ui-btn-primary px-5 py-2"
            >
              {submitting ? 'Saving…' : mode === 'create' ? 'Create watch' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
