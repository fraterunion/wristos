import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TenantStatus, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { CurrentUser, JwtPayload } from '../../../common/types/current-user.type';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async validateUser(email: string, password: string): Promise<CurrentUser> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        tenantUsers: {
          include: {
            tenant: true,
            role: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const activeTenantMembership = user.tenantUsers.find(
      (membership) => membership.tenant.status === TenantStatus.ACTIVE,
    );
    if (!activeTenantMembership) {
      throw new UnauthorizedException('User has no active tenant membership');
    }

    return {
      userId: user.id,
      email: user.email,
      tenantId: activeTenantMembership.tenantId,
      role: activeTenantMembership.role?.name,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.email, dto.password);
    return this.issueTokens(user);
  }

  async refreshToken(dto: RefreshTokenDto) {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(dto.refreshToken, {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ??
          this.configService.get<string>('JWT_SECRET') ??
          'change-me',
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        tenantUsers: {
          where: { tenantId: payload.tenantId },
          include: { tenant: true, role: true },
          take: 1,
        },
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('User no longer active');
    }

    const membership = user.tenantUsers[0];
    if (!membership || membership.tenant.status !== TenantStatus.ACTIVE) {
      throw new UnauthorizedException('Tenant membership no longer active');
    }

    const currentUser: CurrentUser = {
      userId: user.id,
      email: user.email,
      tenantId: membership.tenantId,
      role: membership.role?.name,
    };

    return this.issueTokens(currentUser);
  }

  async logout() {
    // V1 no-op (no token revocation storage yet)
    return { success: true };
  }

  private async issueTokens(user: CurrentUser) {
    const payload: JwtPayload = {
      userId: user.userId,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    };

    const jwtSecret =
      this.configService.get<string>('JWT_SECRET') ?? 'change-me';
    const accessExpiresIn =
      this.configService.get<string>('JWT_EXPIRES_IN') ?? '15m';

    const refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ?? jwtSecret;
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: jwtSecret,
        expiresIn: accessExpiresIn as any,
      }),
      this.jwtService.signAsync(payload, {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn as any,
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      user,
    };
  }
}
