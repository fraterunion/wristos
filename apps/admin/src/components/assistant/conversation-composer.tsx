'use client';

import { Mic, MicOff, Send, Square } from 'lucide-react';
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceComposerState = 'idle' | 'listening' | 'unsupported' | 'error';

export function ConversationComposer({
  value,
  onChange,
  onSubmit,
  placeholder = 'Escribe o habla…',
  notice,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  placeholder?: string;
  notice?: string | null;
  disabled?: boolean;
  /** @deprecated kept for call-site compatibility; always sticky bar. */
  variant?: 'hero' | 'bar';
}) {
  const [voiceState, setVoiceState] = useState<VoiceComposerState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const baseTextRef = useRef('');
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSpeechSupported(getSpeechRecognitionCtor() != null);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 48), 160)}px`;
  }, [value]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* */
      }
      recognitionRef.current = null;
    };
  }, []);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* */
    }
    recognitionRef.current = null;
    setVoiceState('idle');
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setVoiceState('unsupported');
      setVoiceError('La voz no está disponible en este navegador.');
      return;
    }
    setVoiceError(null);
    baseTextRef.current = value.trim() ? `${value.trim()} ` : '';
    try {
      const recognition = new Ctor();
      recognition.lang = 'es-MX';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i += 1) {
          transcript += event.results[i]?.[0]?.transcript ?? '';
        }
        onChange(`${baseTextRef.current}${transcript}`.trimStart());
      };
      recognition.onerror = (event) => {
        const code = event.error ?? '';
        if (code === 'aborted' || code === 'no-speech') {
          setVoiceState('idle');
          return;
        }
        setVoiceState('error');
        setVoiceError(
          code === 'not-allowed'
            ? 'Activa el micrófono para hablar con WristOS.'
            : 'No pude escuchar. Intenta de nuevo o escribe.',
        );
        recognitionRef.current = null;
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        setVoiceState((current) => (current === 'listening' ? 'idle' : current));
      };
      recognitionRef.current = recognition;
      recognition.start();
      setVoiceState('listening');
    } catch {
      setVoiceState('error');
      setVoiceError('No pude iniciar el micrófono.');
    }
  }, [onChange, value]);

  const toggleVoice = () => {
    if (disabled) return;
    if (voiceState === 'listening') {
      stopListening();
      return;
    }
    startListening();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!disabled && value.trim()) {
        event.currentTarget.form?.requestSubmit();
      }
    }
  };

  const listening = voiceState === 'listening';
  const canSend = !!value.trim() && !disabled;

  return (
    <div
      className="sticky bottom-0 z-20 bg-gradient-to-t from-surface via-surface to-transparent pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
      data-testid="assistant-composer"
    >
      <form
        onSubmit={(event) => {
          if (listening) stopListening();
          onSubmit(event);
        }}
        className={`flex items-end gap-2 rounded-[1.65rem] px-2.5 py-2 transition ${
          listening
            ? 'bg-emerald-400/[0.08] ring-1 ring-emerald-300/35'
            : 'bg-white/[0.06] ring-1 ring-white/[0.08] focus-within:ring-white/18'
        }`}
        aria-label="Compositor del asistente"
      >
        <textarea
          ref={textareaRef}
          rows={1}
          className="max-h-[160px] min-h-[48px] min-w-0 flex-1 resize-none bg-transparent px-3 py-3 text-[15.5px] leading-6 outline-none placeholder:text-white/35"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={listening ? 'Escuchando…' : placeholder}
          aria-label="Escribe o habla con WristOS"
          disabled={disabled}
        />
        {speechSupported === null ? (
          <span className="mb-0.5 h-11 w-11 shrink-0" aria-hidden />
        ) : speechSupported || listening ? (
          <button
            type="button"
            onClick={toggleVoice}
            disabled={disabled}
            className={`relative mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
              listening
                ? 'bg-emerald-400 text-black'
                : 'text-white/75 hover:bg-white/10 hover:text-white'
            }`}
            aria-label={listening ? 'Detener dictado' : 'Hablar con WristOS'}
            title={listening ? 'Detener' : 'Hablar'}
            aria-pressed={listening}
            data-testid="assistant-mic"
          >
            {listening ? (
              <>
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-300/30 motion-reduce:animate-none" aria-hidden />
                <Square className="relative h-3.5 w-3.5 fill-current" />
              </>
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/20"
            aria-label="Micrófono no disponible en este navegador"
            title="Voz no disponible en este navegador"
            data-testid="assistant-mic-unsupported"
          >
            <MicOff className="h-5 w-5" />
          </button>
        )}
        <button
          type="submit"
          disabled={!canSend}
          className={`mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
            canSend
              ? 'bg-white text-black'
              : 'bg-white/10 text-white/25'
          }`}
          aria-label="Enviar"
          data-testid="assistant-send"
        >
          <Send className="h-4 w-4" strokeWidth={2.25} />
        </button>
      </form>
      {listening ? (
        <div className="mt-2.5 flex items-center justify-center gap-2" role="status">
          <span className="flex h-3 items-end gap-0.5" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="w-0.5 animate-pulse rounded-full bg-emerald-300/80 motion-reduce:animate-none"
                style={{
                  height: `${6 + ((i * 3) % 10)}px`,
                  animationDelay: `${i * 90}ms`,
                }}
              />
            ))}
          </span>
          <p className="text-xs text-emerald-200/90">Escuchando… toca para detener</p>
        </div>
      ) : null}
      {voiceError ? (
        <p className="mt-2 px-3 text-center text-xs text-amber-200/90" role="alert">
          {voiceError}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-2 px-3 text-center text-xs text-amber-200/90">{notice}</p>
      ) : null}
    </div>
  );
}
