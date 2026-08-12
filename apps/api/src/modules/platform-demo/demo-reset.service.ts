import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { promisify } from 'util';

import { PrismaService } from '../../prisma/prisma.service';

const execFileAsync = promisify(execFile);

/**
 * Must match DEMO_SLUG in prisma/seed.ts. Intentionally NOT read from a
 * request parameter — the reset target is a compiled-in constant so no
 * request shape can ever point this at Wrist Caviar.
 */
export const DEMO_TENANT_SLUG = 'wristos-demo';

@Injectable()
export class DemoResetService {
  private readonly logger = new Logger(DemoResetService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resetDemoTenant(): Promise<{ tenantId: string; tenantSlug: string; durationMs: number }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: DEMO_TENANT_SLUG } });

    // Fail closed: refuse to run if the demo tenant doesn't exist yet, or if
    // the slug we're targeting somehow doesn't carry the isDemo flag.
    if (!tenant || !tenant.isDemo) {
      throw new NotFoundException(
        `Demo tenant ("${DEMO_TENANT_SLUG}") not found or not flagged isDemo — refusing to reset. Provision it first via the seed CLI.`,
      );
    }

    const repoRoot = this.findRepoRoot(__dirname);
    const startedAt = Date.now();

    try {
      await execFileAsync('npx', ['tsx', 'prisma/seed.ts'], {
        cwd: repoRoot,
        env: {
          ...process.env,
          SEED_TENANT_SLUG: DEMO_TENANT_SLUG,
          SEED_ALLOW_NONDEMO: 'false',
        },
        timeout: 120_000,
      });
    } catch (error) {
      this.logger.error('Demo reset failed', error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Demo reset failed — see server logs for details.');
    }

    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      durationMs: Date.now() - startedAt,
    };
  }

  /** Walks up from this file's directory until it finds prisma/seed.ts, so this works
   * from both ts-node (src) and compiled (dist) locations without a hardcoded depth. */
  private findRepoRoot(startDir: string): string {
    let dir = startDir;
    for (let i = 0; i < 12; i += 1) {
      if (existsSync(join(dir, 'prisma', 'seed.ts'))) {
        return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new InternalServerErrorException('Could not locate repo root (prisma/seed.ts not found).');
  }
}
