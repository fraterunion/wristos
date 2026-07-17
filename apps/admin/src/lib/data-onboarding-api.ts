import { ApiError, apiDelete, apiGet, apiPost, getApiBaseUrl } from '@/lib/api-client';
import { readSession } from '@/lib/auth-storage';
import type {
  DataImportFile,
  DataImportRecordsPage,
  DataImportSession,
  DataImportSessionDetail,
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
  query: { fileId?: string; entityType?: string; valid?: string; page?: number; limit?: number } = {},
): Promise<DataImportRecordsPage> {
  return apiGet<DataImportRecordsPage>(`/data-onboarding/sessions/${sessionId}/records`, {
    ...AUTH,
    query,
  });
}

export function deleteDataImportSession(sessionId: string): Promise<void> {
  return apiDelete(`/data-onboarding/sessions/${sessionId}`, AUTH);
}
