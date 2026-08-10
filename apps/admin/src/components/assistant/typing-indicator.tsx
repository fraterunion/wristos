'use client';

export function TypingIndicator() {
  return (
    <div
      className="ui-msg-in flex items-center gap-2.5"
      role="status"
      aria-label="WristOS está preparando la respuesta."
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/12 text-[9px] font-semibold text-emerald-200"
        aria-hidden
      >
        W
      </span>
      <div className="flex items-center gap-1.5 py-2">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/35 motion-reduce:animate-none"
            style={{ animationDelay: `${dot * 160}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
