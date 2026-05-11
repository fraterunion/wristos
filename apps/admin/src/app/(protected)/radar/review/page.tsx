'use client';

import Link from 'next/link';

export default function RadarReviewPage() {
  return (
    <section className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Review Queue</h1>
          <p className="ui-subtitle">AI-detected listings awaiting human confirmation.</p>
        </div>
        <Link href="/radar" className="ui-btn-secondary px-3 py-2">
          Back to Radar
        </Link>
      </header>

      <article className="rounded-2xl border border-dashed border-white/15 bg-panel/60 px-6 py-16 text-center">
        <p className="text-base font-medium text-white/80">No listings to review.</p>
        <p className="mt-2 text-sm text-muted">
          Upload a WhatsApp export and AI-classified listings will appear here for confirmation.
        </p>
        <div className="mt-6">
          <Link href="/radar/imports" className="ui-btn-primary px-5 py-2.5">
            Upload WhatsApp Export
          </Link>
        </div>
      </article>
    </section>
  );
}
