'use client';

import Link from 'next/link';

export default function RadarImportsPage() {
  return (
    <section className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">WhatsApp Imports</h1>
          <p className="ui-subtitle">Upload and manage WhatsApp group exports.</p>
        </div>
        <Link href="/radar" className="ui-btn-secondary px-3 py-2">
          Back to Radar
        </Link>
      </header>

      <article className="rounded-2xl border border-dashed border-white/15 bg-panel/60 px-6 py-16 text-center">
        <p className="text-base font-medium text-white/80">No imports yet.</p>
        <p className="mt-2 text-sm text-muted">
          Export a WhatsApp group chat as a .txt file and upload it here to begin parsing.
        </p>
      </article>
    </section>
  );
}
