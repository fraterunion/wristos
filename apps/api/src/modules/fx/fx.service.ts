import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FxCacheEntry {
  rate: number;
  source: string;
  fetchedAt: Date;
}

export interface FxRateResult {
  pair: string;
  rate: number;
  source: string;
  fetchedAt: string;
  stale?: boolean;
}

interface ErApiResponse {
  result: string;
  base_code: string;
  rates: Record<string, number>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes
const FETCH_TIMEOUT_MS = 8_000;

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private cache: FxCacheEntry | null = null;

  constructor(private readonly config: ConfigService) {}

  async getUsdMxn(): Promise<FxRateResult> {
    const now = new Date();

    if (this.cache && now.getTime() - this.cache.fetchedAt.getTime() < CACHE_TTL_MS) {
      return this.serialize(this.cache);
    }

    try {
      const entry = await this.fetchRate();
      this.cache = entry;
      return this.serialize(entry);
    } catch (err) {
      this.logger.warn(
        'FX rate fetch failed — %s',
        err instanceof Error ? err.message : String(err),
      );

      if (this.cache) {
        this.logger.warn('Returning stale FX rate (cached at %s)', this.cache.fetchedAt.toISOString());
        return { ...this.serialize(this.cache), stale: true };
      }

      throw new ServiceUnavailableException(
        'USD/MXN exchange rate is currently unavailable. Try again shortly.',
      );
    }
  }

  private async fetchRate(): Promise<FxCacheEntry> {
    const apiKey = this.config.get<string>('EXCHANGE_RATE_API_KEY');

    // Use authenticated endpoint when key is configured, free tier otherwise.
    // Key is never logged.
    const url = apiKey
      ? `https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`
      : 'https://open.er-api.com/v6/latest/USD';
    const source = apiKey ? 'exchangerate-api.com' : 'open.er-api.com';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`FX API returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as ErApiResponse;

    if (data.result !== 'success') {
      throw new Error(`FX API result: ${data.result}`);
    }

    const rate = data.rates['MXN'];
    if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) {
      throw new Error('MXN rate is missing or invalid in API response');
    }

    return { rate, source, fetchedAt: new Date() };
  }

  private serialize(entry: FxCacheEntry): FxRateResult {
    return {
      pair: 'USD/MXN',
      rate: entry.rate,
      source: entry.source,
      fetchedAt: entry.fetchedAt.toISOString(),
    };
  }
}
