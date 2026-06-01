'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiGet, ApiError } from '@/lib/api-client';
import type { PaymentMethod, PaymentStatus, WatchOwnershipType, WatchStatus } from '@/types/domain';

// --- Types ---

type HistorySummary = {
  totalAcquired: number;
  totalSold: number;
  currentStock: number;
  totalRevenue: string;
  totalCostOfSold: string;
  totalProfit: string;
};

type SoldItem = {
  dealId: string;
  watch: {
    id: string;
    brand: string;
    model: string;
    serialNumber: string | null;
    condition: string;
    cost: string;
    effectiveCost: string;
    ownershipType: WatchOwnershipType;
    consignmentOwnerName: string | null;
    consignmentSplitPercentage: string | null;
  };
  buyer: { id: string; name: string; email: string | null; phone: string | null };
  agreedPrice: string;
  notes: string | null;
  soldAt: string;
  createdAt: string;
  payments: { id: string; amount: string; method: PaymentMethod; status: PaymentStatus; paidAt: string | null }[];
};

type StockWatch = {
  id: string;
  brand: string;
  model: string;
  serialNumber: string | null;
  condition: string;
  cost: string;
  priceMin: string;
  priceMax: string;
  effectiveCost: string;
  status: WatchStatus;
  ownershipType: WatchOwnershipType;
  consignmentOwnerName: string | null;
  createdAt: string;
  deletedAt: string | null;
};

type Movement = {
  dealId: string;
  stage: string;
  watch: { id: string; brand: string; model: string; serialNumber: string | null; status: WatchStatus };
  client: { id: string; name: string; email: string | null; phone: string | null };
  agreedPrice: string;
  notes: string | null;
  expectedCloseAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// --- Helpers ---

function formatMoney(value: string | number) {
  const n = Number(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function dash(value: string | null | undefined) {
  if (value === null || value === undefined || String(value).trim() === '') return '—';
  return value;
}

const STAGE_LABELS: Record<string, string> = {
  LEAD: 'Lead',
  INTERESTED: 'Interested',
  NEGOTIATING: 'Negotiating',
  PENDING_PAYMENT: 'Pending Payment',
  CLOSED_WON: 'Won',
  CLOSED_LOST: 'Lost',
};

const STAGE_COLORS: Record<string, string> = {
  LEAD: 'bg-white/8 text-white/50',
  INTERESTED: 'bg-white/8 text-white/60',
  NEGOTIATING: 'bg-amber-500/20 text-amber-300',
  PENDING_PAYMENT: 'bg-amber-500/20 text-amber-300',
  CLOSED_WON: 'bg-emerald-500/20 text-emerald-300',
  CLOSED_LOST: 'bg-rose-500/20 text-rose-300',
};

const STATUS_COLORS: Record<WatchStatus, string> = {
  AVAILABLE: 'bg-emerald-500/20 text-emerald-300',
  RESERVED: 'bg-amber-500/20 text-amber-300',
  SOLD: 'bg-white/8 text-white/50',
  IN_TRANSIT: 'bg-white/8 text-white/60',
  IN_SERVICE: 'bg-white/8 text-white/60',
};

type Tab = 'movements' | 'sold' | 'stock' | 'acquired';

const TABS: { id: Tab; label: string }[] = [
  { id: 'movements', label: 'Movements' },
  { id: 'sold', label: 'Sold' },
  { id: 'stock', label: 'In Stock' },
  { id: 'acquired', label: 'Acquired' },
];

// --- Page ---

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('movements');

  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [sold, setSold] = useState<SoldItem[]>([]);
  const [stock, setStock] = useState<StockWatch[]>([]);
  const [acquired, setAcquired] = useState<StockWatch[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, soldData, stockData, acquiredData, movementsData] = await Promise.all([
        apiGet<HistorySummary>('/history/summary', { authenticated: true }),
        apiGet<SoldItem[]>('/history/sold', { authenticated: true }),
        apiGet<StockWatch[]>('/history/stock', { authenticated: true }),
        apiGet<StockWatch[]>('/history/acquired', { authenticated: true }),
        apiGet<Movement[]>('/history/movements', { authenticated: true }),
      ]);
      setSummary(summaryData);
      setSold(soldData);
      setStock(stockData);
      setAcquired(acquiredData);
      setMovements(movementsData);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to load history right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">History</h1>
          <p className="ui-subtitle max-w-2xl">
            Complete record of every watch acquired, sold, and in movement — your business at a glance.
          </p>
        </div>
      </header>

      {/* Summary cards */}
      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Acquired" value={String(summary.totalAcquired)} />
          <StatCard label="Sold" value={String(summary.totalSold)} />
          <StatCard label="In Stock" value={String(summary.currentStock)} />
          <StatCard label="Revenue" value={formatMoney(summary.totalRevenue)} />
          <StatCard label="Cost of Sales" value={formatMoney(summary.totalCostOfSold)} />
          <StatCard
            label="Gross Profit"
            value={formatMoney(summary.totalProfit)}
            highlight={Number(summary.totalProfit) >= 0 ? 'positive' : 'negative'}
          />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-500/35 bg-rose-500/10 p-6">
          <h3 className="text-sm font-semibold text-rose-100">Could not load history</h3>
          <p className="mt-2 text-sm text-rose-100/90">{error}</p>
          <button type="button" onClick={() => void load()} className="ui-btn-danger mt-4 px-4 py-2 text-rose-50">
            Try again
          </button>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="border-b border-white/10">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-12 rounded-xl bg-white/10" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-white/5" />
          ))}
        </div>
      ) : null}

      {/* Movements tab */}
      {!loading && !error && activeTab === 'movements' ? (
        movements.length === 0 ? (
          <EmptyState message="No deal movements recorded yet." />
        ) : (
          <TableWrapper>
            <table className="min-w-[900px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-surface/80 text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Watch</th>
                  <th className="px-4 py-3 font-medium">Serial</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Stage</th>
                  <th className="px-4 py-3 font-medium text-right">Agreed Price</th>
                  <th className="px-4 py-3 font-medium">Last Update</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.dealId} className="border-b border-white/5 hover:bg-white/[0.05] transition duration-150">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{m.watch.brand}</div>
                      <div className="text-xs text-muted">{m.watch.model}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{dash(m.watch.serialNumber)}</td>
                    <td className="px-4 py-3">
                      <div className="text-white">{m.client.name}</div>
                      <div className="text-xs text-muted">{dash(m.client.email)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_COLORS[m.stage] ?? 'bg-zinc-500/20 text-zinc-300'}`}>
                        {STAGE_LABELS[m.stage] ?? m.stage}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-white">
                      {formatMoney(m.agreedPrice)}
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(m.updatedAt)}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrapper>
        )
      ) : null}

      {/* Sold tab */}
      {!loading && !error && activeTab === 'sold' ? (
        sold.length === 0 ? (
          <EmptyState message="No watches sold yet." />
        ) : (
          <TableWrapper>
            <table className="min-w-[960px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-surface/80 text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Watch</th>
                  <th className="px-4 py-3 font-medium">Buyer</th>
                  <th className="px-4 py-3 font-medium">Ownership</th>
                  <th className="px-4 py-3 font-medium text-right">Effective Cost</th>
                  <th className="px-4 py-3 font-medium text-right">Sale Price</th>
                  <th className="px-4 py-3 font-medium text-right">Margin</th>
                  <th className="px-4 py-3 font-medium">Sold</th>
                </tr>
              </thead>
              <tbody>
                {sold.map((item) => {
                  const effectiveCost = Number(item.watch.effectiveCost);
                  const margin = Number(item.agreedPrice) - effectiveCost;
                  const marginPct =
                    effectiveCost > 0
                      ? ((margin / effectiveCost) * 100).toFixed(1)
                      : '—';
                  return (
                    <tr key={item.dealId} className="border-b border-white/5 hover:bg-white/[0.05] transition duration-150">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{item.watch.brand}</div>
                        <div className="text-xs text-muted">{item.watch.model}</div>
                        <div className="font-mono text-xs text-muted/60">{dash(item.watch.serialNumber)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-white">{item.buyer.name}</div>
                        <div className="text-xs text-muted">{dash(item.buyer.email)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted">
                          {item.watch.ownershipType === 'CONSIGNMENT'
                            ? `Consignment${item.watch.consignmentOwnerName ? ` · ${item.watch.consignmentOwnerName}` : ''}`
                            : 'Owned'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted">
                        {formatMoney(item.watch.effectiveCost)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-white">
                        {formatMoney(item.agreedPrice)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={margin >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {formatMoney(margin)}
                          {marginPct !== '—' ? (
                            <span className="ml-1 text-xs opacity-70">({marginPct}%)</span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted">{formatDate(item.soldAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrapper>
        )
      ) : null}

      {/* In Stock tab */}
      {!loading && !error && activeTab === 'stock' ? (
        stock.length === 0 ? (
          <EmptyState message="No watches currently in stock." />
        ) : (
          <TableWrapper>
            <table className="min-w-[880px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-surface/80 text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Watch</th>
                  <th className="px-4 py-3 font-medium">Condition</th>
                  <th className="px-4 py-3 font-medium">Ownership</th>
                  <th className="px-4 py-3 font-medium text-right">Effective Cost</th>
                  <th className="px-4 py-3 font-medium text-right">Price Range</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Acquired</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((w) => (
                  <tr key={w.id} className="border-b border-white/5 hover:bg-white/[0.05] transition duration-150">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{w.brand}</div>
                      <div className="text-xs text-muted">{w.model}</div>
                      <div className="font-mono text-xs text-muted/60">{dash(w.serialNumber)}</div>
                    </td>
                    <td className="px-4 py-3 text-muted">{w.condition}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted">
                        {w.ownershipType === 'CONSIGNMENT'
                          ? `Consignment${w.consignmentOwnerName ? ` · ${w.consignmentOwnerName}` : ''}`
                          : 'Owned'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{formatMoney(w.effectiveCost)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-white">
                      {w.priceMin === w.priceMax
                        ? formatMoney(w.priceMin)
                        : `${formatMoney(w.priceMin)} – ${formatMoney(w.priceMax)}`}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[w.status]}`}>
                        {w.status.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(w.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrapper>
        )
      ) : null}

      {/* Acquired tab */}
      {!loading && !error && activeTab === 'acquired' ? (
        acquired.length === 0 ? (
          <EmptyState message="No watches acquired yet." />
        ) : (
          <TableWrapper>
            <table className="min-w-[880px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-surface/80 text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Watch</th>
                  <th className="px-4 py-3 font-medium">Condition</th>
                  <th className="px-4 py-3 font-medium">Ownership</th>
                  <th className="px-4 py-3 font-medium text-right">Effective Cost</th>
                  <th className="px-4 py-3 font-medium text-right">Price Range</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Acquired</th>
                </tr>
              </thead>
              <tbody>
                {acquired.map((w) => (
                  <tr
                    key={w.id}
                    className={`border-b border-white/5 transition duration-150 hover:bg-white/[0.05] ${w.deletedAt ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{w.brand}</div>
                      <div className="text-xs text-muted">{w.model}</div>
                      <div className="font-mono text-xs text-muted/60">{dash(w.serialNumber)}</div>
                    </td>
                    <td className="px-4 py-3 text-muted">{w.condition}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted">
                        {w.ownershipType === 'CONSIGNMENT'
                          ? `Consignment${w.consignmentOwnerName ? ` · ${w.consignmentOwnerName}` : ''}`
                          : 'Owned'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{formatMoney(w.effectiveCost)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-white">
                      {w.priceMin === w.priceMax
                        ? formatMoney(w.priceMin)
                        : `${formatMoney(w.priceMin)} – ${formatMoney(w.priceMax)}`}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[w.status]}`}>
                        {w.status.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(w.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrapper>
        )
      ) : null}
    </div>
  );
}

// --- Sub-components ---

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: 'positive' | 'negative';
}) {
  return (
    <div className="ui-card py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-1.5 text-xl font-semibold tabular-nums ${
          highlight === 'positive'
            ? 'text-emerald-400'
            : highlight === 'negative'
              ? 'text-rose-400'
              : 'text-white'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function TableWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="ui-card overflow-hidden p-0">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-panel/50 px-4 py-12 text-center">
      <p className="text-base font-medium text-white">{message}</p>
      <p className="mt-2 text-sm text-muted">Data will appear here once activity is recorded.</p>
    </div>
  );
}
