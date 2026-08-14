import { Injectable } from '@nestjs/common';
import { IntentReference } from './reference-schema';
import { normalizeWatchText } from '../watch-intelligence/normalize';
import {
  AssistantWorkingContext,
  ContextEntityType,
  hashEntityId,
  isCandidateContextFresh,
} from './working-context';

export type ReferenceResolutionFailureType =
  | 'NO_CONTEXT'
  | 'EXPIRED'
  | 'OUT_OF_RANGE'
  | 'AMBIGUOUS'
  | 'TYPE_MISMATCH'
  | 'UNSUPPORTED'
  | 'NOT_FOUND';

export type ReferenceResolutionResult =
  | {
      kind: 'RESOLVED';
      entityType: ContextEntityType;
      id: string;
      label: string;
      referenceKind: IntentReference['kind'];
      ordinal?: number;
      resolvedEntityHash: string;
      contextAgeMs: number | null;
    }
  | {
      kind: 'CLARIFY';
      failureType: ReferenceResolutionFailureType;
      message: string;
    };

@Injectable()
export class ReferenceResolverService {
  resolve(
    reference: IntentReference,
    context: AssistantWorkingContext | null,
    now = new Date(),
  ): ReferenceResolutionResult {
    if (!context) {
      return {
        kind: 'CLARIFY',
        failureType: 'NO_CONTEXT',
        message: 'Necesito que elijas nuevamente. No tengo una selección previa en esta conversación.',
      };
    }

    const ageMs = context.lastPresentedCandidates?.presentedAt
      ? Math.max(0, now.getTime() - Date.parse(context.lastPresentedCandidates.presentedAt))
      : null;

    if (reference.kind === 'ORDINAL') {
      return this.resolveOrdinal(reference, context, now, ageMs);
    }
    if (reference.kind === 'LAST_SELECTED' || reference.kind === 'SAME_ENTITY') {
      return this.resolveLastSelected(reference, context, now, ageMs);
    }
    if (reference.kind === 'SINGLE_PRESENTED') {
      return this.resolveSinglePresented(reference, context, now, ageMs);
    }
    return {
      kind: 'CLARIFY',
      failureType: 'UNSUPPORTED',
      message: 'Necesito un poco más de información para continuar.',
    };
  }

  /**
   * Resolves a picker-click EVENT: the frontend already has the candidate's
   * trusted id (from the server's own last ENTITY_PICKER response) — this
   * looks it up against the durably-stored `lastPresentedCandidates` instead
   * of re-deriving it from free text. Never trusts a client-supplied id that
   * wasn't actually presented in the most recent picker for this workspace.
   */
  resolveByCandidateId(
    id: string,
    context: AssistantWorkingContext | null,
    now = new Date(),
  ): ReferenceResolutionResult {
    if (!context) {
      return {
        kind: 'CLARIFY',
        failureType: 'NO_CONTEXT',
        message: 'Necesito que elijas nuevamente. No tengo una selección previa en esta conversación.',
      };
    }
    if (!context.lastPresentedCandidates) {
      return {
        kind: 'CLARIFY',
        failureType: 'NO_CONTEXT',
        message: 'Necesito que elijas nuevamente. No hay una lista reciente de opciones.',
      };
    }
    const ageMs = context.lastPresentedCandidates.presentedAt
      ? Math.max(0, now.getTime() - Date.parse(context.lastPresentedCandidates.presentedAt))
      : null;
    if (!isCandidateContextFresh(context, now)) {
      return {
        kind: 'CLARIFY',
        failureType: 'EXPIRED',
        message: 'Necesito que elijas nuevamente. La lista anterior ya no es válida.',
      };
    }
    const selected = context.lastPresentedCandidates.candidates.find((c) => c.id === id);
    if (!selected) {
      return {
        kind: 'CLARIFY',
        failureType: 'NOT_FOUND',
        message: 'Esa opción ya no está disponible. Necesito que elijas nuevamente.',
      };
    }
    return {
      kind: 'RESOLVED',
      entityType: context.lastPresentedCandidates.type,
      id: selected.id,
      label: selected.label,
      referenceKind: 'SINGLE_PRESENTED',
      ordinal: selected.ordinal,
      resolvedEntityHash: hashEntityId(selected.id),
      contextAgeMs: ageMs,
    };
  }

  /**
   * Typed conversational continuation while an ENTITY_PICKER is active:
   * "Valdez" or "Abraham Valdez" must resolve exactly like clicking the
   * matching picker button — no NLP/router/Claude involved. Matches the
   * typed text (accent/case-folded) against each presented candidate's
   * label as either an exact match or a substring of the label (never the
   * reverse — a long unrelated sentence must not false-positive just
   * because it happens to contain a candidate's name). Ambiguous when more
   * than one candidate matches; the caller decides how to fall back when
   * nothing matches (see NaturalLanguageAssistantService — outside an
   * active, fresh picker this method is never even called).
   */
  resolveByTypedLabel(
    rawText: string,
    context: AssistantWorkingContext | null,
    now = new Date(),
  ): ReferenceResolutionResult {
    if (!context) {
      return {
        kind: 'CLARIFY',
        failureType: 'NO_CONTEXT',
        message: 'Necesito que elijas nuevamente. No tengo una selección previa en esta conversación.',
      };
    }
    if (!context.lastPresentedCandidates) {
      return {
        kind: 'CLARIFY',
        failureType: 'NO_CONTEXT',
        message: 'Necesito que elijas nuevamente. No hay una lista reciente de opciones.',
      };
    }
    const ageMs = context.lastPresentedCandidates.presentedAt
      ? Math.max(0, now.getTime() - Date.parse(context.lastPresentedCandidates.presentedAt))
      : null;
    if (!isCandidateContextFresh(context, now)) {
      return {
        kind: 'CLARIFY',
        failureType: 'EXPIRED',
        message: 'Necesito que elijas nuevamente. La lista anterior ya no es válida.',
      };
    }
    const normalizedTyped = normalizeWatchText(rawText);
    if (!normalizedTyped) {
      return { kind: 'CLARIFY', failureType: 'NOT_FOUND', message: 'No identifiqué esa opción.' };
    }
    const candidates = context.lastPresentedCandidates.candidates;
    const matches = candidates.filter((c) => normalizeWatchText(c.label).includes(normalizedTyped));
    const exact = matches.filter((c) => normalizeWatchText(c.label) === normalizedTyped);
    const finalMatches = exact.length ? exact : matches;
    if (finalMatches.length === 0) {
      return { kind: 'CLARIFY', failureType: 'NOT_FOUND', message: 'No identifiqué esa opción entre las presentadas.' };
    }
    if (finalMatches.length > 1) {
      return {
        kind: 'CLARIFY',
        failureType: 'AMBIGUOUS',
        message: 'Hay varias opciones que coinciden. ¿Cuál exactamente? Di “el primero”, “el segundo”, o el nombre completo.',
      };
    }
    const selected = finalMatches[0]!;
    return {
      kind: 'RESOLVED',
      entityType: context.lastPresentedCandidates.type,
      id: selected.id,
      label: selected.label,
      referenceKind: 'SINGLE_PRESENTED',
      ordinal: selected.ordinal,
      resolvedEntityHash: hashEntityId(selected.id),
      contextAgeMs: ageMs,
    };
  }

  /**
   * Pure content match against the currently-presented candidate labels —
   * deliberately independent of candidate-list freshness (unlike
   * resolveByTypedLabel/resolve, which check freshness FIRST and never even
   * look at the text once a list is stale). Used to classify "does this
   * message actually engage with the picker at all" before staleness is
   * allowed to matter: an explicit attempt to select from a genuinely dead
   * list must still fail closed as EXPIRED (never silently trusted), while a
   * message that doesn't match the list's labels at all — expired or not —
   * is simply not a picker interaction and must never be forced through one.
   */
  matchesPresentedLabel(
    rawText: string,
    context: AssistantWorkingContext | null,
  ): 'MATCH' | 'AMBIGUOUS' | 'NO_MATCH' {
    if (!context?.lastPresentedCandidates) return 'NO_MATCH';
    const normalizedTyped = normalizeWatchText(rawText);
    if (!normalizedTyped) return 'NO_MATCH';
    const candidates = context.lastPresentedCandidates.candidates;
    const matches = candidates.filter((c) => normalizeWatchText(c.label).includes(normalizedTyped));
    const exact = matches.filter((c) => normalizeWatchText(c.label) === normalizedTyped);
    const finalMatches = exact.length ? exact : matches;
    if (finalMatches.length === 0) return 'NO_MATCH';
    if (finalMatches.length > 1) return 'AMBIGUOUS';
    return 'MATCH';
  }

  private resolveOrdinal(
    reference: IntentReference,
    context: AssistantWorkingContext,
    now: Date,
    ageMs: number | null,
  ): ReferenceResolutionResult {
    if (!context.lastPresentedCandidates) {
      return {
        kind: 'CLARIFY',
        failureType: 'NO_CONTEXT',
        message: 'Necesito que elijas nuevamente. No hay una lista reciente de opciones.',
      };
    }
    if (!isCandidateContextFresh(context, now)) {
      return {
        kind: 'CLARIFY',
        failureType: 'EXPIRED',
        message: 'Necesito que elijas nuevamente. La lista anterior ya no es válida.',
      };
    }
    if (reference.entityType && reference.entityType !== context.lastPresentedCandidates.type) {
      return {
        kind: 'CLARIFY',
        failureType: 'TYPE_MISMATCH',
        message: 'Necesito que elijas nuevamente. El tipo de opción no coincide.',
      };
    }

    const list = context.lastPresentedCandidates.candidates;
    const ordinal = reference.position === 'LAST' ? list.length : reference.ordinal;
    if (!ordinal || ordinal < 1 || ordinal > list.length) {
      return {
        kind: 'CLARIFY',
        failureType: 'OUT_OF_RANGE',
        message: 'Necesito que elijas nuevamente. Esa posición no existe en la lista.',
      };
    }
    const selected = list.find((c) => c.ordinal === ordinal) ?? list[ordinal - 1];
    if (!selected) {
      return {
        kind: 'CLARIFY',
        failureType: 'OUT_OF_RANGE',
        message: 'Necesito que elijas nuevamente. Esa posición no existe en la lista.',
      };
    }
    return {
      kind: 'RESOLVED',
      entityType: context.lastPresentedCandidates.type,
      id: selected.id,
      label: selected.label,
      referenceKind: 'ORDINAL',
      ordinal: selected.ordinal,
      resolvedEntityHash: hashEntityId(selected.id),
      contextAgeMs: ageMs,
    };
  }

  private resolveLastSelected(
    reference: IntentReference,
    context: AssistantWorkingContext,
    now: Date,
    ageMs: number | null,
  ): ReferenceResolutionResult {
    if (context.lastSelectedEntity) {
      if (reference.entityType && reference.entityType !== context.lastSelectedEntity.type) {
        return {
          kind: 'CLARIFY',
          failureType: 'TYPE_MISMATCH',
          message: 'Necesito que elijas nuevamente. El tipo seleccionado no coincide.',
        };
      }
      return {
        kind: 'RESOLVED',
        entityType: context.lastSelectedEntity.type,
        id: context.lastSelectedEntity.id,
        label: context.lastSelectedEntity.label,
        referenceKind: reference.kind,
        resolvedEntityHash: hashEntityId(context.lastSelectedEntity.id),
        contextAgeMs: ageMs,
      };
    }

    // Fall back: exactly one presented candidate (deictic "ese").
    return this.resolveSinglePresented({ kind: 'SINGLE_PRESENTED', entityType: reference.entityType }, context, now, ageMs);
  }

  private resolveSinglePresented(
    reference: IntentReference,
    context: AssistantWorkingContext,
    now: Date,
    ageMs: number | null,
  ): ReferenceResolutionResult {
    if (!context.lastPresentedCandidates) {
      return {
        kind: 'CLARIFY',
        failureType: 'NO_CONTEXT',
        message: 'Necesito que elijas nuevamente. No hay una lista reciente de opciones.',
      };
    }
    if (!isCandidateContextFresh(context, now)) {
      return {
        kind: 'CLARIFY',
        failureType: 'EXPIRED',
        message: 'Necesito que elijas nuevamente. La lista anterior ya no es válida.',
      };
    }
    if (reference.entityType && reference.entityType !== context.lastPresentedCandidates.type) {
      return {
        kind: 'CLARIFY',
        failureType: 'TYPE_MISMATCH',
        message: 'Necesito que elijas nuevamente. El tipo de opción no coincide.',
      };
    }
    const list = context.lastPresentedCandidates.candidates;
    if (list.length !== 1) {
      return {
        kind: 'CLARIFY',
        failureType: 'AMBIGUOUS',
        message: 'Hay varias opciones. ¿Cuál exactamente? Di “el primero”, “el segundo”, o elige una.',
      };
    }
    const selected = list[0]!;
    return {
      kind: 'RESOLVED',
      entityType: context.lastPresentedCandidates.type,
      id: selected.id,
      label: selected.label,
      referenceKind: 'SINGLE_PRESENTED',
      ordinal: selected.ordinal,
      resolvedEntityHash: hashEntityId(selected.id),
      contextAgeMs: ageMs,
    };
  }
}

/** Map a resolved entity into orchestrator entity keys without inventing new IDs. */
export function trustedIdsFromResolution(
  resolution: Extract<ReferenceResolutionResult, { kind: 'RESOLVED' }>,
): Record<string, string> {
  if (resolution.entityType === 'CLIENT') return { clientId: resolution.id };
  if (resolution.entityType === 'WATCH') return { watchId: resolution.id };
  if (resolution.entityType === 'INVESTOR') {
    return {
      investorId: resolution.id,
      selectedInvestorId: resolution.id,
    };
  }
  return { accountEntryId: resolution.id };
}
