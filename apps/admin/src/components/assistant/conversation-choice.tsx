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
    <div
      className="ui-msg-in flex flex-wrap gap-2 pl-7"
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(option.id, option.label)}
          className="flex min-h-11 max-w-full flex-col items-start justify-center rounded-2xl bg-white/[0.06] px-3.5 py-2 text-left ring-1 ring-white/10 transition hover:bg-white/[0.1] hover:ring-white/18 active:scale-[0.98] disabled:opacity-50"
        >
          <span className="text-[13.5px] font-medium leading-tight text-white/90">
            {option.label}
          </span>
          {option.context ? (
            <span className="mt-0.5 text-[11px] leading-tight text-white/40">{option.context}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
