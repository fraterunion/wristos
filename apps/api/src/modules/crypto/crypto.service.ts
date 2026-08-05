import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssetHolding, AssetPriceSnapshot, AssetType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  holdingCostBasis,
  holdingCurrentValue,
  money2,
  unrealizedPnl,
  unrealizedPnlPercent,
  ZERO,
} from './crypto-math';
import {
  resolveCryptoPriceStatus,
  worstCryptoPriceStatus,
  type CryptoPriceStatus,
} from './crypto-staleness';
import { CreateHoldingDto } from './dto/create-holding.dto';
import { CreatePriceSnapshotDto } from './dto/create-price-snapshot.dto';
import { UpdateHoldingDto } from './dto/update-holding.dto';

export type LatestPriceMap = Map<
  string,
  { priceMxn: Prisma.Decimal; capturedAt: Date; source: string; id: string }
>;

@Injectable()
export class CryptoService {
  constructor(private readonly prisma: PrismaService) {}

  normalizeTicker(ticker: string): string {
    return ticker.trim().toUpperCase();
  }

  async getLatestPricesByTicker(
    tenantId: string,
    tickers?: string[],
  ): Promise<LatestPriceMap> {
    const where: Prisma.AssetPriceSnapshotWhereInput = {
      tenantId,
      assetType: AssetType.CRYPTO,
    };
    if (tickers && tickers.length > 0) {
      where.ticker = { in: tickers.map((t) => this.normalizeTicker(t)) };
    }

    const rows = await this.prisma.assetPriceSnapshot.findMany({
      where,
      orderBy: [{ ticker: 'asc' }, { capturedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const map: LatestPriceMap = new Map();
    for (const row of rows) {
      if (!map.has(row.ticker)) {
        map.set(row.ticker, {
          priceMxn: row.priceMxn,
          capturedAt: row.capturedAt,
          source: row.source,
          id: row.id,
        });
      }
    }
    return map;
  }

  /**
   * Portfolio valuation for dashboard liquidity.
   * Unpriced holdings are excluded from current value (not silently zeroed).
   */
  async getPortfolioValuation(tenantId: string, now: Date = new Date()) {
    const holdings = await this.prisma.assetHolding.findMany({
      where: {
        tenantId,
        assetType: AssetType.CRYPTO,
        deletedAt: null,
      },
    });

    const tickers = [...new Set(holdings.map((h) => h.ticker))];
    const latest = await this.getLatestPricesByTicker(tenantId, tickers);

    let totalCurrentValue = ZERO;
    let totalCostBasis = ZERO;
    let pricedHoldingCount = 0;
    const missingPriceTickers = new Set<string>();
    const statuses: CryptoPriceStatus[] = [];
    let oldest: Date | null = null;
    let newest: Date | null = null;

    for (const h of holdings) {
      const cost = holdingCostBasis(h.quantity, h.averageCostMxn);
      totalCostBasis = totalCostBasis.plus(cost);

      const price = latest.get(h.ticker);
      if (!price) {
        missingPriceTickers.add(h.ticker);
        statuses.push('MISSING');
        continue;
      }

      pricedHoldingCount += 1;
      const value = holdingCurrentValue(h.quantity, price.priceMxn)!;
      totalCurrentValue = totalCurrentValue.plus(value);

      const status = resolveCryptoPriceStatus(price.capturedAt, now);
      statuses.push(status);

      if (!oldest || price.capturedAt < oldest) oldest = price.capturedAt;
      if (!newest || price.capturedAt > newest) newest = price.capturedAt;
    }

    const pnl = totalCurrentValue.minus(totalCostBasis);
    const unpricedHoldingCount = holdings.length - pricedHoldingCount;
    const portfolioStatus =
      holdings.length === 0
        ? ('MISSING' as CryptoPriceStatus)
        : worstCryptoPriceStatus(statuses);

    return {
      totalCurrentValueMxn: money2(totalCurrentValue),
      totalCostBasisMxn: money2(totalCostBasis),
      unrealizedPnlMxn: money2(pnl),
      unrealizedPnlPercent: unrealizedPnlPercent(pnl, totalCostBasis),
      activeHoldingCount: holdings.length,
      pricedHoldingCount,
      unpricedHoldingCount,
      missingPriceTickers: [...missingPriceTickers].sort(),
      oldestPriceCapturedAt: oldest?.toISOString() ?? null,
      newestPriceCapturedAt: newest?.toISOString() ?? null,
      cryptoPriceStatus: portfolioStatus,
      /** Decimal for analytics arithmetic without re-parse drift */
      _totalCurrentValue: totalCurrentValue,
      _totalCostBasis: totalCostBasis,
      _unrealizedPnl: pnl,
    };
  }

  async getSummary(tenantId: string) {
    const v = await this.getPortfolioValuation(tenantId);
    return {
      totalCurrentValueMxn: v.totalCurrentValueMxn,
      totalCostBasisMxn: v.totalCostBasisMxn,
      unrealizedPnlMxn: v.unrealizedPnlMxn,
      unrealizedPnlPercent: v.unrealizedPnlPercent,
      activeHoldingCount: v.activeHoldingCount,
      pricedHoldingCount: v.pricedHoldingCount,
      unpricedHoldingCount: v.unpricedHoldingCount,
      missingPriceTickers: v.missingPriceTickers,
      oldestPriceCapturedAt: v.oldestPriceCapturedAt,
      newestPriceCapturedAt: v.newestPriceCapturedAt,
      cryptoPriceStatus: v.cryptoPriceStatus,
    };
  }

  async listHoldings(tenantId: string, now: Date = new Date()) {
    const holdings = await this.prisma.assetHolding.findMany({
      where: {
        tenantId,
        assetType: AssetType.CRYPTO,
        deletedAt: null,
      },
      orderBy: [{ ticker: 'asc' }, { location: 'asc' }, { createdAt: 'asc' }],
    });

    const latest = await this.getLatestPricesByTicker(
      tenantId,
      holdings.map((h) => h.ticker),
    );

    return holdings.map((h) => this.serializeHolding(h, latest.get(h.ticker), now));
  }

  async createHolding(tenantId: string, dto: CreateHoldingDto) {
    const ticker = this.normalizeTicker(dto.ticker);
    if (dto.quantity < 0) {
      throw new BadRequestException('quantity must be non-negative');
    }
    if (dto.averageCostMxn < 0) {
      throw new BadRequestException('averageCostMxn must be non-negative');
    }

    const created = await this.prisma.assetHolding.create({
      data: {
        tenantId,
        assetType: AssetType.CRYPTO,
        ticker,
        name: dto.name.trim(),
        quantity: new Prisma.Decimal(dto.quantity),
        averageCostMxn: new Prisma.Decimal(dto.averageCostMxn),
        location: dto.location.trim(),
        custodian: dto.custodian?.trim() || null,
        notes: dto.notes?.trim() || null,
      },
    });

    const latest = await this.getLatestPricesByTicker(tenantId, [ticker]);
    return this.serializeHolding(created, latest.get(ticker));
  }

  async updateHolding(id: string, tenantId: string, dto: UpdateHoldingDto) {
    const existing = await this.findActiveHolding(id, tenantId);

    const data: Prisma.AssetHoldingUpdateInput = {};
    if (dto.ticker !== undefined) data.ticker = this.normalizeTicker(dto.ticker);
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.quantity !== undefined) {
      if (dto.quantity < 0) throw new BadRequestException('quantity must be non-negative');
      data.quantity = new Prisma.Decimal(dto.quantity);
    }
    if (dto.averageCostMxn !== undefined) {
      if (dto.averageCostMxn < 0) {
        throw new BadRequestException('averageCostMxn must be non-negative');
      }
      data.averageCostMxn = new Prisma.Decimal(dto.averageCostMxn);
    }
    if (dto.location !== undefined) data.location = dto.location.trim();
    if (dto.custodian !== undefined) {
      data.custodian = dto.custodian === null ? null : dto.custodian.trim() || null;
    }
    if (dto.notes !== undefined) {
      data.notes = dto.notes === null ? null : dto.notes.trim() || null;
    }

    const updated =
      Object.keys(data).length === 0
        ? existing
        : await this.prisma.assetHolding.update({ where: { id }, data });

    const latest = await this.getLatestPricesByTicker(tenantId, [updated.ticker]);
    return this.serializeHolding(updated, latest.get(updated.ticker));
  }

  async softDeleteHolding(id: string, tenantId: string) {
    await this.findActiveHolding(id, tenantId);
    await this.prisma.assetHolding.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async listLatestPrices(tenantId: string, now: Date = new Date()) {
    const holdings = await this.prisma.assetHolding.findMany({
      where: { tenantId, assetType: AssetType.CRYPTO, deletedAt: null },
      select: { ticker: true },
    });
    const activeTickers = [...new Set(holdings.map((h) => h.ticker))].sort();
    const latest = await this.getLatestPricesByTicker(tenantId, activeTickers);

    return activeTickers.map((ticker) => {
      const price = latest.get(ticker);
      const status = resolveCryptoPriceStatus(price?.capturedAt, now);
      return {
        ticker,
        priceMxn: price ? price.priceMxn.toFixed(8) : null,
        capturedAt: price?.capturedAt.toISOString() ?? null,
        source: price?.source ?? null,
        priceStatus: status,
        ageHours: price
          ? Number(
              (
                (now.getTime() - price.capturedAt.getTime()) /
                (60 * 60 * 1000)
              ).toFixed(2),
            )
          : null,
      };
    });
  }

  async createPriceSnapshot(
    tenantId: string,
    dto: CreatePriceSnapshotDto,
    createdByUserId?: string,
  ) {
    const ticker = this.normalizeTicker(dto.ticker);
    const price = new Prisma.Decimal(dto.priceMxn);
    if (price.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException('priceMxn must be greater than zero');
    }

    const capturedAt = new Date(dto.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      throw new BadRequestException('capturedAt must be a valid datetime');
    }

    const created = await this.prisma.assetPriceSnapshot.create({
      data: {
        tenantId,
        assetType: AssetType.CRYPTO,
        ticker,
        priceMxn: price,
        capturedAt,
        source: dto.source.trim(),
        notes: dto.notes?.trim() || null,
        createdByUserId: createdByUserId ?? null,
      },
    });

    return this.serializeSnapshot(created);
  }

  async getPriceHistory(tenantId: string, tickerRaw: string, limit = 50) {
    const ticker = this.normalizeTicker(tickerRaw);
    const take = Math.min(Math.max(limit, 1), 200);
    const rows = await this.prisma.assetPriceSnapshot.findMany({
      where: { tenantId, assetType: AssetType.CRYPTO, ticker },
      orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
      take,
    });
    return {
      ticker,
      items: rows.map((r) => this.serializeSnapshot(r)),
    };
  }

  private async findActiveHolding(id: string, tenantId: string): Promise<AssetHolding> {
    const holding = await this.prisma.assetHolding.findFirst({
      where: { id, tenantId, assetType: AssetType.CRYPTO, deletedAt: null },
    });
    if (!holding) throw new NotFoundException('Holding not found');
    return holding;
  }

  private serializeHolding(
    h: AssetHolding,
    price:
      | { priceMxn: Prisma.Decimal; capturedAt: Date; source: string; id: string }
      | undefined,
    now: Date = new Date(),
  ) {
    const costBasis = holdingCostBasis(h.quantity, h.averageCostMxn);
    const currentValue = holdingCurrentValue(h.quantity, price?.priceMxn ?? null);
    const pnl = unrealizedPnl(currentValue, costBasis);
    const priceStatus = resolveCryptoPriceStatus(price?.capturedAt, now);

    return {
      id: h.id,
      tenantId: h.tenantId,
      assetType: h.assetType,
      ticker: h.ticker,
      name: h.name,
      quantity: h.quantity.toString(),
      averageCostMxn: h.averageCostMxn.toFixed(8),
      location: h.location,
      custodian: h.custodian,
      notes: h.notes,
      createdAt: h.createdAt.toISOString(),
      updatedAt: h.updatedAt.toISOString(),
      latestPriceMxn: price ? price.priceMxn.toFixed(8) : null,
      priceCapturedAt: price?.capturedAt.toISOString() ?? null,
      priceSource: price?.source ?? null,
      currentValueMxn: currentValue != null ? money2(currentValue) : null,
      costBasisMxn: money2(costBasis),
      unrealizedPnlMxn: pnl != null ? money2(pnl) : null,
      unrealizedPnlPercent: unrealizedPnlPercent(pnl, costBasis),
      priceStatus,
    };
  }

  private serializeSnapshot(row: AssetPriceSnapshot) {
    return {
      id: row.id,
      tenantId: row.tenantId,
      assetType: row.assetType,
      ticker: row.ticker,
      priceMxn: row.priceMxn.toFixed(8),
      capturedAt: row.capturedAt.toISOString(),
      source: row.source,
      notes: row.notes,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
