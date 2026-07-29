import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PlatformAdminGuard } from '../../guards/platform-admin.guard';

describe('PlatformAdminGuard', () => {
  function guardWith(env: Record<string, string>) {
    const config = {
      get: (key: string) => env[key],
    } as ConfigService;
    return new PlatformAdminGuard(config);
  }

  function ctx(user?: { userId: string; email?: string; role?: string }) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as never;
  }

  it('44. allows PLATFORM_ADMIN email allowlist', () => {
    const g = guardWith({ PLATFORM_ADMIN_EMAILS: 'admin@fraterunion.com' });
    expect(
      g.canActivate(ctx({ userId: 'u1', email: 'admin@fraterunion.com', role: 'OWNER' })),
    ).toBe(true);
  });

  it('45. forbids normal ADMIN without allowlist', () => {
    const g = guardWith({ PLATFORM_ADMIN_EMAILS: 'other@x.com' });
    expect(() =>
      g.canActivate(ctx({ userId: 'u1', email: 'owner@tenant.com', role: 'ADMIN' })),
    ).toThrow(ForbiddenException);
  });

  it('46. forbids unauthenticated', () => {
    const g = guardWith({ PLATFORM_ADMIN_EMAILS: 'admin@fraterunion.com' });
    expect(() => g.canActivate(ctx(undefined))).toThrow(UnauthorizedException);
  });
});
