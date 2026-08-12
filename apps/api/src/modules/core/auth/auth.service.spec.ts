import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TenantStatus, UserStatus } from '@prisma/client';

import { AuthService } from './auth.service';

describe('AuthService tenant switching', () => {
  const prisma = {
    tenantUser: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const jwtService = {
    signAsync: jest.fn(async (payload: unknown) => JSON.stringify(payload)),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret';
      if (key === 'JWT_EXPIRES_IN') return '15m';
      if (key === 'JWT_REFRESH_SECRET') return 'test-refresh';
      if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
      return undefined;
    }),
  };

  const service = new AuthService(
    prisma as never,
    jwtService as unknown as JwtService,
    configService as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jwtService.signAsync.mockImplementation(async (payload: unknown) => JSON.stringify(payload));
  });

  it('allows switch when the caller has an active membership on A', async () => {
    prisma.tenantUser.findUnique.mockResolvedValue({
      tenantId: 'tenant-a',
      userId: 'user-1',
      tenant: { status: TenantStatus.ACTIVE, isDemo: false },
      role: { name: 'OWNER' },
      user: { id: 'user-1', email: 'owner@example.com', status: UserStatus.ACTIVE },
    });

    const result = await service.switchTenant('user-1', 'tenant-a');
    expect(result.user.tenantId).toBe('tenant-a');
    expect(result.user.isDemo).toBe(false);
    expect(prisma.tenantUser.findUnique).toHaveBeenCalledWith({
      where: { tenantId_userId: { tenantId: 'tenant-a', userId: 'user-1' } },
      include: { tenant: true, role: true, user: true },
    });
  });

  it('rejects switch to B when the caller has no membership on B', async () => {
    prisma.tenantUser.findUnique.mockResolvedValue(null);
    await expect(service.switchTenant('user-1', 'tenant-b')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not grant access for an arbitrary tenant id', async () => {
    prisma.tenantUser.findUnique.mockResolvedValue(null);
    await expect(service.switchTenant('user-1', 'cm-not-a-real-tenant')).rejects.toThrow(
      'No active membership for the requested tenant',
    );
  });

  it('listMyTenants returns only the caller’s active memberships', async () => {
    prisma.tenantUser.findMany.mockResolvedValue([
      {
        tenant: { id: 'tenant-a', name: 'Alpha', slug: 'alpha', isDemo: false },
      },
      {
        tenant: { id: 'tenant-demo', name: 'Demo', slug: 'wristos-demo', isDemo: true },
      },
    ]);

    const tenants = await service.listMyTenants('user-1');
    expect(tenants).toEqual([
      { tenantId: 'tenant-a', name: 'Alpha', slug: 'alpha', isDemo: false },
      { tenantId: 'tenant-demo', name: 'Demo', slug: 'wristos-demo', isDemo: true },
    ]);
    expect(prisma.tenantUser.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', tenant: { status: TenantStatus.ACTIVE } },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('derives isDemo from the database tenant row, not the request', async () => {
    prisma.tenantUser.findUnique.mockResolvedValue({
      tenantId: 'tenant-demo',
      userId: 'user-1',
      tenant: { status: TenantStatus.ACTIVE, isDemo: true },
      role: { name: 'OWNER' },
      user: { id: 'user-1', email: 'owner@example.com', status: UserStatus.ACTIVE },
    });

    const result = await service.switchTenant('user-1', 'tenant-demo');
    const accessPayload = JSON.parse(result.accessToken as string);
    expect(result.user.isDemo).toBe(true);
    expect(accessPayload.isDemo).toBe(true);
    expect(accessPayload.tenantId).toBe('tenant-demo');
  });
});
