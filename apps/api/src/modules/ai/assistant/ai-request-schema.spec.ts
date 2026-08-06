import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('AIRequest persistence schema', () => {
  const root = join(__dirname, '../../../../../../');
  const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(join(root, 'prisma/migrations/20260806210000_ai_structured_assistant_orchestrator/migration.sql'), 'utf8');

  it('defines a dedicated durable request model and lifecycle enum', () => {
    expect(schema).toContain('model AIRequest {');
    expect(schema).toContain('enum AIRequestStatus {');
    expect(schema).toContain('responsePayload    Json?');
    expect(schema).toContain('responseHash       String?');
  });

  it('uses a database-level tenant/actor/client request uniqueness boundary', () => {
    expect(schema).toContain('@@unique([tenantId, actorUserId, clientRequestId])');
    expect(migration).toContain('CREATE UNIQUE INDEX "ai_requests_tenantId_actorUserId_clientRequestId_key"');
    expect(migration).toContain('ON "ai_requests"("tenantId", "actorUserId", "clientRequestId")');
  });

  it('is additive and contains no business table data migration', () => {
    expect(migration).toContain('CREATE TABLE "ai_requests"');
    expect(migration).not.toMatch(/^\s*(UPDATE|DELETE FROM|TRUNCATE)\b/m);
    expect(migration).not.toMatch(/ALTER TABLE "(watches|payments|deals|account_entries|account_payments|operating_expenses)"/);
  });
});
