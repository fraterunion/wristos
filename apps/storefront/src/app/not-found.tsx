import Link from 'next/link';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="minimal" />
      <main className="sf-container flex flex-1 flex-col items-center justify-center py-16 text-center">
        <p className="sf-eyebrow">404</p>
        <h1 className="sf-display mt-4 text-3xl text-white">Pieza no encontrada</h1>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/40">
          Este reloj no está disponible en el catálogo público.
        </p>
        <Link href="/watches" className="sf-btn-secondary mt-10">
          Ver catálogo
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
