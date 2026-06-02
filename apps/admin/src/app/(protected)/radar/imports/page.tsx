'use client';

import Link from 'next/link';

export default function RadarImportsPage() {
  return (
    <section className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Importaciones de WhatsApp</h1>
          <p className="ui-subtitle">Sube y administra exportaciones de grupos de WhatsApp.</p>
        </div>
        <Link href="/radar" className="ui-btn-secondary px-3 py-2">
          Volver al radar
        </Link>
      </header>

      <article className="ui-card space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Cómo funcionan las importaciones</h2>
          <p className="mt-2 text-sm text-muted leading-relaxed">
            Las importaciones se inician desde la{' '}
            <Link href="/radar" className="text-accent underline-offset-2 hover:underline">
              página principal del radar
            </Link>
            . Sube una exportación de grupo de WhatsApp (.txt) y el sistema procesará cada
            mensaje, lo clasificará con IA y extraerá listados con oportunidades de compra y venta.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-surface/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Paso 1</p>
            <p className="mt-2 text-sm text-white">Subir exportación .txt</p>
            <p className="mt-1 text-xs text-muted">
              Exporta tu grupo de WhatsApp desde la app (Sin Multimedia). Sube el archivo .txt.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-surface/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Paso 2</p>
            <p className="mt-2 text-sm text-white">Procesar y desduplicar</p>
            <p className="mt-1 text-xs text-muted">
              Los mensajes se procesan, los de multimedia y del sistema se omiten, y los duplicados se descartan.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-surface/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Paso 3</p>
            <p className="mt-2 text-sm text-white">Clasificar con IA</p>
            <p className="mt-1 text-xs text-muted">
              Claude Haiku lee cada mensaje y extrae intención, marca, precio y número de referencia.
            </p>
          </div>
        </div>

        <div className="flex justify-start">
          <Link href="/radar" className="ui-btn-primary px-4 py-2">
            Iniciar una importación
          </Link>
        </div>
      </article>

      <article className="rounded-xl border border-white/10 bg-panel/60 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Nota</p>
        <p className="mt-2 text-sm text-muted leading-relaxed">
          El historial completo de importaciones aún no está disponible en la interfaz. El estado y los
          conteos de cada importación se muestran en la página principal del radar justo después de cada carga.
        </p>
      </article>
    </section>
  );
}
