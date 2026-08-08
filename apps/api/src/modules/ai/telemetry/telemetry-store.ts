import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { TELEMETRY_CHANNEL, TelemetryEvent } from './telemetry.types';

export interface TelemetryStore {
  append(event: TelemetryEvent): void;
  list(limit?: number): TelemetryEvent[];
  clear(): void;
}

/**
 * In-process ring buffer. Primary store for dashboard aggregation on this replica.
 * Telemetry is best-effort and must never block Assistant behavior.
 */
export class MemoryTelemetryStore implements TelemetryStore {
  private readonly events: TelemetryEvent[] = [];

  constructor(private readonly maxEvents = 10_000) {}

  append(event: TelemetryEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
  }

  list(limit = 10_000): TelemetryEvent[] {
    if (limit >= this.events.length) return [...this.events];
    return this.events.slice(this.events.length - limit);
  }

  clear(): void {
    this.events.length = 0;
  }
}

/**
 * Optional durable append-only JSONL mirror (no Prisma / no schema).
 * Disabled unless ASSISTANT_TELEMETRY_PATH is set.
 */
export class JsonlTelemetryStore implements TelemetryStore {
  private readonly memory = new MemoryTelemetryStore();

  constructor(private readonly filePath: string) {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      if (existsSync(filePath)) {
        const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        for (const line of lines.slice(-5_000)) {
          try {
            const parsed = JSON.parse(line) as TelemetryEvent & { channel?: string };
            if (parsed?.event) this.memory.append(parsed);
          } catch {
            /* skip corrupt line */
          }
        }
      }
    } catch {
      /* store remains empty — never throw into callers */
    }
  }

  append(event: TelemetryEvent): void {
    this.memory.append(event);
    try {
      appendFileSync(
        this.filePath,
        `${JSON.stringify({ channel: TELEMETRY_CHANNEL, ...event })}\n`,
        'utf8',
      );
    } catch {
      /* ignore disk errors */
    }
  }

  list(limit?: number): TelemetryEvent[] {
    return this.memory.list(limit);
  }

  clear(): void {
    this.memory.clear();
  }
}

export function createTelemetryStore(): TelemetryStore {
  const path = process.env.ASSISTANT_TELEMETRY_PATH?.trim();
  if (path) return new JsonlTelemetryStore(path);
  return new MemoryTelemetryStore();
}
