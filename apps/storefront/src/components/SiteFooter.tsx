import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-white/[0.06] bg-panel/30">
      <div className="sf-container flex flex-col gap-4 py-12 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="sf-eyebrow">Wrist Caviar</p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/40">
            Relojes de lujo seleccionados con cuidado. Autenticidad, discreción y servicio
            personalizado.
          </p>
        </div>
        <Link
          href="/watches"
          className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/45 transition hover:text-emerald"
        >
          Ver colección →
        </Link>
      </div>
    </footer>
  );
}
