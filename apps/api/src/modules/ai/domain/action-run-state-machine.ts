import { BadRequestException } from '@nestjs/common';
import { AIActionRunStatus } from '@prisma/client';

const transitions: Readonly<Record<AIActionRunStatus, readonly AIActionRunStatus[]>> = {
  DRAFT: ['NEEDS_CLARIFICATION', 'READY_FOR_CONFIRMATION', 'EXECUTING', 'CANCELLED', 'STALE'],
  NEEDS_CLARIFICATION: ['DRAFT', 'READY_FOR_CONFIRMATION', 'CANCELLED', 'STALE'],
  READY_FOR_CONFIRMATION: ['EXECUTING', 'CANCELLED', 'STALE'],
  EXECUTING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  // Recovery only: business write committed but runtime previously marked FAILED.
  FAILED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  STALE: [],
};

export function canTransition(from: AIActionRunStatus, to: AIActionRunStatus): boolean {
  return transitions[from].includes(to);
}

export function assertValidTransition(from: AIActionRunStatus, to: AIActionRunStatus): void {
  if (!canTransition(from, to)) {
    throw new BadRequestException(`Illegal AI action run transition: ${from} -> ${to}`);
  }
}
