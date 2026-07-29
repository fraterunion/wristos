import type { ResolutionType } from './config';

export type ResolutionRecord = {
  id: string;
  issueCode?: string | null;
  entityType?: string | null;
  sourceCandidateId?: string | null;
  resolutionType: ResolutionType;
  resolvedValue?: Record<string, unknown>;
  reason: string;
  actor: string;
  date: string;
  acknowledgedWarning?: boolean;
};

export type ResolutionsFile = {
  version: 1;
  migrationSource: 'wrist-caviar-master-workbook-v1';
  workbookFingerprint?: string;
  notes: string;
  resolutions: ResolutionRecord[];
};

export function emptyResolutionsTemplate(workbookFingerprint: string): ResolutionsFile {
  return {
    version: 1,
    migrationSource: 'wrist-caviar-master-workbook-v1',
    workbookFingerprint,
    notes:
      'Fill human decisions only. Do not invent financial values. Deferred groups should use DEFER.',
    resolutions: [
      {
        id: 'res_defer_crypto',
        entityType: 'deferred',
        sourceCandidateId: null,
        issueCode: 'DEFERRED_DESTINATION',
        resolutionType: 'DEFER',
        reason: 'CRIPTO CESAR outside WristOS operational scope for this migration',
        actor: 'PENDING_HUMAN',
        date: new Date().toISOString().slice(0, 10),
        resolvedValue: { group: 'CRIPTO_CESAR' },
      },
      {
        id: 'res_defer_oscar',
        entityType: 'deferred',
        sourceCandidateId: null,
        issueCode: 'DEFERRED_DESTINATION',
        resolutionType: 'DEFER',
        reason: 'OSCAR PAPA CAMI outside WristOS operational scope for this migration',
        actor: 'PENDING_HUMAN',
        date: new Date().toISOString().slice(0, 10),
        resolvedValue: { group: 'OSCAR_PAPA_CAMI' },
      },
    ],
  };
}

export function validateResolutionsFile(raw: unknown): ResolutionsFile {
  if (!raw || typeof raw !== 'object') throw new Error('resolutions.json must be an object');
  const file = raw as ResolutionsFile;
  if (file.version !== 1) throw new Error('resolutions.version must be 1');
  if (!Array.isArray(file.resolutions)) throw new Error('resolutions.resolutions must be an array');
  for (const r of file.resolutions) {
    if (!r.id || !r.resolutionType || !r.reason || !r.actor || !r.date) {
      throw new Error(`Invalid resolution record: ${r.id ?? '(missing id)'}`);
    }
    if (
      ['CORRECT_VALUE', 'FORMULA_OVERRIDE', 'MAP_TO_EXISTING', 'CORRECT_SERIAL'].includes(
        r.resolutionType,
      ) &&
      r.actor === 'PENDING_HUMAN'
    ) {
      throw new Error(`Resolution ${r.id} still has actor PENDING_HUMAN`);
    }
  }
  return file;
}
