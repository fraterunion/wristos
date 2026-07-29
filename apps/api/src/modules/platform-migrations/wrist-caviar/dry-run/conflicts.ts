import type { DryRunConflictCode } from './planner.constants';
import { CONFLICT_MESSAGES_ES } from './planner.constants';

export type ConflictDetails = {
  code: DryRunConflictCode;
  explanationEs: string;
  sourceEntity: string;
  provenance: Record<string, unknown>;
  blocking: boolean;
  suggestedAction: string;
};

export function buildConflict(
  code: DryRunConflictCode,
  opts: {
    sourceEntity: string;
    provenance?: Record<string, unknown>;
    blocking?: boolean;
    suggestedAction?: string;
    extra?: Record<string, unknown>;
  },
): ConflictDetails {
  return {
    code,
    explanationEs: CONFLICT_MESSAGES_ES[code],
    sourceEntity: opts.sourceEntity,
    provenance: opts.provenance ?? {},
    blocking: opts.blocking ?? true,
    suggestedAction:
      opts.suggestedAction ??
      'Revise el candidato en la simulación y resuelva antes de la fase de importación.',
    ...opts.extra,
  };
}
