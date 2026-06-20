const BRANDS = [
  'Rolex',
  'Patek Philippe',
  'Audemars Piguet',
  'Omega',
  'Cartier',
  'Tudor',
  'Breitling',
  'IWC',
  'Panerai',
  'Jaeger-LeCoultre',
] as const;

export function BrandsSection() {
  return (
    <section className="border-t border-white/[0.06]">
      <div className="sf-container py-12 sm:py-14">
        <p className="sf-eyebrow mb-8 text-center">Houses We Curate</p>
        <div className="sf-gallery-scroll justify-start gap-x-10 px-1 sm:justify-center sm:gap-x-14">
          {BRANDS.map((brand) => (
            <span
              key={brand}
              className="shrink-0 snap-start font-display text-base tracking-wide text-white/35 transition hover:text-champagne/80 sm:text-lg"
            >
              {brand}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
