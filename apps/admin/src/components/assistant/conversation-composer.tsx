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
      ? 'rounded-2xl border border-white/15 bg-panel p-2.5 shadow-lg shadow-black/20'
      : 'rounded-2xl border border-white/15 bg-panel/95 p-3 shadow-2xl shadow-black/40 backdrop-blur';
  const inputSize = variant === 'hero' ? 'py-2.5 text-[15px]' : 'py-2 text-sm';
  const buttonPad = variant === 'hero' ? 'p-2.5' : 'p-3';

  return (
    <div className={variant === 'bar' ? 'sticky bottom-3 z-20' : undefined}>
      <form onSubmit={onSubmit} className={`flex items-center gap-2 ${shell}`} aria-label="Compositor del asistente">
        <input
          className={`min-w-0 flex-1 bg-transparent px-2.5 outline-none placeholder:text-white/35 ${inputSize}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label="Solicitud en lenguaje natural, próximamente"
        />
        <button type="button" disabled className={`rounded-xl text-white/20 ${buttonPad}`} aria-label="Micrófono no disponible" title="Próximamente">
          <Mic className="h-5 w-5" />
        </button>
        <button type="submit" className={`rounded-xl bg-white text-black ${buttonPad}`} aria-label="Enviar">
          <Send className="h-5 w-5" />
        </button>
      </form>
      {notice ? <p className="mt-2 px-2 text-xs text-amber-200">{notice}</p> : null}
    </div>
  );
}
