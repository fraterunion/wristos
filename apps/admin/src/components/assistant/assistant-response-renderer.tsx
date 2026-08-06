'use client';

import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { FormEvent, useState } from 'react';
import type { JsonValue, StructuredAssistantResponse } from '@/lib/assistant-types';

function text(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function displayLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

function SafeValue({ value }: { value: JsonValue }) {
  if (value === null) return <span className="text-muted">—</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Sí' : 'No'}</span>;
  if (typeof value === 'string' || typeof value === 'number') return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    return (
      <div className="space-y-2">
        {value.slice(0, 25).map((item, index) => (
          <div key={index} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <SafeValue value={item} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {Object.entries(value).slice(0, 30).map(([key, item]) => (
        <div key={key} className="min-w-0 rounded-lg bg-white/[0.035] px-3 py-2">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {displayLabel(key)}
          </dt>
          <dd className="mt-1 break-words text-sm text-white"><SafeValue value={item} /></dd>
        </div>
      ))}
    </dl>
  );
}

function MissingFieldsForm({
  groups,
  onContinue,
}: {
  groups: JsonValue;
  onContinue: (entities: Record<string, JsonValue>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const parsed = Array.isArray(groups)
    ? groups.flatMap((group) => {
        if (!group || typeof group !== 'object' || Array.isArray(group) || !Array.isArray(group.fields)) return [];
        return group.fields.flatMap((field) => {
          if (!field || typeof field !== 'object' || Array.isArray(field)) return [];
          return typeof field.key === 'string'
            ? [{ key: field.key, question: typeof field.question === 'string' ? field.question : displayLabel(field.key) }]
            : [];
        });
      })
    : [];
  if (!parsed.length) return <div className="mt-4"><SafeValue value={groups} /></div>;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onContinue(Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])));
  };

  return (
    <form className="mt-4 space-y-3" onSubmit={submit}>
      {parsed.map((field) => (
        <label key={field.key}>
          <span className="ui-field-label normal-case tracking-normal">{field.question}</span>
          <input
            className="ui-input min-h-11"
            value={values[field.key] ?? ''}
            onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            required
            maxLength={200}
          />
        </label>
      ))}
      <button type="submit" className="ui-btn-primary min-h-11 w-full">Continuar con datos estructurados</button>
    </form>
  );
}

export function AssistantResponseRenderer({
  response,
  onSelectClient,
  onContinue,
}: {
  response: StructuredAssistantResponse;
  onSelectClient?: (id: string, label: string) => void;
  onContinue?: (entities: Record<string, JsonValue>) => void;
}) {
  const { payload } = response;
  const message = text(payload.message) ?? text(payload.summary);
  const data = payload.data;
  const isError = response.responseType === 'ERROR_RECOVERY_CARD';
  const isPreview = response.responseType === 'ACTION_PREVIEW_CARD';
  const isMissing = response.responseType === 'MISSING_FIELDS_CARD';

  const clientItems =
    response.responseType === 'ENTITY_LIST' &&
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Array.isArray(data.items)
      ? data.items
      : [];

  return (
    <article
      className={`rounded-2xl border p-4 ${
        isError
          ? 'border-rose-400/30 bg-rose-500/[0.07]'
          : isPreview
            ? 'border-amber-400/30 bg-amber-500/[0.07]'
            : 'border-white/10 bg-panel'
      }`}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {isError ? (
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" aria-hidden />
        ) : isPreview || isMissing ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">
            {isError
              ? 'No se pudo completar'
              : isPreview
                ? 'Vista previa — no ejecutada'
                : isMissing
                  ? 'Necesito más información'
                  : 'Consulta completada'}
          </p>
          {message ? <p className="mt-1 text-sm leading-6 text-white/75">{message}</p> : null}
        </div>
      </div>

      {data !== undefined ? <div className="mt-4"><SafeValue value={data} /></div> : null}
      {isPreview && payload.preview !== undefined ? (
        <div className="mt-4"><SafeValue value={payload.preview} /></div>
      ) : null}
      {isMissing && payload.groups !== undefined && onContinue ? (
        <MissingFieldsForm groups={payload.groups} onContinue={onContinue} />
      ) : isMissing && payload.groups !== undefined ? (
        <div className="mt-4"><SafeValue value={payload.groups} /></div>
      ) : null}

      {clientItems.length && onSelectClient ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {clientItems.map((item, index) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
            const id = typeof item.id === 'string' ? item.id : null;
            const label =
              typeof item.name === 'string'
                ? item.name
                : typeof item.label === 'string'
                  ? item.label
                  : `Cliente ${index + 1}`;
            return id ? (
              <button
                key={id}
                type="button"
                onClick={() => onSelectClient(id, label)}
                className="ui-btn-secondary min-h-11"
              >
                Ver cuentas de {label}
              </button>
            ) : null;
          })}
        </div>
      ) : null}

      {response.warnings.length ? (
        <ul className="mt-4 space-y-2">
          {response.warnings.map((warning) => (
            <li key={warning.code} className="flex gap-2 text-sm text-amber-200">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {text(payload.unchanged) ? (
        <p className="mt-4 border-t border-white/10 pt-3 text-xs text-white/55">
          {text(payload.unchanged)}
        </p>
      ) : null}
    </article>
  );
}
