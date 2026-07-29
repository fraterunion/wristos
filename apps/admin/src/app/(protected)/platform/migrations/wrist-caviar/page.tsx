'use client';

import { FormEvent, useMemo, useState } from 'react';

import { useAuthContext } from '@/lib/auth-context';
import { getApiBaseUrl } from '@/lib/api-client';
import { readSession } from '@/lib/auth-storage';
import { WristCaviarReviewPanel } from './ReviewPanel';
import { WristCaviarSimulationPanel } from './SimulationPanel';

type Step =
  | 'archivo'
  | 'analisis'
  | 'validaciones'
  | 'conciliacion'
  | 'preview'
  | 'revision'
  | 'aprobacion'
  | 'simulacion';

type AnalysisSummary = {
  analysisId: string;
  parserVersion: string;
  fingerprintPrefix: string;
  readiness: 'READY_FOR_DRY_RUN' | 'NEEDS_REVIEW' | 'BLOCKED';
  durationMs: number;
  counts: Record<string, number>;
  issueSummary: {
    critical: number;
    warning: number;
    manualReview: number;
    informational: number;
  };
  sheets: Array<{
    sheetName: string;
    classification: string;
    detectedRecords: number;
    warningCount: number;
    errorCount: number;
    status: string;
  }>;
  reconciliationSummary: Record<string, number>;
};

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'archivo', label: '1. Archivo' },
  { id: 'analisis', label: '2. Análisis' },
  { id: 'validaciones', label: '3. Validaciones' },
  { id: 'conciliacion', label: '4. Conciliación' },
  { id: 'preview', label: '5. Vista previa' },
  { id: 'revision', label: '6. Revisión' },
  { id: 'aprobacion', label: '7. Aprobación' },
  { id: 'simulacion', label: '8. Simulación' },
];

const PREVIEW_TABS = [
  { id: 'customers', label: 'Clientes' },
  { id: 'inventory', label: 'Inventario' },
  { id: 'sales', label: 'Ventas' },
  { id: 'receivables', label: 'CXC' },
  { id: 'payables', label: 'CXP' },
  { id: 'expenses', label: 'Gastos' },
  { id: 'cash', label: 'Efectivo' },
  { id: 'bank', label: 'Bancos' },
  { id: 'partner-ledger', label: 'Capital/utilidades' },
  { id: 'deferred', label: 'Diferidos' },
] as const;

const COUNT_CARDS: Array<{ key: string; label: string }> = [
  { key: 'customers', label: 'Clientes' },
  { key: 'inventory', label: 'Inventario' },
  { key: 'sales', label: 'Ventas' },
  { key: 'receivables', label: 'Cuentas por cobrar' },
  { key: 'receivablePayments', label: 'Pagos CXC' },
  { key: 'payables', label: 'Cuentas por pagar' },
  { key: 'payablePayments', label: 'Pagos CXP' },
  { key: 'expenses', label: 'Gastos' },
  { key: 'cashMxn', label: 'Efectivo MXN' },
  { key: 'cashUsd', label: 'Efectivo USD' },
  { key: 'bankMovements', label: 'Movimientos bancarios' },
  { key: 'deferred', label: 'Movimientos por revisar' },
];

function readinessCopy(r: AnalysisSummary['readiness']) {
  if (r === 'READY_FOR_DRY_RUN') {
    return 'El archivo está listo para preparar una simulación de importación.';
  }
  if (r === 'NEEDS_REVIEW') {
    return 'Se detectaron inconsistencias que deben revisarse antes de continuar.';
  }
  return 'El archivo contiene errores críticos que impiden preparar la migración.';
}

function readinessClass(r: AnalysisSummary['readiness']) {
  if (r === 'READY_FOR_DRY_RUN') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (r === 'NEEDS_REVIEW') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  return 'border-red-500/40 bg-red-500/10 text-red-300';
}

function provenanceLabel(row: Record<string, unknown>): string {
  const source = row.source as
    | { sourceSheet?: string; sourceRow?: number; sourceBlockId?: string }
    | undefined;
  if (!source?.sourceSheet) return '—';
  if (source.sourceBlockId) return `${source.sourceSheet} · bloque ${source.sourceBlockId}`;
  if (source.sourceRow != null) return `${source.sourceSheet} · fila ${source.sourceRow}`;
  return source.sourceSheet;
}

export default function WristCaviarMigrationPage() {
  const { user } = useAuthContext();
  const [step, setStep] = useState<Step>('archivo');
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [issues, setIssues] = useState<Array<Record<string, unknown>>>([]);
  const [recon, setRecon] = useState<Array<Record<string, unknown>>>([]);
  const [previewTab, setPreviewTab] = useState<(typeof PREVIEW_TABS)[number]['id']>('sales');
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);
  const [previewTotal, setPreviewTotal] = useState(0);

  const tenantId = user?.tenantId;

  const authHeaders = useMemo((): Record<string, string> => {
    const session = readSession();
    return session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {};
  }, []);

  async function runAnalyze(e?: FormEvent) {
    e?.preventDefault();
    if (!file || !tenantId) return;
    setError(null);
    setProcessing(true);
    setStep('analisis');
    setPhase('Leyendo workbook…');
    try {
      const body = new FormData();
      body.append('file', file);
      setPhase('Analizando hojas…');
      await new Promise((r) => setTimeout(r, 200));
      setPhase('Normalizando registros…');
      const res = await fetch(
        `${getApiBaseUrl()}/platform/migrations/wrist-caviar/analyze?tenantId=${encodeURIComponent(tenantId)}`,
        { method: 'POST', headers: authHeaders, body },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          typeof payload?.message === 'string' ? payload.message : `Error ${res.status}`,
        );
      }
      setPhase('Validando relaciones…');
      const data = (await res.json()) as AnalysisSummary;
      setSummary(data);
      setPhase('Conciliando totales…');
      const [issuesRes, reconRes] = await Promise.all([
        fetch(
          `${getApiBaseUrl()}/platform/migrations/wrist-caviar/${data.analysisId}/issues?tenantId=${tenantId}&pageSize=100`,
          { headers: authHeaders },
        ),
        fetch(
          `${getApiBaseUrl()}/platform/migrations/wrist-caviar/${data.analysisId}/reconciliation?tenantId=${tenantId}`,
          { headers: authHeaders },
        ),
      ]);
      const issuesJson = await issuesRes.json();
      const reconJson = await reconRes.json();
      setIssues(issuesJson.items ?? []);
      setRecon(reconJson.items ?? []);
      setStep('analisis');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo analizar el archivo');
      setStep('archivo');
    } finally {
      setProcessing(false);
      setPhase(null);
    }
  }

  async function loadPreview(entity: (typeof PREVIEW_TABS)[number]['id']) {
    if (!summary || !tenantId) return;
    setPreviewTab(entity);
    const res = await fetch(
      `${getApiBaseUrl()}/platform/migrations/wrist-caviar/${summary.analysisId}/preview/${entity}?tenantId=${tenantId}&page=1&pageSize=25`,
      { headers: authHeaders },
    );
    if (!res.ok) {
      setError(`No se pudo cargar preview (${res.status})`);
      return;
    }
    const json = await res.json();
    setPreviewRows(json.items ?? []);
    setPreviewTotal(json.total ?? 0);
    setStep('preview');
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 overflow-x-hidden text-zinc-100">
      <header className="space-y-2 border-b border-zinc-800 pb-5">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Platform · Migraciones</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Migración inicial de Wrist Caviar
        </h1>
        <p className="max-w-2xl text-sm text-zinc-400">
          Analiza el Excel maestro, valida sus datos y concilia los saldos antes de importar.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStep(s.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              step === s.id
                ? 'bg-zinc-100 text-zinc-900'
                : 'bg-zinc-900 text-zinc-400 ring-1 ring-zinc-800'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {step === 'archivo' ? (
        <form onSubmit={runAnalyze} className="space-y-4 rounded-xl bg-zinc-950/80 p-5 ring-1 ring-zinc-800">
          <label
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50 px-4 py-10 text-center"
            onDragOver={(ev) => ev.preventDefault()}
            onDrop={(ev) => {
              ev.preventDefault();
              const f = ev.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
          >
            <span className="text-sm text-zinc-300">Arrastra el .xlsx o selecciónalo</span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(ev) => setFile(ev.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="text-xs text-zinc-400">
                <div>{file.name}</div>
                <div>{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            ) : (
              <span className="text-xs text-zinc-500">Solo .xlsx · sin macros · máx. 25 MB</span>
            )}
          </label>
          <button
            type="submit"
            disabled={!file || processing}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Analizar workbook
          </button>
        </form>
      ) : null}

      {processing ? (
        <div className="rounded-xl bg-zinc-950/80 p-5 ring-1 ring-zinc-800">
          <p className="text-sm text-zinc-300">{phase ?? 'Procesando…'}</p>
          <ul className="mt-3 space-y-1 text-xs text-zinc-500">
            <li>Leyendo workbook</li>
            <li>Analizando hojas</li>
            <li>Normalizando registros</li>
            <li>Validando relaciones</li>
            <li>Conciliando totales</li>
          </ul>
        </div>
      ) : null}

      {summary && step === 'analisis' ? (
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {COUNT_CARDS.map((c) => (
              <div key={c.key} className="rounded-lg bg-zinc-950 p-3 ring-1 ring-zinc-800">
                <div className="text-xs text-zinc-500">{c.label}</div>
                <div className="mt-1 text-xl font-semibold text-white">
                  {summary.counts[c.key] ?? 0}
                </div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-800">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-900 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Hoja</th>
                  <th className="px-3 py-2">Clasificación</th>
                  <th className="px-3 py-2">Registros</th>
                  <th className="px-3 py-2">Warnings</th>
                  <th className="px-3 py-2">Errores</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {summary.sheets.map((s) => (
                  <tr key={s.sheetName} className="border-t border-zinc-800">
                    <td className="px-3 py-2">{s.sheetName}</td>
                    <td className="px-3 py-2 text-zinc-400">{s.classification}</td>
                    <td className="px-3 py-2">{s.detectedRecords}</td>
                    <td className="px-3 py-2 text-amber-300">{s.warningCount}</td>
                    <td className="px-3 py-2 text-red-300">{s.errorCount}</td>
                    <td className="px-3 py-2">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900"
              onClick={() => setStep('validaciones')}
            >
              Ver validaciones
            </button>
            <button
              type="button"
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200"
              onClick={() => setStep('conciliacion')}
            >
              Ver conciliación
            </button>
            <button
              type="button"
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200"
              onClick={() => loadPreview('sales')}
            >
              Vista previa
            </button>
            <button
              type="button"
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white"
              onClick={() => setStep('revision')}
            >
              Ir a revisión
            </button>
          </div>
        </section>
      ) : null}

      {summary && (step === 'revision' || step === 'aprobacion') && tenantId ? (
        <section data-testid="review-section">
          <WristCaviarReviewPanel
            analysisId={summary.analysisId}
            tenantId={tenantId}
            onReadinessChange={(r) =>
              setSummary((prev) =>
                prev
                  ? {
                      ...prev,
                      readiness: r as AnalysisSummary['readiness'],
                    }
                  : prev,
              )
            }
          />
          <div className="mt-4">
            <button
              type="button"
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white"
              onClick={() => setStep('simulacion')}
            >
              Ir a simulación
            </button>
          </div>
        </section>
      ) : null}

      {summary && step === 'simulacion' && tenantId ? (
        <section data-testid="simulation-section">
          <WristCaviarSimulationPanel
            analysisId={summary.analysisId}
            tenantId={tenantId}
          />
        </section>
      ) : null}

      {summary && step === 'validaciones' ? (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-red-300">Críticos: {summary.issueSummary.critical}</span>
            <span className="text-amber-300">Warnings: {summary.issueSummary.warning}</span>
            <span className="text-amber-200">Manual: {summary.issueSummary.manualReview}</span>
            <span className="text-zinc-400">Info: {summary.issueSummary.informational}</span>
          </div>
          <div className="max-h-[28rem] space-y-2 overflow-y-auto">
            {issues.map((issue, idx) => (
              <div key={idx} className="rounded-md bg-zinc-950 px-3 py-2 text-sm ring-1 ring-zinc-800">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={
                      issue.severity === 'CRITICAL'
                        ? 'text-red-300'
                        : issue.severity === 'WARNING'
                          ? 'text-amber-300'
                          : 'text-zinc-400'
                    }
                  >
                    {String(issue.severity)}
                  </span>
                  <span className="font-mono text-zinc-500">{String(issue.code)}</span>
                </div>
                <p className="mt-1 text-zinc-300">{String(issue.message)}</p>
                {issue.sourceSheet ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    {String(issue.sourceSheet)}
                    {issue.sourceRow != null ? ` · fila ${String(issue.sourceRow)}` : ''}
                    {issue.sourceBlockId ? ` · bloque ${String(issue.sourceBlockId)}` : ''}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {summary && step === 'conciliacion' ? (
        <section className="overflow-x-auto rounded-xl ring-1 ring-zinc-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-900 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Concepto</th>
                <th className="px-3 py-2">Moneda</th>
                <th className="px-3 py-2">Declarado</th>
                <th className="px-3 py-2">Calculado</th>
                <th className="px-3 py-2">Diferencia</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {recon.map((row, idx) => (
                <tr key={idx} className="border-t border-zinc-800">
                  <td className="px-3 py-2">{String(row.concept)}</td>
                  <td className="px-3 py-2">{String(row.currency)}</td>
                  <td className="px-3 py-2">{row.declaredValue != null ? '•••' : '—'}</td>
                  <td className="px-3 py-2">{row.calculatedValue != null ? '•••' : '—'}</td>
                  <td className="px-3 py-2">{row.difference != null ? '•••' : '—'}</td>
                  <td className="px-3 py-2">{String(row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-zinc-500">
            Los montos se ocultan en UI de plataforma; el estado de conciliación es el señalador.
          </p>
        </section>
      ) : null}

      {summary && step === 'preview' ? (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {PREVIEW_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => loadPreview(t.id)}
                className={`rounded-md px-3 py-1.5 text-xs ${
                  previewTab === t.id ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            {previewTotal} registros · página 1 (máx. 25)
          </p>
          <div className="max-h-[28rem] space-y-2 overflow-y-auto">
            {previewRows.map((row, idx) => (
              <div key={idx} className="rounded-md bg-zinc-950 px-3 py-2 text-sm ring-1 ring-zinc-800">
                <div className="text-xs text-zinc-500">{provenanceLabel(row)}</div>
                <div className="mt-1 text-zinc-300">
                  {String(
                    row.displayName ??
                      row.customerName ??
                      row.creditorName ??
                      row.brand ??
                      row.concept ??
                      row.label ??
                      row.id ??
                      'Registro',
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {summary ? (
        <footer className={`rounded-xl border px-4 py-3 text-sm ${readinessClass(summary.readiness)}`}>
          <div className="font-medium">{summary.readiness}</div>
          <p className="mt-1 opacity-90">{readinessCopy(summary.readiness)}</p>
          <p className="mt-2 text-xs opacity-70">
            parser {summary.parserVersion} · fingerprint {summary.fingerprintPrefix} ·{' '}
            {summary.durationMs} ms
          </p>
        </footer>
      ) : null}
    </div>
  );
}
