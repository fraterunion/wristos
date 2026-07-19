import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut, getApiBaseUrl } from '@/lib/api-client';
import { readSession } from '@/lib/auth-storage';
import type {
  CommitResult,
  DataImportFile,
  DataImportRecordsPage,
  DataImportSession,
  DataImportSessionDetail,
  DocumentExtractionResponse,
  DryRunSummary,
  DuplicatePolicy,
  InventoryInvoiceExtraction,
  MappingEntry,
  MappingResponse,
} from '@/types/data-onboarding';

const AUTH = { authenticated: true } as const;

export function createDataImportSession(title?: string): Promise<DataImportSession> {
  return apiPost<DataImportSession>('/data-onboarding/sessions', title ? { title } : {}, AUTH);
}

export function listDataImportSessions(): Promise<DataImportSession[]> {
  return apiGet<DataImportSession[]>('/data-onboarding/sessions', AUTH);
}

export function getDataImportSession(sessionId: string): Promise<DataImportSessionDetail> {
  return apiGet<DataImportSessionDetail>(`/data-onboarding/sessions/${sessionId}`, AUTH);
}

export function listDataImportFiles(sessionId: string): Promise<DataImportFile[]> {
  return apiGet<DataImportFile[]>(`/data-onboarding/sessions/${sessionId}/files`, AUTH);
}

export async function uploadDataImportFile(sessionId: string, file: File): Promise<DataImportFile> {
  const form = new FormData();
  form.append('file', file);
  const session = readSession();
  const response = await fetch(`${getApiBaseUrl()}/data-onboarding/sessions/${sessionId}/files`, {
    method: 'POST',
    headers: session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {},
    body: form,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(payload?.message ?? `Upload failed (${response.status})`, response.status, payload);
  }
  return response.json() as Promise<DataImportFile>;
}

export function processDataImportSession(sessionId: string): Promise<DataImportSession> {
  return apiPost<DataImportSession>(`/data-onboarding/sessions/${sessionId}/process`, undefined, AUTH);
}

export function listDataImportRecords(
  sessionId: string,
  query: {
    fileId?: string;
    entityType?: string;
    valid?: string;
    rowStatus?: 'VALID' | 'WARNING' | 'INVALID';
    page?: number;
    limit?: number;
  } = {},
): Promise<DataImportRecordsPage> {
  return apiGet<DataImportRecordsPage>(`/data-onboarding/sessions/${sessionId}/records`, {
    ...AUTH,
    query,
  });
}

export function deleteDataImportSession(sessionId: string): Promise<void> {
  return apiDelete(`/data-onboarding/sessions/${sessionId}`, AUTH);
}

export function getImportMapping(sessionId: string, fileId: string): Promise<MappingResponse> {
  return apiGet<MappingResponse>(`/data-onboarding/sessions/${sessionId}/files/${fileId}/mapping`, AUTH);
}

export function saveImportMapping(sessionId: string, fileId: string, mapping: MappingEntry[]): Promise<{ mappingVersion: string }> {
  return apiPut<{ mappingVersion: string }>(`/data-onboarding/sessions/${sessionId}/files/${fileId}/mapping`, { mapping }, AUTH);
}

export function runDryRun(sessionId: string): Promise<DryRunSummary> {
  return apiPost<DryRunSummary>(`/data-onboarding/sessions/${sessionId}/dry-run`, undefined, AUTH);
}

export function commitImport(sessionId: string, duplicatePolicy: DuplicatePolicy): Promise<CommitResult> {
  return apiPost<CommitResult>(`/data-onboarding/sessions/${sessionId}/commit`, { duplicatePolicy }, AUTH);
}

/**
 * Downloads the error report through an authenticated fetch (Authorization
 * header only — the access token never appears in a URL) and returns a Blob
 * ready for URL.createObjectURL.
 */
export async function fetchErrorReportBlob(sessionId: string): Promise<Blob> {
  const session = readSession();
  const response = await fetch(`${getApiBaseUrl()}/data-onboarding/sessions/${sessionId}/error-report.csv`, {
    method: 'GET',
    headers: session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {},
  });
  if (!response.ok) {
    let message = `No se pudo descargar el reporte (${response.status})`;
    if (response.status === 401) message = 'Sesión expirada. Inicie sesión de nuevo para descargar el reporte.';
    if (response.status === 403) message = 'No tiene permiso para descargar este reporte.';
    throw new ApiError(message, response.status);
  }
  return response.blob();
}

/** Triggers a browser download of the error report via a revoked object URL. */
export async function downloadErrorReport(sessionId: string, filename = 'error-report.csv'): Promise<void> {
  const blob = await fetchErrorReportBlob(sessionId);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// ─── PDF Invoice Import (Sprint 3) ───────────────────────────────────────────

export function processDocument(sessionId: string): Promise<{ fileId: string; watchCount: number }> {
  return apiPost(`/data-onboarding/sessions/${sessionId}/process-document`, undefined, AUTH);
}

export function reprocessDocument(
  sessionId: string,
  opts?: { confirmDiscardEdits?: boolean },
): Promise<{ fileId: string; watchCount: number }> {
  return apiPost(`/data-onboarding/sessions/${sessionId}/reprocess-document`, opts ?? {}, AUTH);
}

export function getDocumentExtraction(sessionId: string): Promise<DocumentExtractionResponse> {
  return apiGet<DocumentExtractionResponse>(`/data-onboarding/sessions/${sessionId}/document-extraction`, AUTH);
}

export function updateDocumentExtraction(
  sessionId: string,
  extraction: InventoryInvoiceExtraction,
): Promise<{ watchCount: number }> {
  return apiPatch(`/data-onboarding/sessions/${sessionId}/document-extraction`, { extraction }, AUTH);
}

/**
 * Fetches a PDF file through an authenticated request. Returns a Blob that can
 * be turned into an object URL for display — the token never appears in a URL.
 */
export async function fetchPdfFileBlob(sessionId: string, fileId: string): Promise<Blob> {
  const session = readSession();
  const response = await fetch(
    `${getApiBaseUrl()}/data-onboarding/sessions/${sessionId}/files/${fileId}/content`,
    {
      method: 'GET',
      headers: session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {},
    },
  );
  if (!response.ok) {
    throw new ApiError(`No se pudo cargar el PDF (${response.status})`, response.status);
  }
  return response.blob();
}
