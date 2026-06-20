const BADGES = [
  'Authenticity Guaranteed',
  'Fully Verified',
  'Secure Payment',
  'Worldwide Shipping',
] as const;

export function TrustBadges({ compact = false }: { compact?: boolean }) {
  return (
    <ul
      className={
        compact
          ? 'grid grid-cols-2 gap-x-3 gap-y-2'
          : 'space-y-2.5 border-t border-white/[0.06] pt-5'
      }
    >
      {BADGES.map((badge) => (
        <li
          key={badge}
          className={`flex items-center gap-2 text-white/40 ${compact ? 'text-[10px]' : 'text-xs'}`}
        >
          <span className="h-px w-3 shrink-0 bg-champagne/50" aria-hidden />
          {badge}
        </li>
      ))}
    </ul>
  );
}
