import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PlatformAdminGuard } from '../platform-migrations/guards/platform-admin.guard';
import { DemoResetRefusedError, resetDemoOperationalData } from './demo-data-reset';
import { DemoResetController } from './demo-reset.controller';
import { DemoResetService } from './demo-reset.service';
import { DEMO_TENANT_SLUG } from './demo-tenant.constants';

jest.mock('./demo-data-reset', () => {
  const actual = jest.requireActual('./demo-data-reset');
  return {
    ...actual,
    resetDemoOperationalData: jest.fn(),
  };
});

describe('DemoResetService / controller contract', () => {
  const prisma = {};
  const service = new DemoResetService(prisma as never);
  const mockedReset = resetDemoOperationalData as jest.MockedFunction<typeof resetDemoOperationalData>;

  beforeEach(() => {
    mockedReset.mockReset();
  });

  it('targets the compiled-in slug and does not read request input', () => {
    expect(service.compiledInTargetSlug()).toBe('wristos-demo');
    expect(service.compiledInTargetSlug()).toBe(DEMO_TENANT_SLUG);
    const controller = new DemoResetController(service);
    expect(controller.reset.length).toBe(0);
  });

  it('refuses reset when wristos-demo is missing or isDemo=false', async () => {
    mockedReset.mockRejectedValue(
      new DemoResetRefusedError('Demo tenant ("wristos-demo") not found or not flagged isDemo'),
    );
    await expect(service.resetDemoTenant()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns tenant identity when reset succeeds', async () => {
    mockedReset.mockResolvedValue({
      tenantId: 'demo-id',
      tenantSlug: 'wristos-demo',
      durationMs: 12,
      counts: { watches: 60 },
    });
    await expect(service.resetDemoTenant()).resolves.toEqual({
      tenantId: 'demo-id',
      tenantSlug: 'wristos-demo',
      durationMs: 12,
    });
  });
});

describe('Demo reset authorization', () => {
  function guardWith(env: Record<string, string>) {
    return new PlatformAdminGuard({ get: (key: string) => env[key] } as ConfigService);
  }
  function ctx(user?: { userId: string; email?: string; role?: string }) {
    return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as never;
  }

  it('forbids a non-platform-admin from reset', () => {
    const g = guardWith({ PLATFORM_ADMIN_EMAILS: 'admin@fraterunion.com' });
    expect(() =>
      g.canActivate(ctx({ userId: 'u1', email: 'owner@tenant.com', role: 'OWNER' })),
    ).toThrow(ForbiddenException);
  });

  it('allows a platform admin to call reset', () => {
    const g = guardWith({ PLATFORM_ADMIN_EMAILS: 'admin@fraterunion.com' });
    expect(
      g.canActivate(ctx({ userId: 'u1', email: 'admin@fraterunion.com', role: 'OWNER' })),
    ).toBe(true);
  });

  it('rejects unauthenticated reset', () => {
    const g = guardWith({ PLATFORM_ADMIN_EMAILS: 'admin@fraterunion.com' });
    expect(() => g.canActivate(ctx(undefined))).toThrow(UnauthorizedException);
  });
});
