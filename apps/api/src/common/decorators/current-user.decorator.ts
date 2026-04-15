import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CurrentUser as CurrentUserType } from '../types/current-user.type';

export const CurrentUserDecorator = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserType => {
    const request = ctx.switchToHttp().getRequest<{ user: CurrentUserType }>();
    return request.user;
  },
);

export const CurrentUser = CurrentUserDecorator;
