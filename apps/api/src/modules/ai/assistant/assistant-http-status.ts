import { HttpStatus } from '@nestjs/common';
import { StructuredAssistantResponse } from './structured-assistant.types';

export type AssistantFailureType = 'NOT_FOUND' | 'PERMISSION_DENIED' | 'CONFLICT' | 'READ_EXECUTION_FAILED';

function failureType(response: StructuredAssistantResponse): string | null {
  const value = response.payload.errorType ?? response.payload.code;
  return typeof value === 'string' ? value : null;
}

export function structuredAssistantHttpStatus(response: StructuredAssistantResponse): HttpStatus | null {
  switch (failureType(response)) {
    case 'NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'PERMISSION_DENIED':
      return HttpStatus.FORBIDDEN;
    case 'CONFLICT':
      return HttpStatus.CONFLICT;
    case 'READ_EXECUTION_FAILED':
      return HttpStatus.INTERNAL_SERVER_ERROR;
    default:
      if (response.interactionState === 'STALE_PLAN') return HttpStatus.CONFLICT;
      if (response.interactionState === 'PERMISSION_BLOCKED') return HttpStatus.FORBIDDEN;
      if (response.interactionState === 'FAILED') return HttpStatus.INTERNAL_SERVER_ERROR;
      return null;
  }
}
