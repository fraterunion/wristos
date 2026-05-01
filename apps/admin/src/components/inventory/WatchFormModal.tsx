'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiDelete, apiPost, apiPatch, ApiError } from '@/lib/api-client';
import type { Watch, WatchExpense, WatchExpenseCategory } from '@/types/domain';

import { ImageUploader } from './ImageUploader';
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

const EXPENSE_CATEGORIES: { value: WatchExpenseCategory; label: string }[] = [
  { value: 'POLISHING', label: 'Polishing' },
  { value: 'REPAIR', label: 'Repair' },
  { value: 'LINKS', label: 'Links' },
  { value: 'SHIPPING', label: 'Shipping' },
  { value: 'PARTS', label: 'Parts' },
  { value: 'COMMISSIONS', label: 'Commissions' },
  { value: 'TRAVEL', label: 'Travel' },
];

type Props = {
  mode: 'create' | 'edit';
  watch: Watch | null;
  open: boolean;
  onClose: () => void;
  onSaved: (payload: { mode: 'create' | 'edit' }) => void;
};

function formatMoney(value: string) {
  const n = Number(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

export function WatchFormModal({ mode, watch, open, onClose, onSaved }: Props) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Expense state (edit mode only)
  const [expenses, setExpenses] = useState<WatchExpense[]>([]);
  const [expenseCategory, setExpenseCategory] = useState<WatchExpenseCategory>('REPAIR');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNotes, setExpenseNotes] = useState('');
  const [expenseAdding, setExpenseAdding] = useState(false);
  const [expenseRemoving, setExpenseRemoving] = useState<string | null>(null);
  const [expenseError, setExpenseError] = useState<string | null>(null);

  const form = useForm<WatchFormValues>({
    resolver: zodResolver(watchFormSchema),
    defaultValues: defaultWatchFormValues,
  });

  const { register, handleSubmit, reset, watch: watchForm, formState, setValue, clearErrors } = form;
  const ownershipType = watchForm('ownershipType');
  const imageUrl = watchForm('imageUrl') ?? '';

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setExpenseError(null);
    setExpenseAmount('');
    setExpenseNotes('');
    setExpenseCategory('REPAIR');
    if (mode === 'edit' && watch) {
      reset(watchToFormValues(watch));
      setExpenses(watch.expenses ?? []);
    } else {
      reset(defaultWatchFormValues);
      setExpenses([]);
    }
  }, [open, mode, watch, reset]);

  useEffect(() => {
    if (!open) return;
    if (ownershipType !== 'OWNED') return;
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

  const handleAddExpense = async () => {
    if (!watch || !expenseAmount.trim()) return;
    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setExpenseError('Enter a valid amount.');
      return;
    }
    setExpenseAdding(true);
    setExpenseError(null);
    try {
      const created = await apiPost<WatchExpense>(
        `/inventory/${watch.id}/expenses`,
        { category: expenseCategory, amount, notes: expenseNotes.trim() || undefined },
        { authenticated: true },
      );
      setExpenses((prev) => [...prev, created]);
      setExpenseAmount('');
      setExpenseNotes('');
    } catch (err) {
      setExpenseError(err instanceof ApiError ? err.message : 'Could not add expense.');
    } finally {
      setExpenseAdding(false);
    }
  };

  const handleRemoveExpense = async (expenseId: string) => {
    if (!watch) return;
    setExpenseRemoving(expenseId);
    setExpenseError(null);
    try {
      await apiDelete(`/inventory/${watch.id}/expenses/${expenseId}`, {
        authenticated: true,
      });
      setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
    } catch (err) {
      setExpenseError(err instanceof ApiError ? err.message : 'Could not remove expense.');
    } finally {
      setExpenseRemoving(null);
    }
  };

  if (!open) return null;

  const title = mode === 'create' ? 'Add watch to inventory' : 'Edit watch';

  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-panel/95 shadow-2xl backdrop-blur sm:max-h-[90vh]">
        <div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-2 border-b border-white/10 bg-panel/95 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
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

        <form onSubmit={onSubmit} className="space-y-5 px-4 py-4 sm:px-6 sm:py-5">
          {submitError ? (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {submitError}
            </div>
          ) : null}

          {/* Brand / Model */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Brand
              </span>
              <input {...register('brand')} className="ui-input" autoComplete="off" />
              {formState.errors.brand ? (
                <p className="ui-error">{formState.errors.brand.message}</p>
              ) : null}
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Model
              </span>
              <input {...register('model')} className="ui-input" autoComplete="off" />
              {formState.errors.model ? (
                <p className="ui-error">{formState.errors.model.message}</p>
              ) : null}
            </label>
          </div>

          {/* Serial / Condition */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>

          {/* Watch Image */}
          <div className="block text-sm">
            <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted">
              Watch Image
            </span>
            <ImageUploader
              value={imageUrl}
              onChange={(url) => setValue('imageUrl', url, { shouldDirty: true })}
            />
            <p className="mt-1.5 text-xs text-muted/70">
              Used in the generated PDF catalog. JPG, PNG, or WEBP up to 5 MB.
            </p>
          </div>

          {/* Cost */}
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
              Base Cost (USD)
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

          {/* Price Range */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Min Price (USD)
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                {...register('priceMin', { valueAsNumber: true })}
                className="ui-input"
              />
              {formState.errors.priceMin ? (
                <p className="ui-error">{formState.errors.priceMin.message}</p>
              ) : null}
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Max Price (USD)
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                {...register('priceMax', { valueAsNumber: true })}
                className="ui-input"
              />
              {formState.errors.priceMax ? (
                <p className="ui-error">{formState.errors.priceMax.message}</p>
              ) : null}
            </label>
          </div>

          {/* Status / Ownership */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Status
              </span>
              <select {...register('status')} className="ui-input">
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
              <select {...register('ownershipType')} className="ui-input">
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

          {/* Additional Costs (edit mode only) */}
          {mode === 'edit' && watch ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Additional Costs
                </p>
                {totalExpenses > 0 ? (
                  <span className="text-xs tabular-nums text-white/70">
                    Total{' '}
                    <span className="font-semibold text-white">
                      {new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 2,
                      }).format(totalExpenses)}
                    </span>
                  </span>
                ) : null}
              </div>

              {expenses.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {expenses.map((expense) => {
                    const categoryLabel =
                      EXPENSE_CATEGORIES.find((c) => c.value === expense.category)?.label ??
                      expense.category;
                    return (
                      <li
                        key={expense.id}
                        className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <span className="font-medium text-white">{categoryLabel}</span>
                          {expense.notes ? (
                            <span className="ml-2 text-xs text-muted">{expense.notes}</span>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-3 pl-3">
                          <span className="tabular-nums text-white/80">
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: 'USD',
                              maximumFractionDigits: 2,
                            }).format(Number(expense.amount))}
                          </span>
                          <button
                            type="button"
                            disabled={expenseRemoving === expense.id}
                            onClick={() => void handleRemoveExpense(expense.id)}
                            className="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-40"
                          >
                            {expenseRemoving === expense.id ? '…' : 'Remove'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-muted/70">No additional costs recorded.</p>
              )}

              {expenseError ? (
                <p className="mt-2 text-xs text-rose-300">{expenseError}</p>
              ) : null}

              {/* Add expense form */}
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
                <select
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value as WatchExpenseCategory)}
                  className="ui-input text-sm"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="Amount"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  className="ui-input text-sm"
                />
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={expenseNotes}
                  onChange={(e) => setExpenseNotes(e.target.value)}
                  className="ui-input text-sm"
                />
                <button
                  type="button"
                  disabled={expenseAdding || !expenseAmount.trim()}
                  onClick={() => void handleAddExpense()}
                  className="ui-btn-secondary px-3 py-2 text-sm disabled:opacity-50"
                >
                  {expenseAdding ? '…' : 'Add'}
                </button>
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
