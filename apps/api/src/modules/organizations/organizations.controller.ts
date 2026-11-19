import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  createInvitationSchema,
  createOrganizationSchema,
  createOrgRoleSchema,
  updateMemberRoleSchema,
  updateOrganizationSchema,
  updateOrgRoleSchema,
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type CreateOrgRoleInput,
  type UpdateMemberRoleInput,
  type UpdateOrganizationInput,
  type UpdateOrgRoleInput,
  type UserProfile,
} from '@fieldops/shared';
import type { RequestMembership } from '../../common/auth/authenticated-request';
import { CurrentMembership, CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { RequireOrg } from '../../common/auth/require-org.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@ApiCookieAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  create(
    @CurrentUser() user: UserProfile,
    @Body(new ZodValidationPipe(createOrganizationSchema)) body: CreateOrganizationInput,
  ) {
    return this.organizations.create(user, body);
  }

  @RequireOrg()
  @Get('current')
  @ApiHeader({ name: 'X-Opsbridge-Organization', required: false })
  current(@CurrentMembership() membership: RequestMembership) {
    return this.organizations.current(membership);
  }

  @RequireOrg()
  @RequirePermissions('org.settings.manage')
  @Patch('current')
  update(
    @CurrentMembership() membership: RequestMembership,
    @CurrentUser() user: UserProfile,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) body: UpdateOrganizationInput,
  ) {
    return this.organizations.update(membership, user.id, body);
  }

  @RequireOrg()
  @Get('current/roles')
  listRoles(@CurrentMembership() membership: RequestMembership) {
    return this.organizations.listRoles(membership.organizationId);
  }

  @RequireOrg()
  @RequirePermissions('org.roles.manage')
  @Post('current/roles')
  createRole(
    @CurrentMembership() membership: RequestMembership,
    @Body(new ZodValidationPipe(createOrgRoleSchema)) body: CreateOrgRoleInput,
  ) {
    return this.organizations.createRole(membership, body);
  }

  @RequireOrg()
  @RequirePermissions('org.roles.manage')
  @Patch('current/roles/:roleId')
  updateRoleDefinition(
    @CurrentMembership() membership: RequestMembership,
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(updateOrgRoleSchema)) body: UpdateOrgRoleInput,
  ) {
    return this.organizations.updateRoleDefinition(membership, roleId, body);
  }

  @RequireOrg()
  @RequirePermissions('org.roles.manage')
  @Delete('current/roles/:roleId')
  deleteRole(
    @CurrentMembership() membership: RequestMembership,
    @Param('roleId') roleId: string,
  ) {
    return this.organizations.deleteRole(membership, roleId);
  }

  @RequireOrg()
  @Get('current/members')
  members(@CurrentMembership() membership: RequestMembership) {
    return this.organizations.members(membership.organizationId);
  }

  @RequireOrg()
  @RequirePermissions('org.members.manage')
  @Patch('current/members/:membershipId')
  updateRole(
    @CurrentMembership() membership: RequestMembership,
    @CurrentUser() user: UserProfile,
    @Param('membershipId') membershipId: string,
    @Body(new ZodValidationPipe(updateMemberRoleSchema)) body: UpdateMemberRoleInput,
  ) {
    return this.organizations.updateRole(membership, user, membershipId, body);
  }

  @RequireOrg()
  @RequirePermissions('org.members.manage')
  @Get('current/invitations')
  invitations(@CurrentMembership() membership: RequestMembership) {
    return this.organizations.invitations(membership.organizationId);
  }

  @RequireOrg()
  @RequirePermissions('org.members.manage')
  @Post('current/invitations')
  invite(
    @CurrentMembership() membership: RequestMembership,
    @CurrentUser() user: UserProfile,
    @Body(new ZodValidationPipe(createInvitationSchema)) body: CreateInvitationInput,
  ) {
    return this.organizations.invite(membership, user, body);
  }

  @RequireOrg()
  @RequirePermissions('org.members.manage')
  @Post('current/invitations/:invitationId/revoke')
  revoke(
    @CurrentMembership() membership: RequestMembership,
    @CurrentUser() user: UserProfile,
    @Param('invitationId') invitationId: string,
  ) {
    return this.organizations.revoke(membership, user.id, invitationId);
  }
}
