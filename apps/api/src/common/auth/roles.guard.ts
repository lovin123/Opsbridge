import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MemberRole, Permission } from '@fieldops/shared';
import type { AuthenticatedRequest } from './authenticated-request';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    const roles = this.reflector.getAllAndOverride<MemberRole[]>(ROLES_KEY, targets);
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      targets,
    );
    // Explicit permission checks win; skip legacy role list when present.
    if (isPublic || requiredPermissions?.length || !roles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.membership || !roles.includes(request.membership.role)) {
      throw new ForbiddenException('You do not have access to this action');
    }

    return true;
  }
}
