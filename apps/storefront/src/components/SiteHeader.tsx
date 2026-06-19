import Link from 'next/link';

type Props = {
  variant?: 'default' | 'minimal';
};

export function SiteHeader({ variant = 'default' }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-surface/80 backdrop-blur-xl">
      <div className="sf-container flex h-16 items-center justify-between sm:h-[4.5rem]">
        <Link href="/" className="group flex flex-col">
          <span className="sf-eyebrow text-[9px] tracking-[0.38em] transition group-hover:text-white/80">
            Wrist Caviar
          </span>
          {variant === 'default' ? (
            <span className="hidden text-[11px] text-white/35 sm:block">
              Curated luxury timepieces
            </span>
          ) : null}
        </Link>

        <nav className="flex items-center gap-6">
          <Link
            href="/watches"
            className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/55 transition hover:text-white"
          >
            Colección
          </Link>
        </nav>
      </div>
    </header>
  );
}
