'use client';

import Link from 'next/link';
import { use } from 'react';

export default function RadarContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <section className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Contact Profile</h1>
          <p className="ui-subtitle font-mono text-xs">{id}</p>
        </div>
        <Link href="/radar" className="ui-btn-secondary px-3 py-2">
          Back to Radar
        </Link>
      </header>

      <article className="rounded-2xl border border-dashed border-white/15 bg-panel/60 px-6 py-16 text-center">
        <p className="text-sm text-muted">Contact profile view coming soon.</p>
      </article>
    </section>
  );
}
