import { CatalogSkeleton } from '@/components/CatalogSkeleton';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

export default function WatchesLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="sf-container flex-1 py-10 sm:py-12">
        <div className="mb-10 space-y-3">
          <div className="sf-skeleton h-2.5 w-20" />
          <div className="sf-skeleton h-9 w-56 max-w-full" />
          <div className="sf-skeleton h-4 w-72 max-w-full" />
        </div>
        <CatalogSkeleton />
      </main>
      <SiteFooter />
    </div>
  );
}
