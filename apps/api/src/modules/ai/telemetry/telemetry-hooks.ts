import { mapClarificationType, mapFailureTaxonomy } from './telemetry-mappers';
import { TelemetryEmitter } from './telemetry-emitter.service';
import { TelemetryEmitInput } from './telemetry.types';

/** Tiny helpers so call sites stay one-liners and never throw. */
export function telem(emitter: TelemetryEmitter | undefined | null, input: TelemetryEmitInput): void {
  emitter?.emit(input);
}

export { mapClarificationType, mapFailureTaxonomy };
