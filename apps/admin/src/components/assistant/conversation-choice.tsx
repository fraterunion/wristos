'use client';

export interface ConversationChoiceOption {
  id: string;
  label: string;
  context?: string;
}

export function ConversationChoices({
  options,
  onSelect,
  disabled,
  delayMs = 0,
}: {
  options: ConversationChoiceOption[];
  onSelect: (id: string, label: string) => void;
  disabled?: boolean;
  delayMs?: number;
}) {
  if (!options.length) return null;
  return (
    <div className="ui-msg-in flex flex-wrap gap-2 pl-8" style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(option.id, option.label)}
          className="flex min-h-11 flex-col items-start justify-center rounded-2xl border border-emerald-300/25 bg-emerald-400/[0.07] px-4 py-1.5 text-left transition hover:bg-emerald-400/[0.14] active:scale-[0.97] disabled:opacity-50"
        >
          <span className="text-[13px] font-medium leading-tight text-emerald-100">{option.label}</span>
          {option.context ? <span className="text-[11px] leading-tight text-emerald-200/60">{option.context}</span> : null}
        </button>
      ))}
    </div>
  );
}
