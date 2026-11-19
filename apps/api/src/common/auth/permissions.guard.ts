import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@fieldops/shared';
import { hasPermission } from '@fieldops/shared';
import type { AuthenticatedRequest } from './authenticated-request';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);
    if (isPublic || !required?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.membership || !hasPermission(request.membership.permissions, required)) {
      throw new ForbiddenException('You do not have access to this action');
    }

    return true;
  }
}
