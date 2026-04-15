import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../../../../common/types/current-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') ?? 'change-me',
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload?.userId || !payload?.email || !payload?.tenantId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return {
      userId: payload.userId,
      email: payload.email,
      tenantId: payload.tenantId,
      role: payload.role,
    };
  }
}
