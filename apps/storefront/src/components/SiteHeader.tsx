import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-md">
      <div className="sf-container flex h-14 items-center justify-between sm:h-16">
        <Link href="/" className="group">
          <span className="sf-eyebrow text-[9px] tracking-[0.34em] transition group-hover:text-champagne-light">
            Wrist Caviar
          </span>
        </Link>

        <nav className="flex items-center gap-8">
          <Link
            href="/watches"
            className="text-[10px] font-medium uppercase tracking-[0.22em] text-silver transition hover:text-white"
          >
            Collection
          </Link>
        </nav>
      </div>
    </header>
  );
}
