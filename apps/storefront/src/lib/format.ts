export function formatMxn(value: string | number) {
  const n = typeof value === 'string' ? Number(value) : value;
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

export function watchTitle(watch: { brand: string; model: string }) {
  return `${watch.brand} ${watch.model}`;
}
