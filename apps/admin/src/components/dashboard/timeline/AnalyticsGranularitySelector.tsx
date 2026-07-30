'use client';

import type { TimelineGranularity } from '@/types/domain';

const OPTIONS: { value: TimelineGranularity; label: string }[] = [
  { value: 'day', label: 'Día' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'year', label: 'Año' },
];

export function AnalyticsGranularitySelector({
  value,
  onChange,
}: {
  value: TimelineGranularity;
  onChange: (g: TimelineGranularity) => void;
}) {
  return (
    <div
      className="flex max-w-full overflow-x-auto rounded-lg border border-white/10 bg-panel p-1 overscroll-x-contain"
      role="group"
      aria-label="Granularidad del timeline"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`shrink-0 rounded-md px-3 py-1.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 ${
            value === option.value
              ? 'bg-accent font-semibold text-black'
              : 'text-muted hover:bg-white/5 hover:text-white'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
