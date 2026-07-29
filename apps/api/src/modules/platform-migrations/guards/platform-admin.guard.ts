import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { CurrentUser } from '../../../common/types/current-user.type';

/**
 * Platform Admin access via env allowlist (emails and/or user IDs).
 * Tenant OWNER/ADMIN roles are NOT sufficient.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: CurrentUser }>();
    const user = request.user;
    if (!user?.userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const emails = this.parseList(this.config.get<string>('PLATFORM_ADMIN_EMAILS'));
    const userIds = this.parseList(this.config.get<string>('PLATFORM_ADMIN_USER_IDS'));
    const role = (user.role ?? '').toUpperCase();

    const emailOk = user.email ? emails.has(user.email.trim().toLowerCase()) : false;
    const idOk = userIds.has(user.userId.trim().toLowerCase());
    const roleOk = role === 'PLATFORM_ADMIN';

    if (!emailOk && !idOk && !roleOk) {
      throw new ForbiddenException('PLATFORM_ADMIN access required');
    }
    return true;
  }

  private parseList(raw: string | undefined): Set<string> {
    if (!raw) return new Set();
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
  }
}
