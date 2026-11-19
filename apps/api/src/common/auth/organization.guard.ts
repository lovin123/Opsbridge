import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from './authenticated-request';
import { IS_PUBLIC_KEY } from './public.decorator';
import { REQUIRE_ORG_KEY } from './require-org.decorator';

@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    const requireOrg = this.reflector.getAllAndOverride<boolean>(REQUIRE_ORG_KEY, targets);
    if (isPublic || !requireOrg) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new ForbiddenException('Organization context is required');
    }

    const memberships = await this.prisma.membership.findMany({
      where: { userId: request.user.id, active: true },
      include: { organization: true, orgRole: true },
    });

    const requested =
      request.header('x-opsbridge-organization') ?? request.header('x-fieldops-organization');
    const membership = requested
      ? memberships.find((item) => item.organizationId === requested)
      : memberships.length === 1
        ? memberships[0]
        : undefined;

    if (requested && !membership) {
      throw new ForbiddenException('You are not a member of this organization');
    }

    if (!membership && memberships.length === 0) {
      throw new ForbiddenException('Create or join an organization first');
    }

    if (!membership) {
      throw new BadRequestException('Select an organization');
    }

    request.membership = {
      id: membership.id,
      role: membership.role,
      orgRoleId: membership.orgRoleId,
      orgRoleName: membership.orgRole.name,
      dataScope: membership.orgRole.dataScope,
      permissions: membership.orgRole.permissions as import('@fieldops/shared').Permission[],
      organizationId: membership.organizationId,
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        industry: membership.organization.industry,
        timezone: membership.organization.timezone,
      },
    };
    return true;
  }
}
