export function CatalogSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-x-8 md:gap-y-14 lg:gap-x-12 lg:gap-y-16">
      {Array.from({ length: 4 }).map((_, i) => (
        <article key={i} className="space-y-5">
          <div className="sf-skeleton aspect-[3/4] w-full" />
          <div className="space-y-3 px-1">
            <div className="sf-skeleton h-2.5 w-16" />
            <div className="sf-skeleton h-7 w-3/4" />
            <div className="sf-skeleton h-3 w-24" />
            <div className="sf-skeleton h-4 w-28" />
          </div>
        </article>
      ))}
    </div>
  );
}
