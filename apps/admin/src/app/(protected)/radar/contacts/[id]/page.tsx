'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { IntentBadge, ReviewStatusBadge } from '@/components/radar/RadarBadges';
import { formatDate, formatPrice } from '@/components/radar/utils';
import { ApiError } from '@/lib/api-client';
import { getRadarContact } from '@/lib/radar-api';
import type { RadarContactProfile, RadarListingCard } from '@/types/radar';

// ─── Listing row ──────────────────────────────────────────────────────────────

function ListingRow({ listing }: { listing: RadarListingCard }) {
  return (
    <Link
      href={`/radar/listings/${listing.id}`}
      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-white/10 bg-surface/40 px-4 py-3 transition hover:border-white/20"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <IntentBadge intent={listing.intent} />
          <ReviewStatusBadge status={listing.reviewStatus} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm">
          {listing.brand && (
            <span className="font-medium text-white">{listing.brand}</span>
          )}
          {listing.rawModelMention && (
            <span className="text-white/70">{listing.rawModelMention}</span>
          )}
          {listing.referenceNumberExplicit && (
            <span className="font-mono text-xs text-white/50">
              {listing.referenceNumberExplicit}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted">{formatDate(listing.message.postedAt)}</p>
      </div>
      {listing.priceAmount && (
        <p className="shrink-0 text-sm font-semibold text-white">
          {formatPrice(listing.priceAmount, listing.priceCurrency)}
        </p>
      )}
    </Link>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RadarContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [contact, setContact] = useState<RadarContactProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadContact = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRadarContact(id);
      setContact(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load contact.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadContact();
  }, [loadContact]);

  const displayName = contact?.displayName ?? contact?.phone ?? id;

  return (
    <section className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">{loading ? 'Contact' : displayName}</h1>
          <p className="ui-subtitle">Radar contact profile</p>
        </div>
        <Link href="/radar" className="ui-btn-secondary px-3 py-2">
          Back to Radar
        </Link>
      </header>

      {loading ? (
        <div className="space-y-4 animate-pulse">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-white/10" />
          ))}
        </div>
      ) : error ? (
        <section className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-5">
          <p className="text-sm text-rose-100">{error}</p>
          <button
            type="button"
            onClick={() => void loadContact()}
            className="mt-3 text-sm underline text-rose-200"
          >
            Retry
          </button>
        </section>
      ) : contact ? (
        <>
          {/* Stats */}
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(
              [
                { label: 'Messages', value: String(contact.messageCount) },
                { label: 'Listings', value: String(contact.listingCount) },
                { label: 'First seen', value: formatDate(contact.firstSeenAt) },
                { label: 'Last seen', value: formatDate(contact.lastSeenAt) },
              ] as const
            ).map(({ label, value }) => (
              <article key={label} className="rounded-xl border border-white/10 bg-panel p-5">
                <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
                <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
              </article>
            ))}
          </section>

          {/* Identity */}
          <article className="ui-card space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Identity</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {contact.displayName && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">Display name</p>
                  <p className="mt-1 text-sm text-white">{contact.displayName}</p>
                </div>
              )}
              {contact.phone && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">Phone</p>
                  <p className="mt-1 font-mono text-sm text-white">{contact.phone}</p>
                </div>
              )}
              {contact.clientId && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">Client ID</p>
                  <p className="mt-1 font-mono text-sm text-white">{contact.clientId}</p>
                </div>
              )}
              {Object.keys(contact.rawIdentifiers).length > 0 && (
                <div className="sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-muted">Raw identifiers</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(contact.rawIdentifiers).map(([key, val]) => (
                      <span
                        key={key}
                        className="rounded border border-white/10 bg-surface/40 px-2 py-1 font-mono text-xs text-white/70"
                      >
                        {key}: {val}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </article>

          {/* Recent listings */}
          <article className="ui-card space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Recent Listings
            </h2>
            {contact.recentListings.length === 0 ? (
              <p className="text-sm text-muted">No listings from this contact.</p>
            ) : (
              <div className="space-y-2">
                {contact.recentListings.map((l) => (
                  <ListingRow key={l.id} listing={l} />
                ))}
              </div>
            )}
          </article>

          {/* Recent buy requests */}
          <article className="ui-card space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Recent Requests
            </h2>
            {contact.recentRequests.length === 0 ? (
              <p className="text-sm text-muted">No buy requests from this contact.</p>
            ) : (
              <div className="space-y-2">
                {contact.recentRequests.map((l) => (
                  <ListingRow key={l.id} listing={l} />
                ))}
              </div>
            )}
          </article>
        </>
      ) : null}
    </section>
  );
}
