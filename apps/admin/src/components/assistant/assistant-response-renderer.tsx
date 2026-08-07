'use client';

import { Info, ShieldAlert } from 'lucide-react';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { validateAssistantResponse } from '@/lib/assistant-response-validation';
import type { BusinessActionId, JsonValue, StructuredAssistantResponse } from '@/lib/assistant-types';
import { AssistantBubble, ChoiceBubble, PreviewBubble, QuestionBubble, ReceiptBubble } from '@/components/assistant/bubbles';

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
  if (value === null) return <span className="text-white/40">—</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Sí' : 'No'}</span>;
  if (typeof value === 'string' || typeof value === 'number') return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    return (
      <div className="space-y-2">
        {value.slice(0, 25).map((item, index) => (
          <div key={index} className="rounded-lg bg-white/[0.05] p-2.5">
            <SafeValue value={item} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {Object.entries(value).slice(0, 30).map(([key, item]) => (
        <div key={key} className="min-w-0 rounded-lg bg-white/[0.05] px-2.5 py-1.5">
          <dt className="text-[10.5px] font-medium uppercase tracking-wide text-white/40">
            {displayLabel(key)}
          </dt>
          <dd className="mt-0.5 break-words text-[13px] text-white"><SafeValue value={item} /></dd>
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
  if (!parsed.length) return <div className="mt-3"><SafeValue value={groups} /></div>;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onContinue(Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])));
  };

  return (
    <form className="mt-1 space-y-2.5" onSubmit={submit}>
      {parsed.map((field) => (
        <label key={field.key} className="block">
          <span className="mb-1 block text-[11px] font-medium text-white/50">{field.question}</span>
          <input
            className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm outline-none ring-emerald-400/30 focus:ring-2"
            value={values[field.key] ?? ''}
            onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            required
            maxLength={200}
          />
        </label>
      ))}
      <button type="submit" className="min-h-9 rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black">Continuar</button>
    </form>
  );
}

function ValidatedAssistantResponse({
  response,
  onSelectClient,
  onSearchAgain,
  onEdit,
  onDismiss,
  manualHref,
  busy,
  onContinue,
}: {
  response: StructuredAssistantResponse;
  onSelectClient?: (id: string, label: string) => void;
  onSearchAgain?: () => void;
  onEdit?: () => void;
  onDismiss?: () => void;
  manualHref?: string;
  busy?: boolean;
  onContinue?: (entities: Record<string, JsonValue>) => void;
}) {
  const { payload } = response;
  const message = text(payload.message) ?? text(payload.summary);
  const data = payload.data;
  const isError = response.responseType === 'ERROR_RECOVERY_CARD';
  const isPreview = response.responseType === 'ACTION_PREVIEW_CARD';
  const isMissing = response.responseType === 'MISSING_FIELDS_CARD';
  const isReceipt = response.responseType === 'SUCCESS_RECEIPT';

  const warningsBlock = response.warnings.length ? (
    <ul className="space-y-1.5">
      {response.warnings.map((warning) => (
        <li key={warning.code} className="flex gap-1.5 text-[12.5px] text-amber-200">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{warning.message}</span>
        </li>
      ))}
    </ul>
  ) : null;

  const unchangedNote = text(payload.unchanged) ? (
    <p className="text-[12px] text-white/45">{text(payload.unchanged)}</p>
  ) : null;

  const clientItems =
    response.responseType === 'ENTITY_LIST' &&
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Array.isArray(data.items)
      ? data.items
      : [];

  if (isError) {
    return (
      <AssistantBubble tone="error">
        <div className="space-y-2">
          <p>{message ?? 'Algo no salió bien y no se hizo ningún cambio.'}</p>
          {warningsBlock}
        </div>
      </AssistantBubble>
    );
  }

  if (isPreview) {
    return (
      <PreviewBubble
        intro={message ?? 'Esto es lo que voy a registrar:'}
        summary={
          <div className="space-y-2">
            {data !== undefined ? <SafeValue value={data} /> : null}
            {payload.preview !== undefined ? <SafeValue value={payload.preview} /> : null}
          </div>
        }
        confirmHref={manualHref}
        onEdit={onEdit}
        onCancel={onDismiss}
        busy={busy}
      >
        {warningsBlock}
      </PreviewBubble>
    );
  }

  if (isMissing) {
    return (
      <QuestionBubble question={message ?? 'Necesito algunos datos para continuar.'}>
        {payload.groups !== undefined && onContinue ? (
          <MissingFieldsForm groups={payload.groups} onContinue={onContinue} />
        ) : payload.groups !== undefined ? (
          <SafeValue value={payload.groups} />
        ) : null}
        {warningsBlock}
      </QuestionBubble>
    );
  }

  const chips = clientItems.length && onSelectClient
    ? clientItems.flatMap((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const id = typeof item.id === 'string' ? item.id : null;
        if (!id) return [];
        const label =
          typeof item.name === 'string'
            ? item.name
            : typeof item.label === 'string'
              ? item.label
              : `Cliente ${index + 1}`;
        return [{ id, label }];
      })
    : [];
  if (onSearchAgain && chips.length) chips.push({ id: '__none__', label: 'Otro cliente' });

  // When the entity list resolves to selectable chips, they replace the raw
  // data table — showing both would repeat the same clients twice over.
  const content = (
    <div className="space-y-2.5">
      {!isReceipt && message ? <p>{message}</p> : null}
      {data !== undefined && !chips.length ? <SafeValue value={data} /> : null}
      {warningsBlock}
      {unchangedNote}
    </div>
  );

  return (
    <>
      {isReceipt ? <ReceiptBubble title={message ?? 'Listo.'}>{content}</ReceiptBubble> : <AssistantBubble>{content}</AssistantBubble>}
      {chips.length ? (
        <ChoiceBubble
          options={chips}
          disabled={busy}
          onSelect={(id, label) => {
            if (id === '__none__') {
              onSearchAgain?.();
              return;
            }
            onSelectClient?.(id, label);
          }}
        />
      ) : null}
    </>
  );
}

export function AssistantResponseRenderer({
  intent,
  response,
  onSelectClient,
  onContinue,
  onSearchAgain,
  onEdit,
  onDismiss,
  manualHref,
  busy,
}: {
  intent: BusinessActionId;
  response: StructuredAssistantResponse;
  onSelectClient?: (id: string, label: string) => void;
  onContinue?: (entities: Record<string, JsonValue>) => void;
  onSearchAgain?: () => void;
  onEdit?: () => void;
  onDismiss?: () => void;
  manualHref?: string;
  busy?: boolean;
}) {
  const validation = validateAssistantResponse(intent, response);
  if (validation.kind === 'FAIL_CLOSED') {
    return (
      <AssistantBubble tone="error">
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">{validation.title}</p>
              <p className="mt-0.5 text-[13px] text-rose-100/85">{validation.message}</p>
            </div>
          </div>
          {validation.manualHref ? (
            <Link href={validation.manualHref} className="inline-flex min-h-9 items-center rounded-full border border-rose-200/25 px-3.5 py-1.5 text-[13px] font-medium text-rose-100">
              Abrir flujo manual
            </Link>
          ) : null}
        </div>
      </AssistantBubble>
    );
  }
  return (
    <ValidatedAssistantResponse
      response={validation.response}
      onSelectClient={onSelectClient}
      onContinue={onContinue}
      onSearchAgain={onSearchAgain}
      onEdit={onEdit}
      onDismiss={onDismiss}
      manualHref={manualHref}
      busy={busy}
    />
  );
}
