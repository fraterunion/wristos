import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ParsedMessage } from '../types/parsed-message.type';
import { looksLikePhone, normalizePhone } from '../utils/phone-normalizer.util';

@Injectable()
export class RadarContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertContactsFromMessages(
    tenantId: string,
    messages: ParsedMessage[],
  ): Promise<void> {
    // Aggregate first/last seen timestamps per unique sender (non-system only)
    const senderMap = new Map<string, { first: Date; last: Date }>();
    for (const msg of messages) {
      if (msg.isSystemMessage) continue;
      const existing = senderMap.get(msg.senderRaw);
      if (!existing) {
        senderMap.set(msg.senderRaw, { first: msg.timestamp, last: msg.timestamp });
      } else {
        if (msg.timestamp < existing.first) existing.first = msg.timestamp;
        if (msg.timestamp > existing.last) existing.last = msg.timestamp;
      }
    }

    for (const [senderRaw, { first, last }] of senderMap.entries()) {
      await this.upsertContact(tenantId, senderRaw, first, last);
    }
  }

  private async upsertContact(
    tenantId: string,
    senderRaw: string,
    firstSeen: Date,
    lastSeen: Date,
  ): Promise<void> {
    const isPhone = looksLikePhone(senderRaw);
    const phone = isPhone ? normalizePhone(senderRaw) : null;

    // Try to find an existing contact by phone first, then by displayName
    let existingId: string | null = null;
    let existingFirstSeen: Date | null = null;

    if (isPhone && phone) {
      const found = await this.prisma.contact.findFirst({
        where: { tenantId, phone },
        select: { id: true, firstSeenAt: true },
      });
      if (found) {
        existingId = found.id;
        existingFirstSeen = found.firstSeenAt;
      }
    }

    if (!existingId) {
      const found = await this.prisma.contact.findFirst({
        where: { tenantId, displayName: senderRaw },
        select: { id: true, firstSeenAt: true },
      });
      if (found) {
        existingId = found.id;
        existingFirstSeen = found.firstSeenAt;
      }
    }

    if (existingId) {
      const earlierFirst =
        existingFirstSeen && existingFirstSeen < firstSeen ? existingFirstSeen : firstSeen;
      await this.prisma.contact.updateMany({
        where: { id: existingId, tenantId },
        data: { lastSeenAt: lastSeen, firstSeenAt: earlierFirst },
      });
    } else {
      await this.prisma.contact.create({
        data: {
          tenant: { connect: { id: tenantId } },
          displayName: senderRaw,
          phone,
          whatsappId: phone,
          firstSeenAt: firstSeen,
          lastSeenAt: lastSeen,
        },
      });
    }
  }
}
