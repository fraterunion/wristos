import Link from 'next/link';

import { SiteHeader } from '@/components/SiteHeader';

export default function NotFound() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="sf-container py-16 text-center">
        <h1 className="text-2xl font-semibold text-white">Pieza no encontrada</h1>
        <p className="mt-2 text-sm text-muted">
          Este reloj no está disponible en el catálogo público.
        </p>
        <Link href="/watches" className="sf-btn-secondary mt-8 inline-flex">
          Ver catálogo
        </Link>
      </main>
    </div>
  );
}
