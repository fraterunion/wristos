import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConfirmListingDto, DismissListingDto } from '../dto/confirm-listing.dto';
import { SearchListingsDto } from '../dto/search-listings.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';

// Explicitly enumerate safe fields — aiRawResponse and metadata are intentionally excluded.
const CARD_SELECT = {
  id: true,
  intent: true,
  brand: true,
  rawModelMention: true,
  referenceNumberExplicit: true,
  referenceSource: true,
  priceAmount: true,
  priceCurrency: true,
  feedConfidence: true,
  reviewStatus: true,
  urgencyDetected: true,
  aiSummary: true,
  createdAt: true,
  contact: { select: { id: true, displayName: true } },
  message: {
    select: {
      importId: true,
      postedAt: true,
      import: { select: { sourceGroupName: true } },
    },
  },
} satisfies Prisma.MarketListingSelect;

const DETAIL_SELECT = {
  id: true,
  messageId: true,
  contactId: true,
  watchReferenceId: true,
  intent: true,
  reviewStatus: true,
  referenceSource: true,
  brand: true,
  feedConfidence: true,
  initialConfidence: true,
  rawModelMention: true,
  referenceNumberExplicit: true,
  aiSummary: true,
  urgencyDetected: true,
  conditionNotes: true,
  hasBox: true,
  hasPapers: true,
  year: true,
  dealerNotes: true,
  confirmedBy: true,
  confirmedAt: true,
  dismissedBy: true,
  dismissedAt: true,
  title: true,
  description: true,
  priceAmount: true,
  priceCurrency: true,
  location: true,
  createdAt: true,
  updatedAt: true,
  contact: {
    select: { id: true, displayName: true, phone: true, whatsappId: true },
  },
  watchReference: {
    select: {
      id: true,
      brand: true,
      model: true,
      reference: true,
      line: true,
      approximateRetailUsd: true,
    },
  },
  message: {
    select: {
      id: true,
      content: true,
      senderRaw: true,
      postedAt: true,
      importId: true,
      import: {
        select: {
          id: true,
          sourceGroupName: true,
          dateRangeStart: true,
          dateRangeEnd: true,
        },
      },
    },
  },
} satisfies Prisma.MarketListingSelect;

@Injectable()
export class RadarListingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, dto: SearchListingsDto) {
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.MarketListingWhereInput = {
      tenantId,
      deletedAt: null,
    };

    // Exclude DISMISSED by default unless caller explicitly requests it
    if (dto.reviewStatus) {
      where.reviewStatus = dto.reviewStatus;
    } else {
      where.reviewStatus = { not: ReviewStatus.DISMISSED };
    }

    if (dto.intent) where.intent = dto.intent;

    if (dto.brand) {
      where.brand = { contains: dto.brand, mode: 'insensitive' };
    }

    if (dto.dateFrom ?? dto.dateTo) {
      where.createdAt = {
        ...(dto.dateFrom ? { gte: new Date(dto.dateFrom) } : {}),
        ...(dto.dateTo ? { lte: new Date(dto.dateTo) } : {}),
      };
    }

    if (dto.priceMin != null || dto.priceMax != null) {
      where.priceAmount = {
        ...(dto.priceMin != null ? { gte: new Prisma.Decimal(dto.priceMin) } : {}),
        ...(dto.priceMax != null ? { lte: new Prisma.Decimal(dto.priceMax) } : {}),
      };
    }

    if (dto.minConfidence != null) {
      where.feedConfidence = { gte: dto.minConfidence };
    }

    if (dto.q) {
      where.OR = [
        { brand: { contains: dto.q, mode: 'insensitive' } },
        { rawModelMention: { contains: dto.q, mode: 'insensitive' } },
        { referenceNumberExplicit: { contains: dto.q, mode: 'insensitive' } },
        { aiSummary: { contains: dto.q, mode: 'insensitive' } },
        { conditionNotes: { contains: dto.q, mode: 'insensitive' } },
        { dealerNotes: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    let orderBy: Prisma.MarketListingOrderByWithRelationInput;
    switch (dto.sort) {
      case 'confidence':
        orderBy = { feedConfidence: 'desc' };
        break;
      case 'price':
        // PostgreSQL ASC places nulls last by default, which is correct for price sort
        orderBy = { priceAmount: 'asc' };
        break;
      default:
        orderBy = { createdAt: 'desc' };
    }

    const [listings, total] = await Promise.all([
      this.prisma.marketListing.findMany({
        where,
        select: CARD_SELECT,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.marketListing.count({ where }),
    ]);

    return { listings, total, page, limit };
  }

  async findReviewQueue(tenantId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.MarketListingWhereInput = {
      tenantId,
      deletedAt: null,
      reviewStatus: ReviewStatus.PENDING_REVIEW,
    };

    const [listings, total] = await Promise.all([
      this.prisma.marketListing.findMany({
        where,
        select: DETAIL_SELECT,
        orderBy: [{ feedConfidence: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.marketListing.count({ where }),
    ]);

    return { listings, total, page, limit };
  }

  async findOne(tenantId: string, id: string) {
    const listing = await this.prisma.marketListing.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: DETAIL_SELECT,
    });

    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }

  async update(tenantId: string, id: string, dto: UpdateListingDto) {
    const existing = await this.prisma.marketListing.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Listing not found');

    if (dto.watchReferenceId) {
      const ref = await this.prisma.watchReference.findUnique({
        where: { id: dto.watchReferenceId },
        select: { id: true },
      });
      if (!ref) throw new BadRequestException('watchReferenceId does not exist');
    }

    const data: Prisma.MarketListingUncheckedUpdateInput = {};
    this.applyEditableFields(data, dto);

    await this.prisma.marketListing.updateMany({
      where: { id, tenantId },
      data,
    });

    return this.findOne(tenantId, id);
  }

  async confirm(tenantId: string, id: string, userId: string, dto: ConfirmListingDto) {
    const existing = await this.prisma.marketListing.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Listing not found');

    if (dto.watchReferenceId) {
      const ref = await this.prisma.watchReference.findUnique({
        where: { id: dto.watchReferenceId },
        select: { id: true },
      });
      if (!ref) throw new BadRequestException('watchReferenceId does not exist');
    }

    const data: Prisma.MarketListingUncheckedUpdateInput = {
      reviewStatus: ReviewStatus.CONFIRMED,
      confirmedBy: userId,
      confirmedAt: new Date(),
      // Clear any prior dismissal
      dismissedBy: null,
      dismissedAt: null,
    };
    this.applyEditableFields(data, dto);

    await this.prisma.marketListing.updateMany({
      where: { id, tenantId },
      data,
    });

    return this.findOne(tenantId, id);
  }

  async dismiss(tenantId: string, id: string, userId: string, dto: DismissListingDto) {
    const existing = await this.prisma.marketListing.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, dealerNotes: true },
    });
    if (!existing) throw new NotFoundException('Listing not found');

    const dealerNotes = dto.reason
      ? [existing.dealerNotes, `Dismissed: ${dto.reason}`].filter(Boolean).join('\n')
      : existing.dealerNotes ?? undefined;

    await this.prisma.marketListing.updateMany({
      where: { id, tenantId },
      data: {
        reviewStatus: ReviewStatus.DISMISSED,
        dismissedBy: userId,
        dismissedAt: new Date(),
        ...(dealerNotes !== undefined ? { dealerNotes } : {}),
      },
    });

    const updated = await this.prisma.marketListing.findFirst({
      where: { id, tenantId },
      select: { id: true, reviewStatus: true, dismissedAt: true },
    });

    return updated;
  }

  async getContactProfile(tenantId: string, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, tenantId },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    const [listingCount, messageCount, recentListings, recentRequests] = await Promise.all([
      this.prisma.marketListing.count({
        where: { tenantId, contactId, deletedAt: null },
      }),
      // Approximate message count by senderRaw = contact's displayName (how contacts are linked)
      this.prisma.channelMessage.count({
        where: { tenantId, senderRaw: contact.displayName ?? '' },
      }),
      this.prisma.marketListing.findMany({
        where: {
          tenantId,
          contactId,
          deletedAt: null,
          intent: { in: ['SELL_OFFER', 'PRICE_SIGNAL'] },
        },
        select: CARD_SELECT,
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.marketListing.findMany({
        where: { tenantId, contactId, deletedAt: null, intent: 'BUY_REQUEST' },
        select: CARD_SELECT,
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const rawIdentifiers: Record<string, string> = {};
    if (contact.whatsappId) rawIdentifiers['whatsappId'] = contact.whatsappId;
    if (contact.phone) rawIdentifiers['phone'] = contact.phone;
    if (contact.telegramUsername) rawIdentifiers['telegramUsername'] = contact.telegramUsername;
    if (contact.telegramUserId) rawIdentifiers['telegramUserId'] = contact.telegramUserId;

    return {
      id: contact.id,
      displayName: contact.displayName,
      phone: contact.phone,
      clientId: contact.clientId,
      rawIdentifiers,
      messageCount,
      listingCount,
      firstSeenAt: contact.firstSeenAt,
      lastSeenAt: contact.lastSeenAt,
      recentListings,
      recentRequests,
    };
  }

  private applyEditableFields(
    data: Prisma.MarketListingUncheckedUpdateInput,
    dto: UpdateListingDto,
  ): void {
    if (dto.brand !== undefined) data.brand = dto.brand;
    if (dto.watchReferenceId !== undefined) data.watchReferenceId = dto.watchReferenceId;
    if (dto.referenceNumber !== undefined) data.referenceNumberExplicit = dto.referenceNumber;
    if (dto.conditionNotes !== undefined) data.conditionNotes = dto.conditionNotes;
    if (dto.priceAmount !== undefined) data.priceAmount = new Prisma.Decimal(dto.priceAmount);
    if (dto.priceCurrency !== undefined) data.priceCurrency = dto.priceCurrency;
    if (dto.hasBox !== undefined) data.hasBox = dto.hasBox;
    if (dto.hasPapers !== undefined) data.hasPapers = dto.hasPapers;
    if (dto.year !== undefined) data.year = dto.year;
    if (dto.intent !== undefined) data.intent = dto.intent;
    if (dto.dealerNotes !== undefined) data.dealerNotes = dto.dealerNotes;
  }
}
