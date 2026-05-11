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

      <article className="ui-card space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">How imports work</h2>
          <p className="mt-2 text-sm text-muted leading-relaxed">
            Imports are initiated from the{' '}
            <Link href="/radar" className="text-accent underline-offset-2 hover:underline">
              Radar main page
            </Link>
            . Upload a WhatsApp group export (.txt) and the system will parse every
            message, classify it with AI, and extract listings for buy/sell opportunities.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-surface/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Step 1</p>
            <p className="mt-2 text-sm text-white">Upload .txt export</p>
            <p className="mt-1 text-xs text-muted">
              Export your WhatsApp group from the app (Without Media). Upload the .txt file.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-surface/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Step 2</p>
            <p className="mt-2 text-sm text-white">Parse &amp; deduplicate</p>
            <p className="mt-1 text-xs text-muted">
              Messages are parsed, media and system messages are skipped, duplicates are ignored.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-surface/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Step 3</p>
            <p className="mt-2 text-sm text-white">Classify with AI</p>
            <p className="mt-1 text-xs text-muted">
              Claude Haiku reads each message and extracts intent, brand, price, and reference number.
            </p>
          </div>
        </div>

        <div className="flex justify-start">
          <Link href="/radar" className="ui-btn-primary px-4 py-2">
            Start an import
          </Link>
        </div>
      </article>

      <article className="rounded-xl border border-white/10 bg-panel/60 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Note</p>
        <p className="mt-2 text-sm text-muted leading-relaxed">
          A full import history list is not yet available in the UI. Import status and
          counts are shown on the Radar main page immediately after each upload.
        </p>
      </article>
    </section>
  );
}
