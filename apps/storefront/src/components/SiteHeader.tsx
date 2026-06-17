import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-white/10 bg-surface/90 backdrop-blur-md">
      <div className="sf-container flex flex-col gap-1 py-8 sm:py-10">
        <Link href="/watches" className="group inline-block">
          <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-muted">
            Wrist Caviar
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white transition group-hover:text-white/90 sm:text-3xl">
            Curated pre-owned luxury watches
          </h1>
        </Link>
      </div>
    </header>
  );
}
