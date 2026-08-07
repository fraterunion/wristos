// Pure, presentation-only time helpers for the session's local activity
// list. Nothing here is persisted or sent to the server — timestamps are
// captured client-side purely to group and label the current session's
// history, per the existing "solo esta sesión" behavior.

export function formatRelativeTime(fromMs: number, nowMs: number): string {
  const diffMs = Math.max(0, nowMs - fromMs);
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  const diffDays = Math.round(diffHours / 24);
  return `hace ${diffDays} d`;
}

export type ConversationGroup = 'Hoy' | 'Ayer' | 'Anteriores';

function startOfDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function conversationGroupFor(fromMs: number, nowMs: number): ConversationGroup {
  const diffDays = Math.round((startOfDay(nowMs) - startOfDay(fromMs)) / 86_400_000);
  if (diffDays <= 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return 'Anteriores';
}
