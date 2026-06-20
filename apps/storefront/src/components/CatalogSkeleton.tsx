export function CatalogSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
      {Array.from({ length: 6 }).map((_, i) => (
        <article key={i} className="border border-white/[0.06] bg-panel">
          <div className="sf-skeleton aspect-[3/4] w-full" />
          <div className="space-y-3 border-t border-white/[0.06] px-5 py-5">
            <div className="sf-skeleton h-2 w-14" />
            <div className="sf-skeleton h-6 w-4/5" />
            <div className="flex justify-between">
              <div className="sf-skeleton h-3 w-20" />
              <div className="sf-skeleton h-4 w-24" />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
