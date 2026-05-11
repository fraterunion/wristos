'use client';

import Link from 'next/link';

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-white/10 bg-panel p-5">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
    </article>
  );
}

export default function RadarPage() {
  return (
    <section className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">AI Market Radar</h1>
          <p className="ui-subtitle">Market memory from WhatsApp conversations.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/radar/review" className="ui-btn-secondary px-3 py-2">
            Review Queue
          </Link>
          <Link href="/radar/imports" className="ui-btn-primary px-3 py-2">
            Upload WhatsApp Export
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Listings" value="—" />
        <StatCard label="Pending Review" value="—" />
        <StatCard label="Imports" value="—" />
        <StatCard label="Contacts" value="—" />
      </section>

      <article className="rounded-2xl border border-dashed border-white/15 bg-panel/60 px-6 py-16 text-center">
        <p className="text-base font-medium text-white/80">No radar data yet.</p>
        <p className="mt-2 text-sm text-muted">
          Upload a WhatsApp .txt export to start building your market memory.
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
