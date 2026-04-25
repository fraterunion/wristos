'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import {
  ExpenseCategorySummary,
  ExpensesSummary,
  OperatingExpense,
  OperatingExpenseCategory,
} from '@/types/domain';

const ALL_CATEGORIES: OperatingExpenseCategory[] = [
  'GASOLINE',
  'TOLLS',
  'WATCHMAKER',
  'PARKING',
  'MEALS',
  'FLIGHTS',
  'TRAVEL',
  'MARKETING',
  'COMMISSIONS',
];

const CATEGORY_LABELS: Record<OperatingExpenseCategory, string> = {
  GASOLINE: 'Gasoline',
  TOLLS: 'Tolls',
  WATCHMAKER: 'Watchmaker',
  PARKING: 'Parking',
  MEALS: 'Meals',
  FLIGHTS: 'Flights',
  TRAVEL: 'Travel / Per Diem',
  MARKETING: 'Instagram Ads / Marketing',
  COMMISSIONS: 'Commissions',
};

type Filters = {
  year: string;
  month: string;
  day: string;
  category: string;
  startDate: string;
  endDate: string;
};

const EMPTY_FILTERS: Filters = {
  year: '',
  month: '',
  day: '',
  category: '',
  startDate: '',
  endDate: '',
};

type ExpenseForm = {
  category: OperatingExpenseCategory | '';
  amount: string;
  notes: string;
  expenseDate: string;
};

const EMPTY_FORM: ExpenseForm = {
  category: '',
  amount: '',
  notes: '',
  expenseDate: new Date().toISOString().split('T')[0],
};

function formatCurrency(value: string | number) {
  const n = Number(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function buildQuery(filters: Filters): Record<string, string> {
  const q: Record<string, string> = {};
  if (filters.startDate) { q.startDate = filters.startDate; q.endDate = filters.endDate || filters.startDate; }
  else if (filters.year) {
    q.year = filters.year;
    if (filters.month) { q.month = filters.month; }
    if (filters.day) { q.day = filters.day; }
  }
  if (filters.category) q.category = filters.category;
  return q;
}

function SummaryCard({
  label,
  value,
  tone = 'default',
  sub,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'gold' | 'red' | 'muted';
  sub?: string;
}) {
  const colors: Record<string, string> = {
    default: 'text-white',
    gold: 'text-amber-300',
    red: 'text-rose-300',
    muted: 'text-muted',
  };
  return (
    <article className="rounded-xl border border-white/10 bg-panel p-5">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-3 text-2xl font-semibold ${colors[tone]}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </article>
  );
}

function CategoryBar({ row, maxTotal }: { row: ExpenseCategorySummary; maxTotal: number }) {
  const pct = maxTotal > 0 ? (Number(row.total) / maxTotal) * 100 : 0;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/8 bg-surface px-3 py-2.5">
      <div className="w-36 shrink-0">
        <span
          className={`text-sm font-medium ${row.isCommission ? 'text-amber-300' : 'text-white'}`}
        >
          {CATEGORY_LABELS[row.category as OperatingExpenseCategory] ?? row.category}
        </span>
        {row.isCommission && (
          <span className="ml-1.5 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            commission
          </span>
        )}
      </div>
      <div className="flex-1">
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full ${row.isCommission ? 'bg-amber-400' : 'bg-accent'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="w-20 text-right text-sm font-semibold text-white">
        {formatCurrency(row.total)}
      </div>
      <div className="w-12 text-right text-xs text-muted">{row.percentage}%</div>
      <div className="w-10 text-right text-xs text-muted">{row.count}×</div>
    </div>
  );
}

type ModalMode = 'add' | 'edit';

export default function ExpensesPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [summary, setSummary] = useState<ExpensesSummary | null>(null);
  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>('add');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchData = useCallback(async (f: Filters) => {
    setIsLoading(true);
    setError(null);
    const q = buildQuery(f);
    try {
      const [sum, list] = await Promise.all([
        apiGet<ExpensesSummary>('/expenses/summary', { authenticated: true, query: q }),
        apiGet<OperatingExpense[]>('/expenses', { authenticated: true, query: q }),
      ]);
      setSummary(sum);
      setExpenses(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load expenses.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData(appliedFilters);
  }, [appliedFilters, fetchData]);

  function applyFilters() {
    setAppliedFilters({ ...filters });
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalMode('add');
    setEditingId(null);
    setModalOpen(true);
  }

  function openEdit(expense: OperatingExpense) {
    setForm({
      category: expense.category,
      amount: expense.amount,
      notes: expense.notes ?? '',
      expenseDate: expense.expenseDate,
    });
    setFormError(null);
    setModalMode('edit');
    setEditingId(expense.id);
    setModalOpen(true);
  }

  async function submitForm() {
    if (!form.category) { setFormError('Category is required.'); return; }
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) < 0) {
      setFormError('Enter a valid amount.');
      return;
    }
    if (!form.expenseDate) { setFormError('Date is required.'); return; }

    setFormLoading(true);
    setFormError(null);
    try {
      const body = {
        category: form.category,
        amount: Number(form.amount),
        notes: form.notes || undefined,
        expenseDate: form.expenseDate,
      };

      if (modalMode === 'add') {
        await apiPost<OperatingExpense>('/expenses', body, { authenticated: true });
      } else if (editingId) {
        await apiPatch<OperatingExpense>(`/expenses/${editingId}`, body, { authenticated: true });
      }

      setModalOpen(false);
      void fetchData(appliedFilters);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save expense.');
    } finally {
      setFormLoading(false);
    }
  }

  async function deleteExpense(id: string) {
    setDeletingId(id);
    try {
      await apiDelete(`/expenses/${id}`, { authenticated: true });
      void fetchData(appliedFilters);
    } catch {
      // silently ignore — record still visible
    } finally {
      setDeletingId(null);
    }
  }

  const maxCategoryTotal =
    summary && summary.byCategory.length > 0
      ? Math.max(...summary.byCategory.map((r) => Number(r.total)))
      : 1;

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const months = [
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ];

  return (
    <section className="ui-page">
      {/* Header */}
      <header className="ui-page-header">
        <div>
          <h2 className="ui-title">Expenses</h2>
          <p className="ui-subtitle">
            Track operating costs, commissions, and business spend.
          </p>
        </div>
        <button type="button" className="ui-btn-primary px-4 py-2" onClick={openAdd}>
          + Add Expense
        </button>
      </header>

      {/* Filters */}
      <section className="rounded-xl border border-white/10 bg-panel p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Year</label>
            <select
              className="ui-select w-28"
              value={filters.year}
              onChange={(e) => setFilters((f) => ({ ...f, year: e.target.value, startDate: '', endDate: '' }))}
            >
              <option value="">All years</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Month</label>
            <select
              className="ui-select w-36"
              value={filters.month}
              onChange={(e) => setFilters((f) => ({ ...f, month: e.target.value }))}
              disabled={!filters.year}
            >
              <option value="">All months</option>
              {months.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Day</label>
            <input
              type="number"
              min={1}
              max={31}
              placeholder="1–31"
              className="ui-input w-20"
              value={filters.day}
              onChange={(e) => setFilters((f) => ({ ...f, day: e.target.value }))}
              disabled={!filters.month}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">From</label>
            <input
              type="date"
              className="ui-input w-36"
              value={filters.startDate}
              onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value, year: '', month: '', day: '' }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">To</label>
            <input
              type="date"
              className="ui-input w-36"
              value={filters.endDate}
              onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Category</label>
            <select
              className="ui-select w-48"
              value={filters.category}
              onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
            >
              <option value="">All categories</option>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>
          <button type="button" className="ui-btn-primary px-4 py-2" onClick={applyFilters}>
            Apply
          </button>
          <button type="button" className="ui-btn-secondary px-4 py-2" onClick={resetFilters}>
            Reset
          </button>
        </div>
      </section>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-white/10" />
            ))}
          </div>
          <div className="h-64 rounded-xl bg-white/10" />
          <div className="h-64 rounded-xl bg-white/10" />
        </div>
      ) : error ? (
        <section className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
          <h3 className="font-semibold text-red-100">Failed to load expenses</h3>
          <p className="mt-1 text-sm text-red-200/80">{error}</p>
          <button
            type="button"
            className="mt-3 rounded-md border border-red-400/50 px-3 py-2 text-sm text-red-100 hover:bg-red-400/20"
            onClick={() => void fetchData(appliedFilters)}
          >
            Retry
          </button>
        </section>
      ) : (
        <>
          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
              <SummaryCard
                label="Total Operating"
                value={formatCurrency(summary.totalOperatingExpenses)}
                tone="default"
              />
              <SummaryCard
                label="Commissions"
                value={formatCurrency(summary.totalCommissions)}
                tone="gold"
                sub="Tracked separately"
              />
              <SummaryCard
                label="Total Spend"
                value={formatCurrency(summary.totalSpend)}
                tone="red"
              />
              <SummaryCard
                label="Biggest Category"
                value={
                  summary.biggestCategory
                    ? (CATEGORY_LABELS[summary.biggestCategory as OperatingExpenseCategory] ??
                      summary.biggestCategory)
                    : '—'
                }
                tone="muted"
              />
              <SummaryCard
                label="Total Records"
                value={String(summary.expenseCount)}
                tone="muted"
              />
            </div>
          )}

          {/* Category breakdown */}
          {summary && summary.byCategory.length > 0 && (
            <section className="ui-card">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold">Spend by Category</h3>
                <span className="text-xs text-muted">
                  Commissions tracked separately below
                </span>
              </div>

              {/* Operating categories */}
              <div className="space-y-2">
                {summary.byCategory
                  .filter((r) => !r.isCommission)
                  .map((row) => (
                    <CategoryBar key={row.category} row={row} maxTotal={maxCategoryTotal} />
                  ))}
              </div>

              {/* Commissions separator */}
              {summary.byCategory.some((r) => r.isCommission) && (
                <>
                  <div className="my-4 flex items-center gap-3">
                    <div className="flex-1 border-t border-amber-400/20" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                      Commissions
                    </span>
                    <div className="flex-1 border-t border-amber-400/20" />
                  </div>
                  <div className="space-y-2">
                    {summary.byCategory
                      .filter((r) => r.isCommission)
                      .map((row) => (
                        <CategoryBar key={row.category} row={row} maxTotal={maxCategoryTotal} />
                      ))}
                  </div>
                </>
              )}
            </section>
          )}

          {/* Records table */}
          <section className="ui-card">
            <h3 className="mb-4 text-base font-semibold">Expense Records</h3>
            {expenses.length === 0 ? (
              <p className="text-sm text-muted">
                No expenses found. Add one with the button above.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-muted">
                      <th className="pb-2 text-left font-medium">Date</th>
                      <th className="pb-2 text-left font-medium">Category</th>
                      <th className="pb-2 text-right font-medium">Amount</th>
                      <th className="pb-2 text-left font-medium pl-4">Notes</th>
                      <th className="pb-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {expenses.map((exp) => (
                      <tr key={exp.id} className="group">
                        <td className="py-3 text-muted">{formatDate(exp.expenseDate)}</td>
                        <td className="py-3">
                          <span
                            className={`font-medium ${
                              exp.category === 'COMMISSIONS'
                                ? 'text-amber-300'
                                : 'text-white'
                            }`}
                          >
                            {CATEGORY_LABELS[exp.category]}
                          </span>
                          {exp.category === 'COMMISSIONS' && (
                            <span className="ml-2 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                              commission
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-right font-semibold">
                          {formatCurrency(exp.amount)}
                        </td>
                        <td className="py-3 pl-4 text-muted">
                          {exp.notes ?? <span className="text-white/20">—</span>}
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex justify-end gap-2 opacity-0 transition group-hover:opacity-100">
                            <button
                              type="button"
                              className="rounded-md px-2 py-1 text-xs text-muted hover:bg-white/10 hover:text-white"
                              onClick={() => openEdit(exp)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="rounded-md px-2 py-1 text-xs text-rose-400 hover:bg-rose-400/10"
                              disabled={deletingId === exp.id}
                              onClick={() => void deleteExpense(exp.id)}
                            >
                              {deletingId === exp.id ? '…' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-panel p-6 shadow-2xl">
            <h3 className="text-lg font-semibold">
              {modalMode === 'add' ? 'Add Expense' : 'Edit Expense'}
            </h3>

            <div className="mt-5 space-y-4">
              <div>
                <label className="block text-xs text-muted mb-1.5">Category</label>
                <select
                  className="ui-select w-full"
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value as OperatingExpenseCategory }))
                  }
                >
                  <option value="">Select category…</option>
                  {ALL_CATEGORIES.filter((c) => c !== 'COMMISSIONS').map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                  <optgroup label="────────────────">
                    <option value="COMMISSIONS">{CATEGORY_LABELS.COMMISSIONS}</option>
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="block text-xs text-muted mb-1.5">Amount (USD)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  className="ui-input w-full"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-xs text-muted mb-1.5">Date</label>
                <input
                  type="date"
                  className="ui-input w-full"
                  value={form.expenseDate}
                  onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-xs text-muted mb-1.5">Notes (optional)</label>
                <textarea
                  rows={2}
                  placeholder="Description or notes…"
                  className="ui-input w-full resize-none"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>

              {formError && (
                <p className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300">
                  {formError}
                </p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="ui-btn-secondary px-4 py-2"
                onClick={() => setModalOpen(false)}
                disabled={formLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ui-btn-primary px-4 py-2"
                onClick={() => void submitForm()}
                disabled={formLoading}
              >
                {formLoading ? 'Saving…' : modalMode === 'add' ? 'Add Expense' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
