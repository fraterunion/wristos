'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ConversationComposer } from '@/components/assistant/conversation-composer';
import { ConversationThread } from '@/components/assistant/conversation-thread';
import {
  AssistantMessageRequestError,
  AssistantRequestError,
  clearResumeHint,
  confirmAssistantActionRun,
  confirmResultToAssistantResponse,
  createAssistantAction,
  createAssistantMessageAction,
  readResumeHint,
  resumeAssistantWorkspace,
  writeResumeHint,
  type AssistantAction,
  type AssistantMessageAction,
} from '@/lib/assistant-api';
import { useAuthContext } from '@/lib/auth-context';
import type {
  AssistantHistoryItem,
  BusinessActionId,
  JsonValue,
  WritePreviewAction,
} from '@/lib/assistant-types';

/** Manual module fallbacks for recovery links — not shown as homepage actions. */
const manualModuleHrefs: Partial<Record<WritePreviewAction | BusinessActionId, string>> = {
  REGISTER_SALE: '/ventas',
  REGISTER_RECEIVABLE_PAYMENT: '/cuentas',
  REGISTER_PAYABLE_PAYMENT: '/cuentas',
  REGISTER_TREASURY_TRANSFER: '/treasury',
  REGISTER_CAPITAL_CONTRIBUTION: '/capital',
  REGISTER_CAPITAL_DISTRIBUTION: '/capital',
  REGISTER_PURCHASE: '/inventory',
  REGISTER_EXPENSE: '/expenses',
  CREATE_CLIENT: '/crm',
  UPDATE_CLIENT: '/crm',
  CREATE_RECEIVABLE: '/cuentas',
  CREATE_PAYABLE: '/cuentas',
  REGISTER_SETTLEMENT: '/cuentas',
  REGISTER_CRYPTO_POSITION: '/crypto',
  REGISTER_CRYPTO_PRICE: '/crypto',
};

const firstUseExamples = [
  'Vendí un Batman en 350',
  'José me pagó 120',
  '¿Cómo vamos este mes?',
];

type WorkspaceState = {
  workspaceId?: string;
  conversationId?: string;
  version?: number;
};

function greetingName(email: string | undefined): string {
  if (!email) return '';
  const local = email.split('@')[0] ?? '';
  const token = local.split(/[._-]/)[0] ?? '';
  if (!token) return '';
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function isExecutableWriteIntent(intent: BusinessActionId | 'UNKNOWN'): boolean {
  return (
    intent === 'REGISTER_SALE' ||
    intent === 'REGISTER_RECEIVABLE_PAYMENT' ||
    intent === 'REGISTER_PAYABLE_PAYMENT' ||
    intent === 'REGISTER_TREASURY_TRANSFER' ||
    intent === 'REGISTER_CAPITAL_CONTRIBUTION' ||
    intent === 'REGISTER_CAPITAL_DISTRIBUTION' ||
    intent === 'REGISTER_EXPENSE' ||
    intent === 'REGISTER_PURCHASE' ||
    intent === 'CREATE_CLIENT' ||
    intent === 'UPDATE_CLIENT' ||
    intent === 'CREATE_RECEIVABLE' ||
    intent === 'CREATE_PAYABLE'
  );
}

export default function AssistantPage() {
  const { user } = useAuthContext();
  const [workspace, setWorkspace] = useState<WorkspaceState>({});
  const [history, setHistory] = useState<AssistantHistoryItem[]>([]);
  const [historyTimestamps, setHistoryTimestamps] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<AssistantAction | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<AssistantAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messagePending, setMessagePending] = useState<AssistantMessageAction | null>(null);
  const [messagePendingLabel, setMessagePendingLabel] = useState<string | null>(null);
  const [messageRetryAction, setMessageRetryAction] = useState<AssistantMessageAction | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [confirmingSale, setConfirmingSale] = useState(false);
  const [composerValue, setComposerValue] = useState('');

  const name = useMemo(() => greetingName(user?.email), [user?.email]);

  useEffect(() => {
    const hint = readResumeHint();
    if (!hint) return;
    let cancelled = false;
    void resumeAssistantWorkspace(hint.workspaceId)
      .then((resumed) => {
        if (cancelled || resumed.deletedAt) return;
        setWorkspace({
          workspaceId: resumed.id,
          conversationId: resumed.conversationId ?? hint.conversationId,
          version: resumed.version,
        });
      })
      .catch(() => clearResumeHint());
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshWorkspaceVersion = useCallback(async (workspaceId: string) => {
    try {
      const resumed = await resumeAssistantWorkspace(workspaceId);
      setWorkspace({
        workspaceId: resumed.id,
        conversationId: resumed.conversationId ?? undefined,
        version: resumed.version,
      });
    } catch {
      clearResumeHint();
    }
  }, []);

  const runAction = useCallback(
    async (action: AssistantAction, label: string) => {
      if (pending || messagePending) return;
      setPending(action);
      setPendingLabel(label);
      setRetryAction(null);
      setError(null);
      try {
        const response = await action.execute();
        setHistory((items) => [
          {
            id: response.requestId,
            label,
            intent: action.request.intent,
            entities: action.request.entities,
            response,
          },
          ...items,
        ]);
        setHistoryTimestamps((current) => ({ ...current, [response.requestId]: Date.now() }));
        setWorkspace((current) => ({
          ...current,
          workspaceId: response.workspaceId,
          conversationId: response.conversationId,
        }));
        writeResumeHint({
          workspaceId: response.workspaceId,
          conversationId: response.conversationId,
        });
        void refreshWorkspaceVersion(response.workspaceId);
      } catch (caught) {
        setRetryAction(action);
        if (caught instanceof AssistantRequestError) {
          setError(caught.message);
          if (caught.response) {
            const failedResponse = caught.response;
            setHistory((items) => [
              {
                id: failedResponse.requestId,
                label,
                intent: action.request.intent,
                entities: action.request.entities,
                response: failedResponse,
              },
              ...items,
            ]);
            setHistoryTimestamps((current) => ({
              ...current,
              [failedResponse.requestId]: Date.now(),
            }));
          }
        } else {
          setError('Se perdió la conexión. Puedes reintentar la misma solicitud de forma segura.');
        }
      } finally {
        setPending(null);
        setPendingLabel(null);
      }
    },
    [pending, messagePending, refreshWorkspaceVersion],
  );

  const runMessageAction = useCallback(
    async (action: AssistantMessageAction, label: string) => {
      if (pending || messagePending) return;
      setMessagePending(action);
      setMessagePendingLabel(label);
      setMessageRetryAction(null);
      setMessageError(null);
      try {
        const result = await action.execute();
        const id = result.response.requestId;
        setHistory((items) => [
          {
            id,
            label,
            intent: result.resolvedIntent,
            entities: result.resolvedEntities,
            response: result.response,
          },
          ...items,
        ]);
        setHistoryTimestamps((current) => ({ ...current, [id]: Date.now() }));
        setWorkspace((current) => ({
          ...current,
          workspaceId: result.response.workspaceId,
          conversationId: result.response.conversationId,
        }));
        writeResumeHint({
          workspaceId: result.response.workspaceId,
          conversationId: result.response.conversationId,
        });
        void refreshWorkspaceVersion(result.response.workspaceId);
      } catch (caught) {
        setMessageRetryAction(action);
        if (caught instanceof AssistantMessageRequestError) {
          setMessageError(caught.message);
          if (caught.result) {
            const failedResult = caught.result;
            const id = failedResult.response.requestId;
            setHistory((items) => [
              {
                id,
                label,
                intent: failedResult.resolvedIntent,
                entities: failedResult.resolvedEntities,
                response: failedResult.response,
              },
              ...items,
            ]);
            setHistoryTimestamps((current) => ({ ...current, [id]: Date.now() }));
          }
        } else {
          setMessageError(
            'Se perdió la conexión. Puedes reintentar la misma solicitud de forma segura.',
          );
        }
      } finally {
        setMessagePending(null);
        setMessagePendingLabel(null);
      }
    },
    [pending, messagePending, refreshWorkspaceVersion],
  );

  const makeAction = useCallback(
    (
      intent: BusinessActionId,
      entities: Record<string, JsonValue>,
      label: string,
      userDisplayText?: string,
    ) => {
      const action = createAssistantAction({
        intent,
        entities,
        userDisplayText,
        conversationId: workspace.conversationId,
        workspaceId: workspace.workspaceId,
        expectedWorkspaceVersion: workspace.version,
      });
      void runAction(action, label);
    },
    [runAction, workspace],
  );

  const selectClient = (id: string, label: string) => {
    const latest = history[0];
    // Clarification closed choices: submit the natural label through the same NL pipeline.
    if (latest?.response.responseType === 'MISSING_FIELDS_CARD') {
      const action = createAssistantMessageAction({
        text: label,
        conversationId: workspace.conversationId,
        workspaceId: workspace.workspaceId,
      });
      void runMessageAction(action, label);
      return;
    }
    const pickerWrite =
      latest?.response.responseType === 'ENTITY_PICKER' &&
      (id.startsWith('__COMPOSITION_') ||
        id.startsWith('__CREATE_NEW_CLIENT__') ||
        latest.intent === 'REGISTER_PURCHASE' ||
        latest.intent === 'REGISTER_SALE' ||
        latest.intent === 'CREATE_CLIENT' ||
        latest.intent === 'UPDATE_CLIENT' ||
        latest.intent === 'REGISTER_RECEIVABLE_PAYMENT' ||
        latest.intent === 'REGISTER_PAYABLE_PAYMENT' ||
        latest.intent === 'CREATE_RECEIVABLE' ||
        latest.intent === 'CREATE_PAYABLE');
    if (pickerWrite) {
      const action = createAssistantMessageAction({
        text: label,
        conversationId: workspace.conversationId,
        workspaceId: workspace.workspaceId,
      });
      void runMessageAction(action, label);
      return;
    }
    makeAction('GET_CLIENT_ACCOUNTS', { clientId: id }, `Muéstrame las cuentas de ${label}.`);
  };

  const continueItem = useCallback(
    (item: AssistantHistoryItem, entities: Record<string, JsonValue>) => {
      if (item.intent === 'UNKNOWN') return;
      makeAction(item.intent, { ...item.entities, ...entities }, item.label);
    },
    [makeAction],
  );

  const restartItem = useCallback(
    (item: AssistantHistoryItem) => {
      if (item.intent === 'UNKNOWN') {
        const action = createAssistantMessageAction({
          text: item.label,
          conversationId: workspace.conversationId,
          workspaceId: workspace.workspaceId,
        });
        void runMessageAction(action, item.label);
        return;
      }
      makeAction(item.intent, {}, item.label);
    },
    [makeAction, runMessageAction, workspace],
  );

  const manualHrefFor = useCallback(
    (item: AssistantHistoryItem) =>
      item.intent === 'UNKNOWN' ? undefined : manualModuleHrefs[item.intent],
    [],
  );

  const confirmSale = useCallback(
    async (
      item: AssistantHistoryItem,
      args: { actionRunId: string; planFingerprint: string },
    ) => {
      if (pending || messagePending || confirmingSale || !isExecutableWriteIntent(item.intent)) {
        return;
      }
      const isPayment =
        item.intent === 'REGISTER_RECEIVABLE_PAYMENT' ||
        item.intent === 'REGISTER_PAYABLE_PAYMENT';
      const isTransfer = item.intent === 'REGISTER_TREASURY_TRANSFER';
      const isContribution = item.intent === 'REGISTER_CAPITAL_CONTRIBUTION';
      const isDistribution = item.intent === 'REGISTER_CAPITAL_DISTRIBUTION';
      const isExpense = item.intent === 'REGISTER_EXPENSE';
      const isPurchase = item.intent === 'REGISTER_PURCHASE';
      const isCreateClient = item.intent === 'CREATE_CLIENT';
      const isUpdateClient = item.intent === 'UPDATE_CLIENT';
      const isReceivable = item.intent === 'CREATE_RECEIVABLE';
      const isPayable = item.intent === 'CREATE_PAYABLE';
      const confirmLabel = isUpdateClient
        ? 'Guardar cambios'
        : isCreateClient
          ? 'Crear cliente'
          : isReceivable
            ? 'Crear cuenta por cobrar'
            : isPayable
              ? 'Crear cuenta por pagar'
              : isPurchase
                ? 'Registrar compra'
                : isExpense
                  ? 'Registrar gasto'
                  : isDistribution
                    ? 'Registrar distribución'
                    : isContribution
                      ? 'Registrar aportación'
                      : isTransfer
                        ? 'Hacer transferencia'
                        : isPayment
                          ? 'Registrar pago'
                          : 'Registrar venta';
      setError(null);
      setMessageError(null);
      setConfirmingSale(true);
      setMessagePendingLabel(confirmLabel);
      try {
        const result = await confirmAssistantActionRun(args);
        if (result.interactionState === 'EXECUTING') {
          setMessageError(result.message);
          return;
        }
        const response = confirmResultToAssistantResponse(result, {
          requestId: item.response.requestId,
          conversationId: item.response.conversationId || workspace.conversationId || '',
          workspaceId: item.response.workspaceId || workspace.workspaceId || '',
          traceId: item.response.traceId,
        });
        const resumedIntent =
          result.compositionResume && typeof result.capability === 'string'
            ? (result.capability as BusinessActionId)
            : item.intent;
        const historyLabel =
          result.compositionResume && resumedIntent === 'REGISTER_PURCHASE'
            ? 'Continuar compra'
            : result.compositionResume && resumedIntent === 'REGISTER_SALE'
              ? 'Continuar venta'
              : confirmLabel;
        const id = crypto.randomUUID();
        setHistory((current) => [
          {
            id,
            label: historyLabel,
            intent: resumedIntent,
            entities: item.entities,
            response,
          },
          ...current,
        ]);
        setHistoryTimestamps((current) => ({ ...current, [id]: Date.now() }));
        if (response.workspaceId) {
          void refreshWorkspaceVersion(response.workspaceId);
        }
      } catch (caught) {
        if (caught instanceof AssistantRequestError) {
          setMessageError(caught.message);
        } else {
          setMessageError(
            isExpense
              ? 'No pude confirmar el gasto. Reintenta la misma confirmación.'
              : isPayment
                ? 'No pude confirmar el pago. Reintenta la misma confirmación.'
                : 'No pude confirmar la operación. Reintenta la misma confirmación.',
          );
        }
      } finally {
        setConfirmingSale(false);
        setMessagePendingLabel(null);
      }
    },
    [
      pending,
      messagePending,
      confirmingSale,
      refreshWorkspaceVersion,
      workspace.conversationId,
      workspace.workspaceId,
    ],
  );

  const submitComposer = (event: FormEvent) => {
    event.preventDefault();
    const text = composerValue.trim();
    if (!text || busy) return;
    const action = createAssistantMessageAction({
      text,
      conversationId: workspace.conversationId,
      workspaceId: workspace.workspaceId,
    });
    setComposerValue('');
    void runMessageAction(action, text);
  };

  const startNewConversation = () => {
    setHistory([]);
    setHistoryTimestamps({});
    setError(null);
    setMessageError(null);
    setRetryAction(null);
    setMessageRetryAction(null);
    setComposerValue('');
    clearResumeHint();
    setWorkspace({});
  };

  const busy = !!pending || !!messagePending || confirmingSale;
  const combinedPendingLabel = confirmingSale
    ? (messagePendingLabel ?? 'Confirmando…')
    : (pendingLabel ?? messagePendingLabel);
  const combinedError = error ?? messageError;
  const combinedOnRetry = retryAction
    ? () => void runAction(retryAction, 'Reintentando la última solicitud.')
    : messageRetryAction
      ? () => void runMessageAction(messageRetryAction, messageRetryAction.request.text)
      : undefined;

  const hasConversation = history.length > 0 || busy || !!combinedError;

  const emptyState = (
    <section
      aria-label="Conversación vacía"
      className="flex flex-1 flex-col items-center justify-center px-3 py-8 text-center sm:py-14"
      data-testid="assistant-empty-state"
    >
      <p className="text-[1.75rem] font-semibold tracking-tight text-white sm:text-[2rem]">
        {name ? `Buenos días, ${name}.` : 'Buenos días.'}
      </p>
      <p className="mt-2.5 text-[15px] text-white/50">¿Qué necesitas hacer?</p>
      <div className="mt-8 hidden max-w-xs space-y-1.5 text-left text-[13px] text-white/30 min-[480px]:block">
        <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-white/25">Puedes decir</p>
        {firstUseExamples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setComposerValue(example)}
            className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.03] hover:text-white/55"
          >
            “{example}”
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <div
      className="mx-auto flex w-full max-w-[860px] flex-col"
      style={{ minHeight: 'calc(100dvh - 5.75rem)' }}
      data-testid="assistant-chat-shell"
    >
      <header className="mb-1 flex h-9 shrink-0 items-center justify-between gap-3 px-0.5">
        <div className="flex items-center gap-2">
          <h1 className="text-[15px] font-medium tracking-tight text-white/90">Asistente</h1>
          <span
            className="h-1.5 w-1.5 rounded-full bg-emerald-400/90"
            aria-label="Asistente disponible"
          />
        </div>
        {hasConversation ? (
          <button
            type="button"
            onClick={startNewConversation}
            className="rounded-full px-2.5 py-1 text-[11px] text-white/40 transition hover:text-white/70"
          >
            Nueva
          </button>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className={`min-h-0 flex-1 ${hasConversation ? 'pb-1' : ''}`}>
          <ConversationThread
            history={history}
            pending={busy}
            pendingLabel={combinedPendingLabel}
            error={combinedError}
            onRetry={combinedOnRetry}
            selectClient={selectClient}
            onContinue={continueItem}
            onRestart={restartItem}
            onSearchAgain={() => {
              const action = createAssistantMessageAction({
                text: 'Busca otro cliente',
                conversationId: workspace.conversationId,
                workspaceId: workspace.workspaceId,
              });
              void runMessageAction(action, 'Busca otro cliente');
            }}
            onConfirmSale={confirmSale}
            manualHrefFor={manualHrefFor}
            timestamps={historyTimestamps}
            emptyState={emptyState}
          />
        </div>

        <ConversationComposer
          value={composerValue}
          onChange={setComposerValue}
          onSubmit={submitComposer}
          placeholder="Escribe o habla…"
          notice={null}
          disabled={busy}
        />
      </div>
    </div>
  );
}
