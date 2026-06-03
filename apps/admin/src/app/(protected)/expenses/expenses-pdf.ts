import type { jsPDF as JsPDFClass } from 'jspdf';

import type { OperatingExpense, OperatingExpenseCategory, ExpensesSummary } from '@/types/domain';

type Doc = InstanceType<typeof JsPDFClass>;
type RGB = [number, number, number];

export type ExportFilters = {
  year: string;
  month: string;
  day: string;
  category: string;
  startDate: string;
  endDate: string;
};

// ─── palette ────────────────────────────────────────────────────────────────
const C = {
  NAVY:        [10,  10,  10]  as RGB,
  GOLD:        [120, 120, 120] as RGB,
  DARK:        [26,  26,  26]  as RGB,
  MUTED:       [100, 100, 100] as RGB,
  LIGHT_MUTED: [160, 160, 160] as RGB,
  WHITE:       [255, 255, 255] as RGB,
  BG:          [247, 247, 247] as RGB,
  BORDER:      [220, 220, 220] as RGB,
  ROW_ALT:     [242, 242, 242] as RGB,
  COMM_TINT:   [242, 242, 242] as RGB,
};

const CATEGORY_LABELS: Record<OperatingExpenseCategory, string> = {
  GASOLINE:    'Gasoline',
  TOLLS:       'Tolls',
  WATCHMAKER:  'Watchmaker',
  PARKING:     'Parking',
  MEALS:       'Meals',
  FLIGHTS:     'Flights',
  TRAVEL:      'Travel / Per Diem',
  MARKETING:   'Instagram Ads / Marketing',
  COMMISSIONS: 'Comisiones',
  BANK_FEES:   'Comisiones de bancos',
};

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── helpers ─────────────────────────────────────────────────────────────────
function f(doc: Doc, color: RGB) { doc.setFillColor(color[0], color[1], color[2]); }
function d(doc: Doc, color: RGB) { doc.setDrawColor(color[0], color[1], color[2]); }
function t(doc: Doc, color: RGB) { doc.setTextColor(color[0], color[1], color[2]); }

function fmt(value: string | number): string {
  const n = Number(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function fmtDate(iso: string): string {
  const parts = iso.split('-');
  return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

function dashedLine(doc: Doc, x1: number, y: number, x2: number, dash = 1.5, gap = 1) {
  let x = x1;
  while (x < x2) {
    doc.line(x, y, Math.min(x + dash, x2), y);
    x += dash + gap;
  }
}

// ─── filter label ─────────────────────────────────────────────────────────────
function buildFilterLabel(filters: ExportFilters): string {
  const parts: string[] = [];

  if (filters.startDate) {
    const start = new Date(filters.startDate + 'T12:00:00');
    if (!filters.endDate || filters.endDate === filters.startDate) {
      parts.push(start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));
    } else {
      const end = new Date(filters.endDate + 'T12:00:00');
      const startStr = start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      const endStr   = end.toLocaleDateString('en-US',   { month: 'long', day: 'numeric', year: 'numeric' });
      parts.push(`${startStr} – ${endStr}`);
    }
  } else if (filters.year) {
    const m = parseInt(filters.month);
    if (filters.month && filters.day) {
      parts.push(`${MONTHS[m]} ${filters.day}, ${filters.year}`);
    } else if (filters.month) {
      parts.push(`${MONTHS[m]} ${filters.year}`);
    } else {
      parts.push(filters.year);
    }
  }

  if (filters.category) {
    const label = CATEGORY_LABELS[filters.category as OperatingExpenseCategory] ?? filters.category;
    parts.push(`Category: ${label}`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'Todos los gastos';
}

// ─── page chrome ──────────────────────────────────────────────────────────────
function drawPageHeader(doc: Doc, W: number) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  t(doc, C.NAVY);
  doc.text('WRIST CAVIAR', W - 14, 9, { align: 'right' });
  d(doc, C.GOLD);
  doc.setLineWidth(0.3);
  doc.line(14, 12, W - 14, 12);
}

function drawPageFooter(doc: Doc, W: number, H: number, pageNum: number, totalPages: number) {
  const fy = H - 10;
  d(doc, C.BORDER);
  doc.setLineWidth(0.2);
  doc.line(14, fy - 4, W - 14, fy - 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  t(doc, C.MUTED);
  doc.text('Wrist Caviar — Expenses Report', 14, fy);
  doc.text('CONFIDENTIAL', W / 2, fy, { align: 'center' });
  doc.text(`${pageNum} / ${totalPages}`, W - 14, fy, { align: 'right' });
}

function newContentPage(doc: Doc, W: number): number {
  doc.addPage();
  drawPageHeader(doc, W);
  return 20;
}

// ─── cover ────────────────────────────────────────────────────────────────────
function drawCover(doc: Doc, W: number, H: number, filterLabel: string) {
  f(doc, C.NAVY);
  doc.rect(0, 0, W, H, 'F');
  f(doc, C.GOLD);
  doc.rect(0, 0, W, 2.5, 'F');
  doc.rect(0, H - 2.5, W, 2.5, 'F');

  const midY = H / 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(34);
  t(doc, C.WHITE);
  doc.text('WRIST CAVIAR', W / 2, midY - 28, { align: 'center' });

  d(doc, C.GOLD);
  doc.setLineWidth(0.4);
  doc.line(W / 2 - 36, midY - 18, W / 2 + 36, midY - 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  t(doc, C.LIGHT_MUTED);
  doc.text('EXPENSES REPORT', W / 2, midY - 8, { align: 'center' });

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  t(doc, C.GOLD);
  doc.text(filterLabel, W / 2, midY + 8, { align: 'center', maxWidth: W - 40 });

  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  t(doc, C.MUTED);
  doc.text(`Generated ${dateStr}`, W / 2, H - 22, { align: 'center' });
  doc.setFontSize(7);
  doc.text('CONFIDENTIAL', W / 2, H - 14, { align: 'center' });
}

// ─── summary cards ────────────────────────────────────────────────────────────
function drawSummarySection(doc: Doc, summary: ExpensesSummary, W: number, startY: number): number {
  let y = startY;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  t(doc, C.NAVY);
  doc.text('SUMMARY', 14, y);
  d(doc, C.GOLD);
  doc.setLineWidth(0.3);
  doc.line(14, y + 2, 60, y + 2);
  y += 8;

  const stats = [
    { label: 'Gasto Total',       value: fmt(summary.totalSpend),             gold: false },
    { label: 'Operativos',        value: fmt(summary.totalOperatingExpenses), gold: false },
    { label: 'Comisiones',        value: fmt(summary.totalCommissions),       gold: true  },
    { label: 'Com. Bancos',       value: fmt(summary.totalBankFees),          gold: true  },
    {
      label: 'Cat. Principal',
      value: summary.biggestCategory
        ? (CATEGORY_LABELS[summary.biggestCategory as OperatingExpenseCategory] ?? summary.biggestCategory)
        : '—',
      gold: false,
    },
  ];

  const BOX_H = 22;
  const boxW  = (W - 28) / 5;

  stats.forEach((stat, i) => {
    const bx = 14 + i * boxW;
    const bw = boxW - 2;
    f(doc, C.BG);
    d(doc, C.BORDER);
    doc.setLineWidth(0.15);
    doc.rect(bx, y, bw, BOX_H, 'FD');

    if (stat.gold) {
      f(doc, C.GOLD);
      doc.rect(bx, y, bw, 1.2, 'F');
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    t(doc, C.MUTED);
    doc.text(stat.label.toUpperCase(), bx + bw / 2, y + 6.5, { align: 'center', maxWidth: bw - 3 });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(stat.value.length > 13 ? 7.5 : 9);
    t(doc, stat.gold ? C.GOLD : C.NAVY);
    doc.text(stat.value, bx + bw / 2, y + 16, { align: 'center', maxWidth: bw - 3 });
  });

  return y + BOX_H + 4;
}

// ─── horizontal bar chart ─────────────────────────────────────────────────────
function drawCategoryChart(doc: Doc, summary: ExpensesSummary, W: number, startY: number): number {
  let y = startY;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  t(doc, C.NAVY);
  doc.text('SPEND BY CATEGORY', 14, y);
  d(doc, C.GOLD);
  doc.setLineWidth(0.3);
  doc.line(14, y + 2, 90, y + 2);
  y += 9;

  const maxTotal = Math.max(...summary.byCategory.map((r) => Number(r.total)), 1);
  const LABEL_W  = 55;
  const BAR_W    = 82;
  const AMT_W    = 24;
  const PCT_W    = 12;
  const barX     = 14 + LABEL_W;
  const BAR_H    = 5.5;
  const BAR_GAP  = 3.5;

  const operatingRows  = summary.byCategory.filter((r) => !r.isCommission);
  const commissionRows = summary.byCategory.filter((r) => r.isCommission);

  function drawBar(row: ExpensesSummary['byCategory'][0]) {
    const fillW = Math.max(0.5, (Number(row.total) / maxTotal) * BAR_W);
    const label = CATEGORY_LABELS[row.category as OperatingExpenseCategory] ?? row.category;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    t(doc, row.isCommission ? C.GOLD : C.DARK);
    doc.text(label, 14, y + BAR_H - 0.5, { maxWidth: LABEL_W - 2 });

    f(doc, C.BG);
    d(doc, C.BORDER);
    doc.setLineWidth(0.1);
    doc.rect(barX, y, BAR_W, BAR_H, 'FD');

    f(doc, row.isCommission ? C.GOLD : C.NAVY);
    doc.rect(barX, y, fillW, BAR_H, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    t(doc, C.DARK);
    doc.text(fmt(row.total), barX + BAR_W + 2, y + BAR_H - 0.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    t(doc, C.MUTED);
    doc.text(
      `${row.percentage}%`,
      barX + BAR_W + AMT_W + PCT_W,
      y + BAR_H - 0.5,
      { align: 'right' },
    );

    y += BAR_H + BAR_GAP;
  }

  operatingRows.forEach(drawBar);

  if (commissionRows.length > 0) {
    y += 2;
    d(doc, C.GOLD);
    doc.setLineWidth(0.2);
    dashedLine(doc, 14, y, W - 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    t(doc, C.GOLD);
    doc.text('COMMISSIONS', W / 2, y + 4, { align: 'center' });
    y += 8;

    commissionRows.forEach(drawBar);
  }

  return y + 2;
}

// ─── expense table ────────────────────────────────────────────────────────────
function drawExpensesTable(
  doc: Doc,
  expenses: OperatingExpense[],
  summary: ExpensesSummary,
  W: number,
  H: number,
  startY: number,
) {
  const M = 14;
  const TABLE_W     = W - M * 2;
  const CONTENT_BTM = H - 16;
  const ROW_H_MIN   = 7;

  // Column x-offsets and widths
  const DATE_X  = M;
  const DATE_W  = 22;
  const CAT_X   = DATE_X + DATE_W;
  const CAT_W   = 52;
  const AMT_X   = CAT_X + CAT_W;
  const AMT_W   = 26;
  const NOTE_X  = AMT_X + AMT_W;
  const NOTE_W  = TABLE_W - DATE_W - CAT_W - AMT_W;

  let y      = startY;
  let rowIdx = 0;

  // Section heading
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  t(doc, C.NAVY);
  doc.text('EXPENSE RECORDS', M, y);
  d(doc, C.GOLD);
  doc.setLineWidth(0.3);
  doc.line(M, y + 2, 95, y + 2);
  y += 9;

  function drawTableHeader() {
    f(doc, C.NAVY);
    doc.rect(M, y, TABLE_W, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    t(doc, C.WHITE);
    doc.text('DATE',     DATE_X + 2,         y + 4.8);
    doc.text('CATEGORY', CAT_X + 2,          y + 4.8);
    doc.text('AMOUNT',   AMT_X + AMT_W - 2,  y + 4.8, { align: 'right' });
    doc.text('NOTES',    NOTE_X + 2,         y + 4.8);
    y += 8;
  }

  function checkPageBreak(neededH: number) {
    if (y + neededH > CONTENT_BTM) {
      y = newContentPage(doc, W);
      drawTableHeader();
    }
  }

  drawTableHeader();

  const operating   = expenses.filter((e) => e.category !== 'COMMISSIONS');
  const commissions = expenses.filter((e) => e.category === 'COMMISSIONS');

  function drawRow(exp: OperatingExpense, isCommission: boolean) {
    const notesLines = exp.notes
      ? (doc.splitTextToSize(exp.notes, NOTE_W - 4) as string[])
      : [];
    const rowH = Math.max(ROW_H_MIN, ROW_H_MIN + Math.max(0, notesLines.length - 1) * 4);

    checkPageBreak(rowH);

    // Background
    if (isCommission) {
      f(doc, C.COMM_TINT);
    } else {
      f(doc, rowIdx % 2 === 0 ? C.WHITE : C.ROW_ALT);
    }
    doc.rect(M, y, TABLE_W, rowH, 'F');

    // Gold left accent for commissions
    if (isCommission) {
      f(doc, C.GOLD);
      doc.rect(M, y, 1.5, rowH, 'F');
    }

    const ty = y + 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    t(doc, C.MUTED);
    doc.text(fmtDate(exp.expenseDate), DATE_X + 2, ty);

    doc.setFont('helvetica', isCommission ? 'bold' : 'normal');
    doc.setFontSize(7.5);
    t(doc, isCommission ? C.GOLD : C.DARK);
    doc.text(CATEGORY_LABELS[exp.category] ?? exp.category, CAT_X + 2, ty, { maxWidth: CAT_W - 4 });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    t(doc, isCommission ? C.GOLD : C.DARK);
    doc.text(fmt(exp.amount), AMT_X + AMT_W - 2, ty, { align: 'right' });

    if (notesLines.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      t(doc, C.MUTED);
      doc.text(notesLines, NOTE_X + 2, ty, { lineHeightFactor: 1.4 });
    }

    d(doc, C.BORDER);
    doc.setLineWidth(0.1);
    doc.line(M, y + rowH, M + TABLE_W, y + rowH);

    y += rowH;
    rowIdx++;
  }

  operating.forEach((exp) => drawRow(exp, false));

  if (commissions.length > 0) {
    checkPageBreak(12);
    y += 3;
    d(doc, C.GOLD);
    doc.setLineWidth(0.2);
    dashedLine(doc, M, y, M + TABLE_W);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    t(doc, C.GOLD);
    doc.text('COMMISSIONS', W / 2, y + 4.5, { align: 'center' });
    y += 9;

    commissions.forEach((exp) => drawRow(exp, true));
  }

  // Totals row
  checkPageBreak(12);
  y += 2;
  f(doc, C.NAVY);
  doc.rect(M, y, TABLE_W, 10, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  t(doc, C.WHITE);
  doc.text('TOTAL', CAT_X + 2, y + 6.5);
  doc.text(fmt(summary.totalSpend), AMT_X + AMT_W - 2, y + 6.5, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  t(doc, C.LIGHT_MUTED);
  doc.text(
    `Operativos ${fmt(summary.totalOperatingExpenses)}  ·  Comisiones ${fmt(summary.totalCommissions)}  ·  Bancos ${fmt(summary.totalBankFees)}`,
    NOTE_X + 2,
    y + 6.5,
  );
}

// ─── main export ──────────────────────────────────────────────────────────────
export async function generateExpensesPdf(
  expenses: OperatingExpense[],
  summary: ExpensesSummary,
  filters: ExportFilters,
): Promise<void> {
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const W = 210;
  const H = 297;

  const filterLabel = buildFilterLabel(filters);

  // Page 1: cover
  drawCover(doc, W, H, filterLabel);

  // Page 2+: content
  let y = newContentPage(doc, W);

  y = drawSummarySection(doc, summary, W, y);
  y += 8;

  if (summary.byCategory.length > 0) {
    // Each bar row is ~9mm; section heading ~11mm
    const chartH = summary.byCategory.length * 9 + 22;
    if (y + chartH > H - 50) {
      y = newContentPage(doc, W);
    }
    y = drawCategoryChart(doc, summary, W, y);
    y += 10;
  }

  // Start table on a new page if not enough vertical room
  if (y > 220) {
    y = newContentPage(doc, W);
  }

  drawExpensesTable(doc, expenses, summary, W, H, y);

  // Add footers retroactively (page 1 is cover; content pages are 2..N)
  const totalDocPages    = doc.getNumberOfPages();
  const contentPageCount = totalDocPages - 1;
  for (let i = 2; i <= totalDocPages; i++) {
    doc.setPage(i);
    drawPageFooter(doc, W, H, i - 1, contentPageCount);
  }

  const dateTag = new Date().toISOString().split('T')[0];
  doc.save(`wrist-caviar-expenses-${dateTag}.pdf`);
}
