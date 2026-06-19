'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiDelete, apiGet, apiPost, apiPatch, ApiError } from '@/lib/api-client';
import type { Watch, WatchExpense, WatchExpenseCategory } from '@/types/domain';

import { ImageUploader } from './ImageUploader';
import { WatchImageGallery } from './WatchImageGallery';
import {
  buildCreateWatchBody,
  buildUpdateWatchBody,
  defaultWatchFormValues,
  WATCH_OWNERSHIP_VALUES,
  WATCH_STATUS_VALUES,
  watchFormSchema,
  type CostCurrency,
  type WatchFormValues,
  watchToFormValues,
} from './watch-form-schema';

const EXPENSE_CATEGORIES: { value: WatchExpenseCategory; label: string }[] = [
  { value: 'POLISHING', label: 'Pulido' },
  { value: 'REPAIR', label: 'Reparación' },
  { value: 'LINKS', label: 'Eslabones' },
  { value: 'SHIPPING', label: 'Envío' },
  { value: 'PARTS', label: 'Partes' },
  { value: 'COMMISSIONS', label: 'Comisiones' },
  { value: 'TRAVEL', label: 'Viaje' },
];

type FxState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; rate: number }
  | { status: 'error' };

type Props = {
  mode: 'create' | 'edit';
  watch: Watch | null;
  open: boolean;
  onClose: () => void;
  onSaved: (payload: { mode: 'create' | 'edit' }) => void;
};

function fmtMxn(n: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(n);
}

export function WatchFormModal({ mode, watch, open, onClose, onSaved }: Props) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Expense state — persisted via API in edit mode, held locally in create mode
  const [expenses, setExpenses] = useState<WatchExpense[]>([]);
  const [expenseCategory, setExpenseCategory] = useState<WatchExpenseCategory>('REPAIR');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNotes, setExpenseNotes] = useState('');
  const [expenseAdding, setExpenseAdding] = useState(false);
  const [expenseRemoving, setExpenseRemoving] = useState<string | null>(null);
  const [expenseError, setExpenseError] = useState<string | null>(null);

  // FX rate state
  const [fx, setFx] = useState<FxState>({ status: 'idle' });
  const fxFetchedRef = useRef(false);

  const form = useForm<WatchFormValues>({
    resolver: zodResolver(watchFormSchema),
    defaultValues: defaultWatchFormValues,
  });

  const { register, handleSubmit, reset, watch: watchForm, formState, setValue, clearErrors } = form;
  const ownershipType = watchForm('ownershipType');
  const imageUrl = watchForm('imageUrl') ?? '';
  const costCurrency = watchForm('costCurrency');
  const costValue = watchForm('cost');
  const watchStatus = watchForm('status');
  const isPublished = watchForm('isPublished');
  const canPublish = watchStatus === 'AVAILABLE';

  // Determine if this is a legacy watch (costCurrency not set on existing record)
  const isLegacy = mode === 'edit' && watch != null && watch.costCurrency == null;

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setExpenseError(null);
    setExpenseAmount('');
    setExpenseNotes('');
    setExpenseCategory('REPAIR');
    fxFetchedRef.current = false;
    setFx({ status: 'idle' });
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

  useEffect(() => {
    if (!open || canPublish) return;
    setValue('isPublished', false);
    clearErrors(['publicSlug', 'publicPrice', 'reservationAmount']);
  }, [canPublish, open, setValue, clearErrors]);

  // Fetch FX rate when user selects USD (once per modal open)
  useEffect(() => {
    if (!open || costCurrency !== 'USD') return;
    if (fxFetchedRef.current) return;
    fxFetchedRef.current = true;
    setFx({ status: 'loading' });
    apiGet<{ rate: number }>('/fx/usd-mxn', { authenticated: true })
      .then((data) => setFx({ status: 'ok', rate: data.rate }))
      .catch(() => setFx({ status: 'error' }));
  }, [open, costCurrency]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (mode === 'create') {
        const newWatch = await apiPost<Watch>('/inventory', buildCreateWatchBody(values), {
          authenticated: true,
        });
        for (const expense of expenses) {
          await apiPost<WatchExpense>(
            `/inventory/${newWatch.id}/expenses`,
            {
              category: expense.category,
              amount: Number(expense.amount),
              notes: expense.notes ?? undefined,
            },
            { authenticated: true },
          );
        }
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
    if (!expenseAmount.trim()) return;
    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setExpenseError('Enter a valid amount.');
      return;
    }

    if (mode === 'create') {
      setExpenses((prev) => [
        ...prev,
        {
          id: `__local__${Date.now()}`,
          watchId: '',
          category: expenseCategory,
          amount: String(amount),
          notes: expenseNotes.trim() || null,
          createdAt: new Date().toISOString(),
        },
      ]);
      setExpenseAmount('');
      setExpenseNotes('');
      return;
    }

    if (!watch) return;
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
    if (mode === 'create') {
      setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
      return;
    }

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

  const title = mode === 'create' ? 'Agregar reloj al inventario' : 'Editar reloj';
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  // FX preview values
  const fxRate = fx.status === 'ok' ? fx.rate : null;
  const fxPreviewMxn =
    fxRate != null && costValue > 0 ? Math.round(costValue * fxRate * 100) / 100 : null;
  const usdDisabled = fx.status === 'error';

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
                ? 'Captura los detalles del listado. Puedes refinar después.'
                : 'Actualiza los detalles del listado para esta pieza.'}
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

          {/* Legacy warning */}
          {isLegacy ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 text-xs text-amber-200/80">
              Este reloj fue registrado sin moneda especificada. Se muestra como dólares (USD). Verifica el costo antes de guardar.
            </div>
          ) : null}

          {/* Brand / Model */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Marca
              </span>
              <input {...register('brand')} className="ui-input" autoComplete="off" />
              {formState.errors.brand ? (
                <p className="ui-error">{formState.errors.brand.message}</p>
              ) : null}
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Modelo
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
                Número de serie
              </span>
              <input
                {...register('serialNumber')}
                className="ui-input"
                placeholder="Opcional"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Condición
              </span>
              <input
                {...register('condition')}
                className="ui-input"
                placeholder="ej. Excelente, set completo"
              />
              {formState.errors.condition ? (
                <p className="ui-error">{formState.errors.condition.message}</p>
              ) : null}
            </label>
          </div>

          {/* Watch Image */}
          <div className="block text-sm">
            <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted">
              Imagen del reloj
            </span>
            <ImageUploader
              value={imageUrl}
              onChange={(url) => setValue('imageUrl', url, { shouldDirty: true })}
            />
            <p className="mt-1.5 text-xs text-muted/70">
              Se usa en el catálogo PDF generado. JPG, PNG o WEBP hasta 5 MB.
            </p>
          </div>

          <WatchImageGallery watchId={mode === 'edit' && watch ? watch.id : null} mode={mode} />

          {/* Cost with currency selector */}
          <div className="space-y-2">
            {/* Currency toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Moneda:
              </span>
              {(['MXN', 'USD'] as CostCurrency[]).map((cur) => (
                <button
                  key={cur}
                  type="button"
                  disabled={cur === 'USD' && usdDisabled}
                  onClick={() => {
                    setValue('costCurrency', cur, { shouldDirty: true });
                    // Fetch FX if switching to USD for the first time
                    if (cur === 'USD' && !fxFetchedRef.current) {
                      fxFetchedRef.current = true;
                      setFx({ status: 'loading' });
                      apiGet<{ rate: number }>('/fx/usd-mxn', { authenticated: true })
                        .then((data) => setFx({ status: 'ok', rate: data.rate }))
                        .catch(() => setFx({ status: 'error' }));
                    }
                  }}
                  className={`rounded-lg border px-3 py-1 text-xs font-semibold transition disabled:opacity-40 ${
                    costCurrency === cur
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-white/10 text-muted hover:border-white/20 hover:text-white'
                  }`}
                >
                  {cur === 'MXN' ? 'Pesos' : 'Dólares'}
                </button>
              ))}
              {fx.status === 'loading' && (
                <span className="text-xs text-white/30">Obteniendo tipo de cambio…</span>
              )}
              {fx.status === 'error' && (
                <span className="text-xs text-rose-400/80">Tipo de cambio no disponible</span>
              )}
              {fx.status === 'ok' && costCurrency === 'USD' && (
                <span className="text-xs text-white/30">
                  USD/MXN: {fx.rate.toFixed(2)}
                </span>
              )}
            </div>

            {/* Cost input */}
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                {costCurrency === 'USD' ? 'Costo base en dólares' : 'Costo base'}
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

            {/* Helper / FX preview */}
            {costCurrency === 'MXN' ? (
              <p className="text-xs text-muted/70">Se registrará en pesos.</p>
            ) : fxPreviewMxn != null ? (
              <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
                <p className="text-xs text-muted/70">Costo estimado en pesos:</p>
                <p className="mt-0.5 text-sm font-semibold text-white">
                  {fmtMxn(fxPreviewMxn)}
                </p>
                <p className="mt-0.5 text-xs text-white/30">
                  USD {new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(costValue)} × ${fxRate?.toFixed(2)}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted/70">
                Se convertirá automáticamente a pesos al guardar el reloj.
              </p>
            )}
          </div>

          {/* Price Range */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                Precio mínimo ({costCurrency === 'MXN' ? 'MXN' : 'USD'})
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
                Precio máximo ({costCurrency === 'MXN' ? 'MXN' : 'USD'})
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
                Estado
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
                Propiedad
              </span>
              <select {...register('ownershipType')} className="ui-input">
                {WATCH_OWNERSHIP_VALUES.map((o) => (
                  <option key={o} value={o}>
                    {o === 'OWNED' ? 'Propio' : 'Consignación'}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {ownershipType === 'CONSIGNMENT' ? (
            <div className="rounded-xl border border-accent/25 bg-accent/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-accent">
                Detalles de consignación
              </p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs text-muted">Nombre del propietario</span>
                  <input
                    {...register('consignmentOwnerName')}
                    className="ui-input"
                    placeholder="Nombre del consignatario"
                  />
                  {formState.errors.consignmentOwnerName ? (
                    <p className="ui-error">
                      {formState.errors.consignmentOwnerName.message}
                    </p>
                  ) : null}
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs text-muted">% de reparto</span>
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

          {/* Storefront publication */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Publicación
                </p>
                <p className="mt-0.5 text-xs text-muted/70">
                  Configura cómo aparece este reloj en la tienda pública.
                </p>
              </div>
              <label
                className={`inline-flex items-center gap-2 text-sm ${
                  canPublish ? 'text-white' : 'text-muted/60'
                }`}
              >
                <input
                  type="checkbox"
                  disabled={!canPublish}
                  checked={isPublished}
                  onChange={(event) =>
                    setValue('isPublished', event.target.checked, { shouldDirty: true })
                  }
                  className="h-4 w-4 rounded border-white/30 bg-surface disabled:opacity-40"
                />
                Publicar en tienda
              </label>
            </div>

            {!canPublish ? (
              <p className="mt-3 text-xs text-amber-200/80">
                Solo relojes disponibles pueden publicarse.
              </p>
            ) : null}

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1.5 block text-xs text-muted">Slug público</span>
                <input
                  {...register('publicSlug')}
                  className="ui-input font-mono text-sm"
                  placeholder="ej. rolex-submariner-date"
                  autoComplete="off"
                />
                {isPublished && formState.errors.publicSlug ? (
                  <p className="ui-error">{formState.errors.publicSlug.message}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted/60">
                    URL: /watches/tu-slug
                  </p>
                )}
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block text-xs text-muted">Precio público (MXN)</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  {...register('publicPrice', { valueAsNumber: true })}
                  className="ui-input"
                />
                {isPublished && formState.errors.publicPrice ? (
                  <p className="ui-error">{formState.errors.publicPrice.message}</p>
                ) : null}
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block text-xs text-muted">Apartado Stripe (MXN)</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  {...register('reservationAmount', { valueAsNumber: true })}
                  className="ui-input"
                />
                {isPublished && formState.errors.reservationAmount ? (
                  <p className="ui-error">{formState.errors.reservationAmount.message}</p>
                ) : null}
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1.5 block text-xs text-muted">Descripción pública</span>
                <textarea
                  {...register('publicDescription')}
                  rows={3}
                  className="ui-input min-h-[4.5rem] resize-y"
                  placeholder="Descripción para la tienda (opcional)"
                />
              </label>
            </div>
          </div>

          {/* Additional Costs */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">
                    Costos adicionales
                  </p>
                  {mode === 'create' && expenses.length === 0 ? (
                    <p className="mt-0.5 text-xs text-muted/60">
                      Reparación, envío, autenticación, etc. Se guardan con el reloj.
                    </p>
                  ) : null}
                </div>
                {totalExpenses > 0 ? (
                  <span className="text-xs tabular-nums text-white/70">
                    Total{' '}
                    <span className="font-semibold text-white">
                      {new Intl.NumberFormat('es-MX', {
                        style: 'currency',
                        currency: 'MXN',
                        currencyDisplay: 'narrowSymbol',
                        maximumFractionDigits: 0,
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
                            {new Intl.NumberFormat('es-MX', {
                              style: 'currency',
                              currency: 'MXN',
                              currencyDisplay: 'narrowSymbol',
                              maximumFractionDigits: 0,
                            }).format(Number(expense.amount))}
                          </span>
                          <button
                            type="button"
                            disabled={expenseRemoving === expense.id}
                            onClick={() => void handleRemoveExpense(expense.id)}
                            className="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-40"
                          >
                            {expenseRemoving === expense.id ? '…' : 'Quitar'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-muted/70">Sin costos adicionales registrados.</p>
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
                  placeholder="Monto"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  className="ui-input text-sm"
                />
                <input
                  type="text"
                  placeholder="Notas (opcional)"
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
                  {expenseAdding ? '…' : 'Agregar'}
                </button>
              </div>
            </div>

          <div className="flex justify-end gap-3 border-t border-white/10 pt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="ui-btn-ghost px-4 py-2"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || (costCurrency === 'USD' && usdDisabled)}
              className="ui-btn-primary px-5 py-2 disabled:opacity-60"
            >
              {submitting ? 'Guardando…' : mode === 'create' ? 'Crear reloj' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
