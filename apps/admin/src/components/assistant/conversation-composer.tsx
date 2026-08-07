'use client';

import { Mic, Send } from 'lucide-react';
import { FormEvent } from 'react';

export function ConversationComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  notice,
  variant = 'hero',
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  placeholder: string;
  notice?: string | null;
  variant?: 'hero' | 'bar';
}) {
  const shell =
    variant === 'hero'
      ? 'rounded-[1.75rem] border border-white/15 bg-panel p-2 shadow-lg shadow-black/20 transition focus-within:border-emerald-300/40 focus-within:ring-2 focus-within:ring-emerald-400/25'
      : 'rounded-[1.75rem] border border-white/15 bg-panel/95 p-2.5 shadow-2xl shadow-black/40 backdrop-blur transition focus-within:border-emerald-300/40 focus-within:ring-2 focus-within:ring-emerald-400/25';
  const inputSize = variant === 'hero' ? 'py-3 text-[15px]' : 'py-2.5 text-sm';
  const buttonSize = variant === 'hero' ? 'h-11 w-11' : 'h-10 w-10';

  return (
    <div className={variant === 'bar' ? 'sticky bottom-3 z-20 pb-[max(0px,env(safe-area-inset-bottom))]' : undefined}>
      <form onSubmit={onSubmit} className={`flex items-center gap-1.5 ${shell}`} aria-label="Compositor del asistente">
        <input
          className={`min-w-0 flex-1 bg-transparent px-3 outline-none placeholder:text-white/35 ${inputSize}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label="Solicitud en lenguaje natural, próximamente"
        />
        <button
          type="button"
          disabled
          className={`flex shrink-0 items-center justify-center rounded-full text-white/20 ${buttonSize}`}
          aria-label="Micrófono no disponible"
          title="Próximamente"
        >
          <Mic className="h-5 w-5" />
        </button>
        <button
          type="submit"
          className={`flex shrink-0 items-center justify-center rounded-full bg-white text-black transition active:scale-95 ${buttonSize}`}
          aria-label="Enviar"
        >
          <Send className="h-5 w-5" />
        </button>
      </form>
      {notice ? <p className="mt-2 px-3 text-xs text-amber-200">{notice}</p> : null}
    </div>
  );
}
