import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { DemoResetRefusedError, resetDemoOperationalData } from './demo-data-reset';
import { DEMO_TENANT_SLUG } from './demo-tenant.constants';

@Injectable()
export class DemoResetService {
  private readonly logger = new Logger(DemoResetService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Platform-admin demo reset. Target is DEMO_TENANT_SLUG (compiled-in).
   * Request body/query cannot select a tenant. Identity tables are not touched.
   */
  async resetDemoTenant(): Promise<{ tenantId: string; tenantSlug: string; durationMs: number }> {
    try {
      const result = await resetDemoOperationalData(this.prisma);
      return {
        tenantId: result.tenantId,
        tenantSlug: result.tenantSlug,
        durationMs: result.durationMs,
      };
    } catch (error) {
      if (error instanceof DemoResetRefusedError) {
        throw new NotFoundException(error.message);
      }
      this.logger.error('Demo reset failed', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /** Exposed for tests — the HTTP layer must not accept a slug override. */
  compiledInTargetSlug(): string {
    return DEMO_TENANT_SLUG;
  }
}
