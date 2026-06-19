import { CatalogSkeleton } from '@/components/CatalogSkeleton';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

export default function WatchesLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="minimal" />
      <main className="sf-container flex-1 py-12 sm:py-16 lg:py-20">
        <div className="mb-12 space-y-3 sm:mb-16">
          <div className="sf-skeleton h-3 w-24" />
          <div className="sf-skeleton h-10 w-64 max-w-full" />
          <div className="sf-skeleton h-4 w-48" />
        </div>
        <CatalogSkeleton />
      </main>
      <SiteFooter />
    </div>
  );
}
