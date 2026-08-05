import * as fs from 'fs';
import * as path from 'path';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { CryptoController } from './crypto.controller';
import { CryptoService } from './crypto.service';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';

/**
 * Auth contract: Crypto uses the same JwtAuthGuard + tenant-scoped CurrentUser
 * pattern as Capital/Inventory. Frontend must send { authenticated: true }.
 */
describe('Crypto authorization contract', () => {
  it('admin crypto-api sends authenticated:true on every call (same as Capital)', () => {
    const cryptoApiPath = path.resolve(
      __dirname,
      '../../../../admin/src/lib/crypto-api.ts',
    );
    const capitalApiPath = path.resolve(
      __dirname,
      '../../../../admin/src/lib/capital-api.ts',
    );
    const cryptoSrc = fs.readFileSync(cryptoApiPath, 'utf8');
    const capitalSrc = fs.readFileSync(capitalApiPath, 'utf8');

    expect(capitalSrc).toContain('const AUTH = { authenticated: true }');
    expect(cryptoSrc).toContain('const AUTH = { authenticated: true }');

    const callSites = [
      "apiGet<CryptoSummary>('/crypto/summary', AUTH)",
      "apiGet<CryptoHolding[]>('/crypto/holdings', AUTH)",
      "apiPost<CryptoHolding>('/crypto/holdings', body, AUTH)",
      'apiPatch<CryptoHolding>(`/crypto/holdings/${id}`, body, AUTH)',
      'apiDelete<void>(`/crypto/holdings/${id}`, AUTH)',
      "apiGet<CryptoLatestPrice[]>('/crypto/prices', AUTH)",
      'apiPost<CryptoPriceSnapshot>(\'/crypto/prices\', body, AUTH)',
    ];
    for (const site of callSites) {
      expect(cryptoSrc).toContain(site);
    }
    expect(cryptoSrc).toContain('...AUTH, query: { limit }');

    // Regression: must not call api helpers without AUTH
    expect(cryptoSrc).not.toMatch(/apiGet<CryptoSummary>\('\/crypto\/summary'\)\s*;/);
    expect(cryptoSrc).not.toMatch(/apiGet<CryptoHolding\[\]>\('\/crypto\/holdings'\)\s*;/);
  });

  it('CryptoController is protected by JwtAuthGuard only (no platform-admin role)', async () => {
    const guards = Reflect.getMetadata('__guards__', CryptoController) as Array<
      new (...args: unknown[]) => unknown
    >;
    expect(guards?.map((g) => g.name)).toEqual(['JwtAuthGuard']);
  });

  it('authenticated tenant user can read summary; unauthenticated is rejected by guard', async () => {
    const cryptoService = {
      getSummary: jest.fn(async (tenantId: string) => ({
        totalCurrentValueMxn: '0.00',
        totalCostBasisMxn: '0.00',
        unrealizedPnlMxn: '0.00',
        unrealizedPnlPercent: null,
        activeHoldingCount: 0,
        pricedHoldingCount: 0,
        unpricedHoldingCount: 0,
        missingPriceTickers: [],
        oldestPriceCapturedAt: null,
        newestPriceCapturedAt: null,
        cryptoPriceStatus: 'MISSING',
        tenantEcho: tenantId,
      })),
      createHolding: jest.fn(async (tenantId: string) => ({ id: 'h1', tenantId })),
      listHoldings: jest.fn(async () => []),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [CryptoController],
      providers: [
        { provide: CryptoService, useValue: cryptoService },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          if (!req.headers?.authorization) return false;
          req.user = {
            userId: 'u1',
            email: 'cesar.trejo@wristcaviar.com',
            tenantId: 'tenant-wc',
          };
          return true;
        },
      })
      .compile();

    const controller = moduleRef.get(CryptoController);
    const summary = await controller.summary({
      userId: 'u1',
      email: 'cesar.trejo@wristcaviar.com',
      tenantId: 'tenant-wc',
    });
    expect(cryptoService.getSummary).toHaveBeenCalledWith('tenant-wc');
    expect(summary).toMatchObject({ activeHoldingCount: 0 });

    await controller.createHolding(
      { userId: 'u1', email: 'cesar.trejo@wristcaviar.com', tenantId: 'tenant-wc' },
      {
        ticker: 'USDT',
        name: 'Tether',
        quantity: 1,
        location: 'Cuenta Crypto César',
      },
    );
    expect(cryptoService.createHolding).toHaveBeenCalledWith(
      'tenant-wc',
      expect.objectContaining({ ticker: 'USDT' }),
    );
  });

  it('service methods always scope by caller tenantId (cross-tenant blocked at service boundary)', async () => {
    const findMany = jest.fn(async ({ where }: { where: { tenantId: string } }) => {
      expect(where.tenantId).toBe('tenant-a');
      return [];
    });
    const service = new CryptoService({
      assetHolding: { findMany },
      assetPriceSnapshot: { findMany: jest.fn(async () => []) },
    } as never);

    await service.getSummary('tenant-a');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a' }),
      }),
    );
  });
});
