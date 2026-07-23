import type { jsPDF as JsPDFClass } from 'jspdf';

import type { Watch } from '@/types/domain';

type Doc = InstanceType<typeof JsPDFClass>;
type RGB = [number, number, number];

const C = {
  NAVY: [10, 10, 10] as RGB,
  GOLD: [120, 120, 120] as RGB,
  DARK: [26, 26, 26] as RGB,
  MUTED: [100, 100, 100] as RGB,
  LIGHT_MUTED: [160, 160, 160] as RGB,
  CARD_BG: [247, 247, 247] as RGB,
  CARD_BORDER: [220, 220, 220] as RGB,
  PLACEHOLDER_BG: [232, 232, 232] as RGB,
  PLACEHOLDER_TEXT: [170, 170, 170] as RGB,
  WHITE: [255, 255, 255] as RGB,
};

function f(doc: Doc, color: RGB) { doc.setFillColor(color[0], color[1], color[2]); }
function d(doc: Doc, color: RGB) { doc.setDrawColor(color[0], color[1], color[2]); }
function t(doc: Doc, color: RGB) { doc.setTextColor(color[0], color[1], color[2]); }

function formatPrice(val: string): string {
  const n = Number(val);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

async function fetchBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function drawCover(doc: Doc, W: number, H: number) {
  f(doc, C.NAVY);
  doc.rect(0, 0, W, H, 'F');

  f(doc, C.GOLD);
  doc.rect(0, 0, W, 2.5, 'F');
  doc.rect(0, H - 2.5, W, 2.5, 'F');

  const midY = H / 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(34);
  t(doc, C.WHITE);
  doc.text('WRIST CAVIAR', W / 2, midY - 22, { align: 'center' });

  d(doc, C.GOLD);
  doc.setLineWidth(0.4);
  doc.line(W / 2 - 36, midY - 13, W / 2 + 36, midY - 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  t(doc, C.LIGHT_MUTED);
  doc.text('PRIVATE WATCH CATALOG', W / 2, midY - 4, { align: 'center' });

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9.5);
  t(doc, C.GOLD);
  doc.text('Curated Luxury Timepieces', W / 2, midY + 10, { align: 'center' });

  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  t(doc, C.MUTED);
  doc.text(dateStr, W / 2, H - 22, { align: 'center' });

  doc.setFontSize(7);
  doc.text('PRIVATE & CONFIDENTIAL', W / 2, H - 14, { align: 'center' });
}

function drawPageHeader(doc: Doc, W: number) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  t(doc, C.NAVY);
  doc.text('WRIST CAVIAR', W - 12, 9, { align: 'right' });

  d(doc, C.GOLD);
  doc.setLineWidth(0.3);
  doc.line(12, 12, W - 12, 12);
}

function drawPageFooter(doc: Doc, W: number, H: number, pageNum: number, total: number) {
  const fy = H - 10;

  d(doc, C.CARD_BORDER);
  doc.setLineWidth(0.2);
  doc.line(12, fy - 4, W - 12, fy - 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  t(doc, C.MUTED);
  doc.text('Wrist Caviar', 12, fy);
  doc.text('PRIVATE & CONFIDENTIAL', W / 2, fy, { align: 'center' });
  doc.text(`${pageNum} / ${total}`, W - 12, fy, { align: 'right' });
}

function drawImagePlaceholder(doc: Doc, x: number, y: number, w: number, h: number) {
  f(doc, C.PLACEHOLDER_BG);
  d(doc, C.CARD_BORDER);
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, h, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  t(doc, C.PLACEHOLDER_TEXT);
  doc.text('NO IMAGE', x + w / 2, y + h / 2 + 1, { align: 'center' });
}

function drawMetaRow(doc: Doc, x: number, y: number, label: string, value: string, maxW: number) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  t(doc, C.MUTED);
  doc.text(label, x, y);

  doc.setFontSize(8.5);
  t(doc, C.DARK);
  doc.text(value, x, y + 5, { maxWidth: maxW });
}

function drawWatchCard(
  doc: Doc,
  watch: Watch,
  imgData: string | null,
  cx: number,
  cy: number,
  cw: number,
  ch: number,
) {
  f(doc, C.CARD_BG);
  d(doc, C.CARD_BORDER);
  doc.setLineWidth(0.2);
  doc.roundedRect(cx, cy, cw, ch, 2, 2, 'FD');

  // Gold accent bar at top of card
  f(doc, C.GOLD);
  doc.rect(cx + 2, cy, cw - 4, 1.5, 'F');

  const imgX = cx + 10;
  const imgY = cy + 10;
  const imgW = 52;
  const imgH = 74;

  if (imgData) {
    try {
      const fmt = imgData.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(imgData, fmt, imgX, imgY, imgW, imgH);
    } catch {
      drawImagePlaceholder(doc, imgX, imgY, imgW, imgH);
    }
  } else {
    drawImagePlaceholder(doc, imgX, imgY, imgW, imgH);
  }

  const tx = imgX + imgW + 10;
  const ty = cy + 14;
  const tw = cw - (imgX - cx) - imgW - 10 - 8;

  // Brand
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  t(doc, C.NAVY);
  doc.text((watch.brand ?? '').toUpperCase() || '—', tx, ty, { maxWidth: tw });

  // Model (up to 2 lines)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  t(doc, C.DARK);
  const modelLines = doc.splitTextToSize(watch.model ?? '—', tw) as string[];
  doc.text(modelLines.slice(0, 2), tx, ty + 9);

  // Gold separator
  const modelHeight = Math.min(modelLines.length, 2) * 5.5;
  const sepY = ty + 9 + modelHeight + 5;
  d(doc, C.GOLD);
  doc.setLineWidth(0.35);
  doc.line(tx, sepY, tx + Math.min(tw, 90), sepY);

  // Price
  const priceStr =
    watch.priceMin == null && watch.priceMax == null
      ? '—'
      : watch.priceMin === watch.priceMax || watch.priceMax == null
        ? formatPrice(watch.priceMin ?? watch.priceMax ?? '0')
        : watch.priceMin == null
          ? formatPrice(watch.priceMax)
          : `${formatPrice(watch.priceMin)} – ${formatPrice(watch.priceMax)}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  t(doc, C.GOLD);
  doc.text(priceStr, tx, sepY + 9, { maxWidth: tw });

  // Metadata rows
  let metaY = sepY + 22;
  drawMetaRow(doc, tx, metaY, 'CONDITION', watch.condition ?? '—', tw);

  if (watch.serialNumber) {
    metaY += 13;
    drawMetaRow(doc, tx, metaY, 'SERIAL', watch.serialNumber, tw);
  }
}

export async function generateCatalogPdf(watches: Watch[]): Promise<void> {
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const W = 210;
  const H = 297;

  // Pre-load images in parallel (silently skip on CORS/network failure)
  const imageMap: Record<string, string | null> = {};
  await Promise.all(
    watches.map(async (w) => {
      imageMap[w.id] = w.imageUrl ? await fetchBase64(w.imageUrl) : null;
    }),
  );

  // Cover
  drawCover(doc, W, H);

  // Watch pages — 2 per page
  const CARDS_PER_PAGE = 2;
  const totalPages = Math.ceil(watches.length / CARDS_PER_PAGE);
  const CARD_Y = [28, 158] as const;

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    doc.addPage();
    drawPageHeader(doc, W);
    drawPageFooter(doc, W, H, pageIdx + 1, totalPages);

    const batch = watches.slice(pageIdx * CARDS_PER_PAGE, (pageIdx + 1) * CARDS_PER_PAGE);
    batch.forEach((watch, idx) => {
      drawWatchCard(doc, watch, imageMap[watch.id] ?? null, 12, CARD_Y[idx], 186, 118);
    });
  }

  const dateTag = new Date().toISOString().split('T')[0];
  doc.save(`wrist-caviar-catalog-${dateTag}.pdf`);
}
