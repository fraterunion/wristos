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
  placeholder,
  notice,
  disabled = false,
  variant = 'bar',
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  placeholder: string;
  notice?: string | null;
  disabled?: boolean;
  variant?: 'hero' | 'bar';
}) {
  const [voiceState, setVoiceState] = useState<VoiceComposerState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const baseTextRef = useRef('');

  const speechSupported =
    typeof window !== 'undefined' && getSpeechRecognitionCtor() != null;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
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
        const form = event.currentTarget.form;
        form?.requestSubmit();
      }
    }
  };

  const listening = voiceState === 'listening';
  const shell = listening
    ? 'rounded-[1.75rem] border border-emerald-300/40 bg-emerald-400/[0.07] p-2.5 shadow-lg shadow-emerald-900/20 ring-2 ring-emerald-400/20 transition'
    : 'rounded-[1.75rem] border border-white/12 bg-panel/95 p-2.5 shadow-2xl shadow-black/40 backdrop-blur transition focus-within:border-emerald-300/35 focus-within:ring-2 focus-within:ring-emerald-400/20';

  return (
    <div
      className={
        variant === 'bar'
          ? 'sticky bottom-0 z-20 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2'
          : undefined
      }
    >
      <form
        onSubmit={(event) => {
          if (listening) stopListening();
          onSubmit(event);
        }}
        className={`flex items-end gap-1.5 ${shell}`}
        aria-label="Compositor del asistente"
      >
        <textarea
          ref={textareaRef}
          rows={1}
          className="max-h-[140px] min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] leading-5 outline-none placeholder:text-white/35"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={listening ? 'Escuchando…' : placeholder}
          aria-label="Escribe o habla con WristOS"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={toggleVoice}
          disabled={disabled || (!speechSupported && voiceState !== 'listening')}
          className={`mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
            listening
              ? 'bg-emerald-400 text-black'
              : speechSupported
                ? 'text-white/70 hover:bg-white/10 hover:text-white'
                : 'text-white/25'
          }`}
          aria-label={
            listening
              ? 'Detener dictado'
              : speechSupported
                ? 'Hablar con WristOS'
                : 'Micrófono no disponible en este navegador'
          }
          title={
            listening
              ? 'Detener'
              : speechSupported
                ? 'Hablar'
                : 'Voz no disponible en este navegador'
          }
          aria-pressed={listening}
        >
          {listening ? <Square className="h-4 w-4 fill-current" /> : speechSupported ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </button>
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black transition active:scale-95 disabled:opacity-35"
          aria-label="Enviar"
        >
          <Send className="h-5 w-5" />
        </button>
      </form>
      {listening ? (
        <p className="mt-2 px-3 text-xs text-emerald-200/90" role="status">
          Escuchando… habla con naturalidad. Toca el micrófono para detener.
        </p>
      ) : null}
      {voiceError ? (
        <p className="mt-2 px-3 text-xs text-amber-200" role="alert">
          {voiceError}
        </p>
      ) : null}
      {notice ? <p className="mt-2 px-3 text-xs text-amber-200">{notice}</p> : null}
    </div>
  );
}
