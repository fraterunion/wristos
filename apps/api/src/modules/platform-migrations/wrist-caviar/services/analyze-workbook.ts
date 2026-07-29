import type ExcelJS from 'exceljs';

import { PARSER_VERSION, RECOGNIZED_SHEETS } from '../constants';
import { parseCobroUtilidadesSheet } from '../parsers/cobro-utilidades.parser';
import { parseControlBancosSheet } from '../parsers/control-bancos.parser';
import { parseCriptoCesarSheet } from '../parsers/cripto-cesar.parser';
import { parseCuentaCesarSheet } from '../parsers/cuenta-cesar.parser';
import { parseCuentasPorCobrarSheet } from '../parsers/cuentas-por-cobrar.parser';
import { parseCuentasPorPagarSheet } from '../parsers/cuentas-por-pagar.parser';
import { parseEfectivoSheet } from '../parsers/efectivo.parser';
import { parseGastosSheet } from '../parsers/gastos.parser';
import { parseInventarioSheet } from '../parsers/inventario.parser';
import { parseOscarPapaCamiSheet } from '../parsers/oscar-papa-cami.parser';
import { parseReporteSheet } from '../parsers/reporte.parser';
import { parseVentasSheet } from '../parsers/ventas.parser';
import { reconcileAgainstReporte } from '../reconciliation/reporte.reconciliation';
import type {
  IssueSummary,
  MigrationError,
  MigrationManualReviewItem,
  MigrationWarning,
  NormalizedCounts,
  SheetAnalysis,
  SheetClassification,
  WorkbookAnalysis,
} from '../types/migration.types';
import {
  buildCustomerCandidates,
  computeReadiness,
  runCrossSheetValidations,
} from '../validation/cross-sheet.validation';
import { loadAndValidateWorkbook } from '../workbook/workbook-loader';
import { resetCandidateIdCounters } from '../workbook/cell.util';

function classifySheet(name: string): SheetClassification {
  switch (name) {
    case 'REPORTE':
      return 'RECONCILIATION';
    case 'COBRO UTILIDADES':
      return 'DERIVED';
    case 'CRIPTO CESAR':
    case 'OSCAR PAPA CAMI':
      return 'DEFERRED';
    case 'VENTAS':
    case 'INVENTARIO':
    case 'CTAS X COBRAR':
    case 'CTAS X PAGAR':
    case 'GASTOS':
    case 'EFECTIVO':
    case 'CONTROL BANCOS':
    case 'CUENTA CESAR':
      return 'OPERATIONAL';
    default:
      return 'UNKNOWN';
  }
}

function emptyCounts(): NormalizedCounts {
  return {
    customers: 0,
    inventory: 0,
    sales: 0,
    receivables: 0,
    receivablePayments: 0,
    payables: 0,
    payablePayments: 0,
    expenses: 0,
    cashMxn: 0,
    cashUsd: 0,
    cashHidden: 0,
    bankMovements: 0,
    partnerLedger: 0,
    profitDistributions: 0,
    cryptoLedger: 0,
    externalFloat: 0,
    deferred: 0,
    reportedBalances: 0,
  };
}

function summarizeIssues(
  issues: Array<MigrationWarning | MigrationError | MigrationManualReviewItem>,
): IssueSummary {
  const byCategory: Record<string, number> = {};
  let critical = 0;
  let warning = 0;
  let manualReview = 0;
  let informational = 0;
  for (const issue of issues) {
    const cat = issue.category ?? 'general';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    if (issue.severity === 'CRITICAL') critical++;
    else if (issue.severity === 'WARNING') warning++;
    else if (issue.severity === 'MANUAL_REVIEW') manualReview++;
    else informational++;
  }
  return { critical, warning, manualReview, informational, byCategory };
}

function sheetResult(
  sheetName: string,
  status: SheetAnalysis['status'],
  detectedRecords: number,
  warnings: MigrationWarning[],
  errors: MigrationError[],
  manualReview: MigrationManualReviewItem[],
  notes: string[],
): SheetAnalysis {
  return {
    sheetName,
    recognized: (RECOGNIZED_SHEETS as readonly string[]).includes(sheetName),
    classification: classifySheet(sheetName),
    status,
    detectedRecords,
    warningCount: warnings.length,
    errorCount: errors.length,
    manualReviewCount: manualReview.length,
    notes,
  };
}

export async function analyzeWristCaviarWorkbook(
  buffer: Buffer,
  fileName: string,
): Promise<WorkbookAnalysis> {
  resetCandidateIdCounters();
  const started = Date.now();
  const loaded = await loadAndValidateWorkbook(buffer, fileName);

  const identityIssues: Array<MigrationWarning | MigrationError> = loaded.issues.map((i) =>
    i.severity === 'CRITICAL'
      ? { code: i.code, message: i.message, severity: 'CRITICAL' as const, category: 'identity' }
      : { code: i.code, message: i.message, severity: 'WARNING' as const, category: 'identity' },
  );

  if (loaded.blocked) {
    const sheets: SheetAnalysis[] = loaded.missingCoreSheets.map((name) =>
      sheetResult(name, 'FAILED', 0, [], [], [], ['missing core sheet']),
    );
    for (const name of loaded.unknownSheets) {
      sheets.push(sheetResult(name, 'UNKNOWN_SHEET', 0, [], [], [], ['not parsed']));
    }
    const issues = identityIssues;
    return {
      parserVersion: PARSER_VERSION,
      fingerprint: loaded.fingerprint,
      fingerprintPrefix: loaded.fingerprintPrefix,
      fileName: loaded.fileName,
      fileSizeBytes: loaded.fileSizeBytes,
      readiness: 'BLOCKED',
      durationMs: Date.now() - started,
      sheets,
      unknownSheets: loaded.unknownSheets,
      missingCoreSheets: loaded.missingCoreSheets,
      counts: emptyCounts(),
      issueSummary: summarizeIssues(issues),
      reconciliation: [],
      issues,
      customers: [],
      inventory: [],
      sales: [],
      receivables: [],
      payables: [],
      expenses: [],
      cash: [],
      bank: [],
      partnerLedger: [],
      profitDistributions: [],
      crypto: [],
      externalFloat: [],
      reportedBalances: [],
      operationalWrites: 0,
    };
  }

  const ctxBase = {
    workbookFingerprint: loaded.fingerprint,
    parserVersion: PARSER_VERSION,
  };

  const allWarnings: MigrationWarning[] = [];
  const allErrors: MigrationError[] = [];
  const allManual: MigrationManualReviewItem[] = [];
  const sheets: SheetAnalysis[] = [];
  let parserCrashed = false;

  const run = <T>(
    name: string,
    ws: ExcelJS.Worksheet | undefined,
    fn: (sheet: ExcelJS.Worksheet) => {
      records: T[];
      warnings: MigrationWarning[];
      errors: MigrationError[];
      manualReview: MigrationManualReviewItem[];
      notes: string[];
    },
  ): T[] => {
    if (!ws) {
      sheets.push(sheetResult(name, 'FAILED', 0, [], [], [], ['sheet missing']));
      return [];
    }
    try {
      const result = fn(ws);
      allWarnings.push(...result.warnings);
      allErrors.push(...result.errors);
      allManual.push(...result.manualReview);
      const status =
        result.errors.length > 0 ? 'PARTIAL' : result.records.length >= 0 ? 'PARSED' : 'PARSED';
      sheets.push(
        sheetResult(
          name,
          status,
          result.records.length,
          result.warnings,
          result.errors,
          result.manualReview,
          result.notes,
        ),
      );
      return result.records;
    } catch {
      parserCrashed = true;
      allErrors.push({
        code: 'PARSER_CRASH',
        message: `Parser crash on ${name}`,
        severity: 'CRITICAL',
        category: 'parser',
      });
      sheets.push(sheetResult(name, 'FAILED', 0, [], [], [], ['parser crash']));
      return [];
    }
  };

  const wb = loaded.workbook;
  const sales = run('VENTAS', wb.getWorksheet('VENTAS'), (s) =>
    parseVentasSheet(s, { ...ctxBase, sheetName: 'VENTAS' }),
  );
  const inventory = run('INVENTARIO', wb.getWorksheet('INVENTARIO'), (s) =>
    parseInventarioSheet(s, { ...ctxBase, sheetName: 'INVENTARIO' }),
  );
  const receivables = run('CTAS X COBRAR', wb.getWorksheet('CTAS X COBRAR'), (s) =>
    parseCuentasPorCobrarSheet(s, { ...ctxBase, sheetName: 'CTAS X COBRAR' }),
  );
  const payables = run('CTAS X PAGAR', wb.getWorksheet('CTAS X PAGAR'), (s) =>
    parseCuentasPorPagarSheet(s, { ...ctxBase, sheetName: 'CTAS X PAGAR' }),
  );
  const expenses = run('GASTOS', wb.getWorksheet('GASTOS'), (s) =>
    parseGastosSheet(s, { ...ctxBase, sheetName: 'GASTOS' }),
  );
  const cash = run('EFECTIVO', wb.getWorksheet('EFECTIVO'), (s) =>
    parseEfectivoSheet(s, { ...ctxBase, sheetName: 'EFECTIVO' }),
  );
  const bank = run('CONTROL BANCOS', wb.getWorksheet('CONTROL BANCOS'), (s) =>
    parseControlBancosSheet(s, { ...ctxBase, sheetName: 'CONTROL BANCOS' }),
  );
  const partnerLedger = run('CUENTA CESAR', wb.getWorksheet('CUENTA CESAR'), (s) =>
    parseCuentaCesarSheet(s, { ...ctxBase, sheetName: 'CUENTA CESAR' }),
  );
  const profitDistributions = run('COBRO UTILIDADES', wb.getWorksheet('COBRO UTILIDADES'), (s) =>
    parseCobroUtilidadesSheet(s, { ...ctxBase, sheetName: 'COBRO UTILIDADES' }),
  );
  const reportedBalances = run('REPORTE', wb.getWorksheet('REPORTE'), (s) =>
    parseReporteSheet(s, { ...ctxBase, sheetName: 'REPORTE' }),
  );
  const crypto = run('CRIPTO CESAR', wb.getWorksheet('CRIPTO CESAR'), (s) =>
    parseCriptoCesarSheet(s, { ...ctxBase, sheetName: 'CRIPTO CESAR' }),
  );
  const externalFloat = run('OSCAR PAPA CAMI', wb.getWorksheet('OSCAR PAPA CAMI'), (s) =>
    parseOscarPapaCamiSheet(s, { ...ctxBase, sheetName: 'OSCAR PAPA CAMI' }),
  );

  for (const name of loaded.unknownSheets) {
    sheets.push(sheetResult(name, 'UNKNOWN_SHEET', 0, [], [], [], ['recognized but not parsed']));
  }

  const customerBuild = buildCustomerCandidates({
    sales,
    receivables,
    fingerprint: loaded.fingerprint,
    parserVersion: PARSER_VERSION,
  });
  allWarnings.push(...customerBuild.warnings);
  allManual.push(...customerBuild.manualReview);

  const cross = runCrossSheetValidations({
    sales,
    inventory,
    receivables,
    customers: customerBuild.customers,
  });
  allWarnings.push(...cross.warnings);
  allErrors.push(...cross.errors);
  allManual.push(...cross.manualReview);

  const reconciliation = reconcileAgainstReporte({
    reportedBalances,
    sales,
    inventory,
    receivables,
    payables,
    expenses,
    cash,
    bank,
    partnerLedger,
    crypto,
    externalFloat,
    profitDistributions,
  });

  for (const item of reconciliation) {
    if (item.status === 'MISMATCH') {
      allWarnings.push({
        code: 'REPORT_RECONCILIATION_MISMATCH',
        message: `REPORTE mismatch: ${item.concept}`,
        severity: 'WARNING',
        category: 'reconciliation',
      });
    }
  }

  const counts: NormalizedCounts = {
    customers: customerBuild.customers.length,
    inventory: inventory.length,
    sales: sales.length,
    receivables: receivables.length,
    receivablePayments: receivables.reduce((s, r) => s + r.payments.length, 0),
    payables: payables.length,
    payablePayments: payables.reduce((s, r) => s + r.payments.length, 0),
    expenses: expenses.length,
    cashMxn: cash.filter((c) => c.currency === 'MXN').length,
    cashUsd: cash.filter((c) => c.currency === 'USD').length,
    cashHidden: cash.filter((c) => c.hidden).length,
    bankMovements: bank.length,
    partnerLedger: partnerLedger.length,
    profitDistributions: profitDistributions.length,
    cryptoLedger: crypto.length,
    externalFloat: externalFloat.length,
    deferred: crypto.length + externalFloat.length,
    reportedBalances: reportedBalances.length,
  };

  const coreParsed =
    sales.length > 0 &&
    inventory.length > 0 &&
    reportedBalances.length > 0 &&
    !parserCrashed;

  const readiness = computeReadiness({
    blockedIdentity: false,
    missingCoreSheets: loaded.missingCoreSheets,
    parserCrashed,
    errors: allErrors,
    warnings: allWarnings,
    manualReview: allManual,
    coreParsed,
    reconciliationDone: reconciliation.length > 0,
  });

  const issues = [...identityIssues, ...allErrors, ...allWarnings, ...allManual];

  return {
    parserVersion: PARSER_VERSION,
    fingerprint: loaded.fingerprint,
    fingerprintPrefix: loaded.fingerprintPrefix,
    fileName: loaded.fileName,
    fileSizeBytes: loaded.fileSizeBytes,
    readiness,
    durationMs: Date.now() - started,
    sheets,
    unknownSheets: loaded.unknownSheets,
    missingCoreSheets: loaded.missingCoreSheets,
    counts,
    issueSummary: summarizeIssues(issues),
    reconciliation,
    issues,
    customers: customerBuild.customers,
    inventory,
    sales,
    receivables,
    payables,
    expenses,
    cash,
    bank,
    partnerLedger,
    profitDistributions,
    crypto,
    externalFloat,
    reportedBalances,
    operationalWrites: 0,
  };
}

export function toAnalysisSummary(analysis: WorkbookAnalysis) {
  return {
    analysisId: analysis.analysisId,
    parserVersion: analysis.parserVersion,
    fingerprintPrefix: analysis.fingerprintPrefix,
    readiness: analysis.readiness,
    fileName: analysis.fileName,
    fileSizeBytes: analysis.fileSizeBytes,
    durationMs: analysis.durationMs,
    sheets: analysis.sheets,
    unknownSheets: analysis.unknownSheets,
    missingCoreSheets: analysis.missingCoreSheets,
    counts: analysis.counts,
    issueSummary: analysis.issueSummary,
    reconciliationSummary: {
      matched: analysis.reconciliation.filter((r) => r.status === 'MATCHED').length,
      withinTolerance: analysis.reconciliation.filter((r) => r.status === 'WITHIN_TOLERANCE').length,
      mismatch: analysis.reconciliation.filter((r) => r.status === 'MISMATCH').length,
      scopeReview: analysis.reconciliation.filter((r) => r.status === 'SCOPE_REVIEW_REQUIRED').length,
      unavailable: analysis.reconciliation.filter((r) => r.status === 'UNAVAILABLE').length,
      formulaError: analysis.reconciliation.filter((r) => r.status === 'FORMULA_ERROR').length,
    },
    operationalWrites: 0,
  };
}
