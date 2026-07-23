'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';

import { ApiError } from '@/lib/api-client';
import {
  fetchPdfFileBlob,
  getDocumentExtraction,
  updateDocumentExtraction,
} from '@/lib/data-onboarding-api';
import {
  clientSideCalculatedProfit,
  emptyHistoricalSale,
  filterSalesByStatus,
  hasProfitMismatch,
  saleMatchesSearch,
  type SalesExtractionFilter,
} from '@/lib/sales-onboarding-helpers';
import type {
  DataImportSessionDetail,
  DocumentExtractionResponse,
  HistoricalSaleExtraction,
  HistoricalSalesExtraction,
} from '@/types/data-onboarding';

function isSalesExtraction(
  extraction: DocumentExtractionResponse['extraction'] | undefined,
): extraction is HistoricalSalesExtraction {
  return Boolean(extraction && 'sales' in extraction);
}

const CURRENCY_OPTIONS = ['', 'MXN', 'USD'] as const;

const REVIEW_FILTERS: Array<{ value: SalesExtractionFilter; label: string }> = [
  { value: 'ALL', label: 'Todas' },
  { value: 'MISSING_PRICE', label: 'Sin precio' },
  { value: 'COMPLETE', label: 'Completas' },
];

type EditableNumberKey =
  | 'cost'
  | 'salePrice'
  | 'extras'
  | 'reportedProfit'
  | 'paymentCount';

type EditableStringKey =
  | 'saleDate'
  | 'customerName'
  | 'brand'
  | 'model'
  | 'reference'
  | 'serialNumber'
  | 'notes';

type EditableCurrencyKey =
  | 'costCurrency'
  | 'saleCurrency'
  | 'extrasCurrency'
  | 'reportedProfitCurrency';

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function SaleFieldInput({
  label,
  value,
  onChange,
  type = 'text',
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'number' | 'date';
  disabled?: boolean;
}) {
  return (
    <label className="block text-[10px] text-muted">
      {label}
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-md border border-white/15 bg-surface px-2 py-1 text-xs text-white focus:outline-none focus:border-white/30 disabled:opacity-40"
      />
    </label>
  );
}

function SaleCurrencySelect({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: '' | 'MXN' | 'USD') => void;
  disabled?: boolean;
}) {
  return (
    <label className="block text-[10px] text-muted">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as '' | 'MXN' | 'USD')}
        className="mt-0.5 w-full rounded-md border border-white/15 bg-surface px-2 py-1 text-xs text-white focus:outline-none focus:border-white/30 disabled:opacity-40"
      >
        {CURRENCY_OPTIONS.map((c) => (
          <option key={c || 'empty'} value={c}>
            {c || '—'}
          </option>
        ))}
      </select>
    </label>
  );
}

function SaleExtractionCard({
  sale,
  index,
  disabled,
  onChange,
  onDelete,
}: {
  sale: HistoricalSaleExtraction;
  index: number;
  disabled: boolean;
  onChange: (patch: Partial<HistoricalSaleExtraction>) => void;
  onDelete: () => void;
}) {
  const calculated = clientSideCalculatedProfit(sale);
  const mismatch = hasProfitMismatch(sale);
  const confidence = sale.confidence?.overall;

  const setString = (key: EditableStringKey, raw: string) => {
    onChange({ [key]: raw.trim() ? raw : null });
  };

  const setNumber = (key: EditableNumberKey, raw: string) => {
    onChange({ [key]: parseOptionalNumber(raw) });
  };

  const setCurrency = (key: EditableCurrencyKey, raw: '' | 'MXN' | 'USD') => {
    onChange({ [key]: raw || null });
  };

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">Venta #{index + 1}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {confidence != null ? (
              <span className="rounded px-1.5 py-0.5 text-[10px] bg-white/10 text-white/70">
                Confianza {(confidence * (confidence <= 1 ? 100 : 1)).toFixed(0)}%
              </span>
            ) : null}
            {mismatch ? (
              <span className="rounded px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-200">
                PROFIT_MISMATCH
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onDelete}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-rose-300 disabled:opacity-40"
          title="Eliminar esta venta"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Eliminar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SaleFieldInput
          label="Fecha"
          type="date"
          value={sale.saleDate ?? ''}
          disabled={disabled}
          onChange={(v) => setString('saleDate', v)}
        />
        <SaleFieldInput
          label="Cliente"
          value={sale.customerName ?? ''}
          disabled={disabled}
          onChange={(v) => setString('customerName', v)}
        />
        <SaleFieldInput
          label="Marca"
          value={sale.brand ?? ''}
          disabled={disabled}
          onChange={(v) => setString('brand', v)}
        />
        <SaleFieldInput
          label="Modelo"
          value={sale.model ?? ''}
          disabled={disabled}
          onChange={(v) => setString('model', v)}
        />
        <SaleFieldInput
          label="Referencia"
          value={sale.reference ?? ''}
          disabled={disabled}
          onChange={(v) => setString('reference', v)}
        />
        <SaleFieldInput
          label="Serie"
          value={sale.serialNumber ?? ''}
          disabled={disabled}
          onChange={(v) => setString('serialNumber', v)}
        />
        <SaleFieldInput
          label="Costo"
          type="number"
          value={sale.cost == null ? '' : String(sale.cost)}
          disabled={disabled}
          onChange={(v) => setNumber('cost', v)}
        />
        <SaleCurrencySelect
          label="Moneda costo"
          value={sale.costCurrency ?? ''}
          disabled={disabled}
          onChange={(v) => setCurrency('costCurrency', v)}
        />
        <SaleFieldInput
          label="Precio venta"
          type="number"
          value={sale.salePrice == null ? '' : String(sale.salePrice)}
          disabled={disabled}
          onChange={(v) => setNumber('salePrice', v)}
        />
        <SaleCurrencySelect
          label="Moneda venta"
          value={sale.saleCurrency ?? ''}
          disabled={disabled}
          onChange={(v) => setCurrency('saleCurrency', v)}
        />
        <SaleFieldInput
          label="Extras"
          type="number"
          value={sale.extras == null ? '' : String(sale.extras)}
          disabled={disabled}
          onChange={(v) => setNumber('extras', v)}
        />
        <SaleCurrencySelect
          label="Moneda extras"
          value={sale.extrasCurrency ?? ''}
          disabled={disabled}
          onChange={(v) => setCurrency('extrasCurrency', v)}
        />
        <SaleFieldInput
          label="Utilidad reportada"
          type="number"
          value={sale.reportedProfit == null ? '' : String(sale.reportedProfit)}
          disabled={disabled}
          onChange={(v) => setNumber('reportedProfit', v)}
        />
        <SaleCurrencySelect
          label="Moneda utilidad"
          value={sale.reportedProfitCurrency ?? ''}
          disabled={disabled}
          onChange={(v) => setCurrency('reportedProfitCurrency', v)}
        />
        <SaleFieldInput
          label="Cantidad de pagos"
          type="number"
          value={sale.paymentCount == null ? '' : String(sale.paymentCount)}
          disabled={disabled}
          onChange={(v) => setNumber('paymentCount', v)}
        />
        <label className="block text-[10px] text-muted col-span-2">
          Notas
          <textarea
            value={sale.notes ?? ''}
            disabled={disabled}
            rows={2}
            onChange={(e) => setString('notes', e.target.value)}
            className="mt-0.5 w-full rounded-md border border-white/15 bg-surface px-2 py-1 text-xs text-white focus:outline-none focus:border-white/30 disabled:opacity-40"
          />
        </label>
      </div>

      <p className="mt-3 text-[11px] text-muted">
        Utilidad calculada:{' '}
        <span className="text-white/80">
          {calculated == null ? '—' : calculated.toLocaleString('es-MX')}
        </span>
        {sale.reportedProfit != null ? (
          <>
            {' '}
            · Reportada:{' '}
            <span className="text-white/80">{sale.reportedProfit.toLocaleString('es-MX')}</span>
          </>
        ) : null}
      </p>
    </section>
  );
}

export function SalesExtractionReviewStep({
  session,
  onValidate,
  onReprocess,
}: {
  session: DataImportSessionDetail;
  onValidate: () => Promise<void>;
  onReprocess: () => Promise<void>;
}) {
  const pdfFile = session.files.find((f) => f.fileType === 'PDF');
  const [extraction, setExtraction] = useState<DocumentExtractionResponse | null>(null);
  const [localSales, setLocalSales] = useState<HistoricalSaleExtraction[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SalesExtractionFilter>('ALL');
  const blobUrlRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const resp = await getDocumentExtraction(session.id);
        setExtraction(resp);
        setLocalSales(isSalesExtraction(resp.extraction) ? resp.extraction.sales : []);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Error cargando la extracción.');
      }
    })();
  }, [session.id]);

  useEffect(() => {
    if (!pdfFile) return;
    void (async () => {
      try {
        const blob = await fetchPdfFileBlob(session.id, pdfFile.id);
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setPdfUrl(url);
      } catch {
        /* preview optional */
      }
    })();
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, [session.id, pdfFile]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const persistSales = async (sales: HistoricalSaleExtraction[]) => {
    if (!isSalesExtraction(extraction?.extraction) && !extraction) return;
    const base = isSalesExtraction(extraction?.extraction)
      ? extraction!.extraction
      : { sales: [], extractionVersion: 'v1' };
    const updated: HistoricalSalesExtraction = { ...base, sales };
    setSaving(true);
    setError(null);
    try {
      await updateDocumentExtraction(session.id, updated);
      setExtraction((prev) =>
        prev ? { ...prev, extraction: updated, saleCount: updated.sales.length } : prev,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al actualizar.');
    } finally {
      setSaving(false);
    }
  };

  const schedulePersist = (sales: HistoricalSaleExtraction[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persistSales(sales);
    }, 450);
  };

  const updateSaleAt = (index: number, patch: Partial<HistoricalSaleExtraction>) => {
    setLocalSales((prev) => {
      const next = prev.map((s, i) => (i === index ? { ...s, ...patch } : s));
      schedulePersist(next);
      return next;
    });
  };

  const handleDeleteSale = (index: number) => {
    setLocalSales((prev) => {
      const next = prev.filter((_, i) => i !== index);
      void persistSales(next);
      return next;
    });
  };

  const handleAddSale = () => {
    setLocalSales((prev) => {
      const next = [...prev, emptyHistoricalSale()];
      void persistSales(next);
      return next;
    });
  };

  const visibleSales = useMemo(() => {
    const filtered = filterSalesByStatus(localSales, filter);
    return filtered
      .map((sale) => ({ sale, index: localSales.indexOf(sale) }))
      .filter(({ sale }) => saleMatchesSearch(sale, search));
  }, [localSales, filter, search]);

  if (!extraction) {
    return <div className="h-40 animate-pulse rounded-xl bg-white/10" />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="ui-card">
        <h2 className="mb-3 text-sm font-medium text-white">Documento fuente</h2>
        {pdfUrl ? (
          <iframe
            title="PDF"
            src={pdfUrl}
            className="h-[70vh] w-full rounded-lg border border-white/10 bg-black/40"
          />
        ) : (
          <p className="text-sm text-muted">Vista previa no disponible. Continúa con la revisión.</p>
        )}
      </section>

      <div>
        <section className="ui-card mb-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-white">
              Ventas detectadas ({localSales.length})
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={handleAddSale}
                className="ui-btn-secondary inline-flex items-center gap-1.5 text-xs disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Agregar fila
              </button>
              <button
                type="button"
                disabled={reprocessing || saving}
                onClick={() => {
                  setReprocessing(true);
                  void onReprocess().finally(() => setReprocessing(false));
                }}
                className="ui-btn-secondary inline-flex items-center gap-2 text-xs"
              >
                {reprocessing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Re-extraer
              </button>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente, marca, modelo, ref, serie…"
              className="min-w-[14rem] flex-1 rounded-lg border border-white/15 bg-surface px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            />
            {REVIEW_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  filter === f.value ? 'bg-white/20 text-white' : 'text-muted hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {error ? (
            <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {visibleSales.map(({ sale, index }) => (
              <SaleExtractionCard
                key={index}
                sale={sale}
                index={index}
                disabled={saving}
                onChange={(patch) => updateSaleAt(index, patch)}
                onDelete={() => handleDeleteSale(index)}
              />
            ))}
            {visibleSales.length === 0 ? (
              <p className="text-sm text-muted">
                {localSales.length === 0
                  ? 'No hay ventas extraídas. Agrega una fila o re-extrae.'
                  : 'Ninguna venta coincide con el filtro o búsqueda.'}
              </p>
            ) : null}
          </div>
          {saving ? <p className="mt-2 text-[11px] text-muted">Guardando…</p> : null}
        </section>

        <button
          type="button"
          disabled={validating || localSales.length === 0 || saving}
          onClick={() => {
            setValidating(true);
            void onValidate().finally(() => setValidating(false));
          }}
          className="ui-btn-primary inline-flex items-center gap-2 disabled:opacity-40"
        >
          {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Validar ventas (dry-run)
        </button>
      </div>
    </div>
  );
}
