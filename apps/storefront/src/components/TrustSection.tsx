const TRUST_ITEMS = [
  {
    title: 'Authenticity Guaranteed',
    description:
      'Every piece is inspected, verified, and documented before it reaches our catalog.',
  },
  {
    title: 'Worldwide Shipping',
    description:
      'Fully insured delivery for collectors across Mexico and international destinations.',
  },
  {
    title: 'Personal Concierge',
    description:
      'Speak directly with our team. Private guidance from inquiry to delivery.',
  },
] as const;

export function TrustSection() {
  return (
    <section className="border-y border-white/[0.06] bg-panel">
      <div className="sf-container py-10 sm:py-12">
        <div className="grid grid-cols-1 gap-px bg-white/[0.06] md:grid-cols-3">
          {TRUST_ITEMS.map((item) => (
            <article key={item.title} className="sf-trust-card bg-panel">
              <div className="mb-4 h-px w-8 bg-champagne/60" />
              <h3 className="font-display text-lg text-white">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/45">{item.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
