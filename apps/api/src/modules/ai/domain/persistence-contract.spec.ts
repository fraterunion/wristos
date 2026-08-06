import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('AI persistence append-only contract', () => {
  it('enforces immutable messages and audit events in PostgreSQL', () => {
    const migration = readFileSync(resolve(process.cwd(), '../../prisma/migrations/20260806150000_ai_runtime_foundation/migration.sql'), 'utf8');
    expect(migration).toContain('"ai_messages_append_only" BEFORE UPDATE OR DELETE');
    expect(migration).toContain('"ai_audit_events_append_only" BEFORE UPDATE OR DELETE');
    expect(migration).toContain("created after table data during pg_restore's post-data phase");
    expect(migration).toContain('$$ LANGUAGE plpgsql');
    expect(migration).not.toContain('CREATE EXTENSION');
  });
});
