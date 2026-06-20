import Link from 'next/link';

import { TrustBadges } from './TrustBadges';

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-white/[0.06] bg-panel">
      <div className="sf-container py-12 sm:py-14">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="sf-eyebrow">Wrist Caviar</p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/40">
              Private dealer of exceptional timepieces. Verified authenticity, collector-first
              service, worldwide delivery.
            </p>
          </div>
          <div>
            <p className="sf-eyebrow mb-4">Navigate</p>
            <Link
              href="/watches"
              className="block text-sm text-white/45 transition hover:text-champagne-light"
            >
              View Collection
            </Link>
          </div>
          <div>
            <p className="sf-eyebrow mb-4">Assurance</p>
            <TrustBadges compact />
          </div>
        </div>
        <div className="sf-divider mt-10" />
        <p className="mt-6 text-[10px] uppercase tracking-[0.2em] text-white/25">
          © {new Date().getFullYear()} Wrist Caviar. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
