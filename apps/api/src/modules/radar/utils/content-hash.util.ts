import { createHash } from 'crypto';

export function computeContentHash(
  tenantId: string,
  senderRaw: string,
  timestamp: Date,
  content: string,
): string {
  const input = `${tenantId}|${senderRaw}|${timestamp.toISOString()}|${content}`;
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
