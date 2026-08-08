import { Injectable, Logger, Optional } from '@nestjs/common';
import { assertPrivacySafe, toTelemetryEvent } from './telemetry-privacy';
import { createTelemetryStore, TelemetryStore } from './telemetry-store';
import { TelemetryEmitInput, TelemetryEvent } from './telemetry.types';

export const TELEMETRY_STORE = Symbol('TELEMETRY_STORE');

/**
 * Fire-and-forget telemetry emitter.
 * NEVER throws. NEVER awaited for correctness. Production logic must not depend on this.
 */
@Injectable()
export class TelemetryEmitter {
  private readonly logger = new Logger(TelemetryEmitter.name);
  private readonly store: TelemetryStore;
  private enabled: boolean;

  constructor(@Optional() store?: TelemetryStore) {
    this.store = store ?? createTelemetryStore();
    this.enabled = process.env.ASSISTANT_TELEMETRY_DISABLED !== 'true';
  }

  /** Primary API — safe emit. */
  emit(input: TelemetryEmitInput): void {
    if (!this.enabled) return;
    try {
      const event = toTelemetryEvent(input);
      const violations = assertPrivacySafe(event);
      if (violations.length) {
        this.logger.warn(`telemetry privacy drop: ${violations.join(',')}`);
        return;
      }
      this.store.append(event);
    } catch (error) {
      this.logger.warn(
        `telemetry emit swallowed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /** Test / dashboard access to underlying store. */
  getStore(): TelemetryStore {
    return this.store;
  }

  list(limit?: number): TelemetryEvent[] {
    try {
      return this.store.list(limit);
    } catch {
      return [];
    }
  }

  /** No-op emitter for architecture proofs / optional absence. */
  static noop(): TelemetryEmitter {
    const emitter = new TelemetryEmitter({
      append() {},
      list() {
        return [];
      },
      clear() {},
    });
    return emitter;
  }
}
