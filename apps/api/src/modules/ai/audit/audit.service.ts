import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditStore } from '../types/store-contracts';

@Injectable()
export class AuditService implements AuditStore {
  constructor(private readonly prisma: PrismaService) {}

  append(data: Prisma.AIAuditEventUncheckedCreateInput) {
    return this.prisma.aIAuditEvent.create({ data });
  }
}
