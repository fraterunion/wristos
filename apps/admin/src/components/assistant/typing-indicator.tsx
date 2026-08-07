'use client';

// Shown only while a real request is in flight (see ConversationThread).
// Never implies reasoning steps — WristOS is not narrating an internal
// process, it is just waiting on the same request the user can see pending.

export function TypingIndicator() {
  return (
    <div className="ui-msg-in flex items-center gap-2" role="status" aria-label="WristOS está preparando la respuesta.">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-[10px] font-semibold text-emerald-200" aria-hidden>
        W
      </span>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-md bg-panel px-3.5 py-3">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40 motion-reduce:animate-none"
            style={{ animationDelay: `${dot * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
