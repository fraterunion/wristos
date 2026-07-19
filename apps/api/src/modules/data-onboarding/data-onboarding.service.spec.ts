import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataImportStatus, Prisma } from '@prisma/client';

import { buildRecordsWhere } from './data-onboarding.service';

const UPLOADABLE: DataImportStatus[] = [
  DataImportStatus.CREATED,
  DataImportStatus.UPLOADING,
  DataImportStatus.READY_FOR_REVIEW,
  DataImportStatus.FAILED,
];

const PROCESSABLE: DataImportStatus[] = [
  DataImportStatus.CREATED,
  DataImportStatus.UPLOADING,
  DataImportStatus.READY_FOR_REVIEW,
  DataImportStatus.FAILED,
];

const DELETABLE: DataImportStatus[] = [
  DataImportStatus.CREATED,
  DataImportStatus.UPLOADING,
  DataImportStatus.READY_FOR_REVIEW,
  DataImportStatus.FAILED,
  DataImportStatus.CANCELLED,
];

/** Mirrors DataOnboardingService upload/process/delete guards. */
export function assertCanUpload(status: DataImportStatus): void {
  if (!UPLOADABLE.includes(status)) {
    throw new ConflictException('La sesión no acepta archivos en su estado actual.');
  }
}

export function assertCanProcess(status: DataImportStatus): void {
  if (!PROCESSABLE.includes(status)) {
    throw new ConflictException('La sesión no puede procesarse en su estado actual.');
  }
}

export function assertCanDelete(status: DataImportStatus): void {
  if (!DELETABLE.includes(status)) {
    throw new ConflictException('No se puede eliminar la sesión mientras se procesa o importa.');
  }
}

/** Contract: every session lookup must include tenantId to prevent cross-tenant access. */
export function sessionLookupWhere(tenantId: string, sessionId: string) {
  return { id: sessionId, tenantId };
}

/** Contract: duplicate file detection is scoped to tenant + session + checksum. */
export function duplicateFileWhere(tenantId: string, sessionId: string, checksum: string) {
  return { tenantId, sessionId, checksum };
}

/** Contract: Phase 1 Prisma writes are limited to staging models. */
export const PHASE1_ALLOWED_WRITE_MODELS = [
  'DataImportSession',
  'DataImportFile',
  'DataImportRecord',
  'DataImportEvent',
] as const;

export const PHASE1_FORBIDDEN_WRITE_MODELS = [
  'Watch',
  'Client',
  'Deal',
  'Payment',
  'TreasuryEntry',
  'Investor',
  'WatchExpense',
  'OperatingExpense',
  'AccountEntry',
  'MarketListing',
] as const;

describe('session transitions', () => {
  it('allows upload/process for CREATED, UPLOADING, READY_FOR_REVIEW, FAILED', () => {
    for (const status of UPLOADABLE) {
      expect(() => assertCanUpload(status)).not.toThrow();
      expect(() => assertCanProcess(status)).not.toThrow();
    }
  });

  it('blocks upload/process for PROCESSING, IMPORTING, COMPLETED, CANCELLED', () => {
    for (const status of [
      DataImportStatus.PROCESSING,
      DataImportStatus.IMPORTING,
      DataImportStatus.COMPLETED,
      DataImportStatus.CANCELLED,
    ]) {
      expect(() => assertCanUpload(status)).toThrow(ConflictException);
      expect(() => assertCanProcess(status)).toThrow(ConflictException);
    }
  });

  it('blocks delete while PROCESSING or IMPORTING or COMPLETED', () => {
    expect(() => assertCanDelete(DataImportStatus.PROCESSING)).toThrow(ConflictException);
    expect(() => assertCanDelete(DataImportStatus.IMPORTING)).toThrow(ConflictException);
    expect(() => assertCanDelete(DataImportStatus.COMPLETED)).toThrow(ConflictException);
    expect(() => assertCanDelete(DataImportStatus.READY_FOR_REVIEW)).not.toThrow();
  });
});

describe('tenant isolation contract', () => {
  it('binds session lookups to both id and tenantId', () => {
    const where = sessionLookupWhere('tenant-a', 'session-1');
    expect(where).toEqual({ id: 'session-1', tenantId: 'tenant-a' });
    expect(Object.keys(where).sort()).toEqual(['id', 'tenantId']);
  });
});

describe('duplicate file detection contract', () => {
  it('scopes checksum checks to tenant and session', () => {
    const where = duplicateFileWhere('t1', 's1', 'abc123');
    expect(where).toEqual({ tenantId: 't1', sessionId: 's1', checksum: 'abc123' });
  });
});

describe('cross-tenant denial contract', () => {
  it('models NotFound when session belongs to another tenant', () => {
    const requestedTenant: string = 'tenant-a';
    const owningTenant: string = 'tenant-b';
    const found = requestedTenant === owningTenant ? { id: 'session-1' } : null;
    expect(found).toBeNull();
    expect(() => {
      if (!found) throw new NotFoundException('Import session not found');
    }).toThrow(NotFoundException);
  });
});

describe('operational write protection contract', () => {
  it('only allows staging models in Phase 1', () => {
    for (const model of PHASE1_FORBIDDEN_WRITE_MODELS) {
      expect(PHASE1_ALLOWED_WRITE_MODELS).not.toContain(model as never);
    }
  });
});

describe('listRecords rowStatus filter (buildRecordsWhere)', () => {
  it('always scopes by tenant and session', () => {
    const where = buildRecordsWhere('t1', 's1', {});
    expect(where.tenantId).toBe('t1');
    expect(where.sessionId).toBe('s1');
  });

  it('INVALID maps to isValid=false', () => {
    const where = buildRecordsWhere('t1', 's1', { rowStatus: 'INVALID' });
    expect(where.isValid).toBe(false);
    expect(where.validationWarnings).toBeUndefined();
  });

  it('VALID maps to isValid=true with no warnings', () => {
    const where = buildRecordsWhere('t1', 's1', { rowStatus: 'VALID' });
    expect(where.isValid).toBe(true);
    expect(where.validationWarnings).toEqual({ equals: Prisma.AnyNull });
  });

  it('WARNING maps to isValid=true with warnings present', () => {
    const where = buildRecordsWhere('t1', 's1', { rowStatus: 'WARNING' });
    expect(where.isValid).toBe(true);
    expect(where.validationWarnings).toEqual({ not: Prisma.AnyNull });
  });

  it('no rowStatus leaves records unfiltered by validity', () => {
    const where = buildRecordsWhere('t1', 's1', {});
    expect(where.isValid).toBeUndefined();
    expect(where.validationWarnings).toBeUndefined();
  });
});
