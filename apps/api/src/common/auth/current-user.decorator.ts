import { createParamDecorator, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request';

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.user) {
    throw new UnauthorizedException('Authentication required');
  }
  return request.user;
});

export const CurrentMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.membership) {
      throw new UnauthorizedException('Organization context is required');
    }
    return request.membership;
  },
);
