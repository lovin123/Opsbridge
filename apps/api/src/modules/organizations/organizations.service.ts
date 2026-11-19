import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AcceptInvitationInput,
  CreateInvitationInput,
  CreateOrganizationInput,
  CreateOrgRoleInput,
  InvitationRecord,
  MemberRecord,
  MemberRole,
  OrganizationDetail,
  OrganizationRoleRecord,
  Permission,
  UpdateMemberRoleInput,
  UpdateOrganizationInput,
  UpdateOrgRoleInput,
  UserProfile,
} from '@fieldops/shared';
import {
  memberRoles,
  roleTemplateDefaults,
  sanitizePermissions,
} from '@fieldops/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import type { RequestMembership } from '../../common/auth/authenticated-request';
import { nextSlug, slugify } from '../../common/slug';
import { hashToken, newSecretToken } from '../../common/tokens';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  asPermissionList,
  ensureSystemOrgRoles,
  resolveOrgRole,
  slugifyRoleName,
} from './org-roles.util';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async create(user: UserProfile, input: CreateOrganizationInput) {
    const timezone = input.timezone?.trim() || 'Asia/Kolkata';
    this.assertTimezone(timezone);
    const base = slugify(input.name);
    const existing = await this.prisma.organization.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    const slug = nextSlug(base, new Set(existing.map((organization) => organization.slug)));

    try {
      return await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: input.name,
            slug,
            industry: blankToNull(input.industry),
            timezone,
          },
        });
        await ensureSystemOrgRoles(tx, organization.id);
        const adminRole = await tx.organizationRole.findFirstOrThrow({
          where: { organizationId: organization.id, slug: 'org-admin', system: true },
        });
        const membership = await tx.membership.create({
          data: {
            organizationId: organization.id,
            userId: user.id,
            role: 'ORG_ADMIN',
            orgRoleId: adminRole.id,
          },
        });
        await this.audit.record(
          {
            organizationId: organization.id,
            actorId: user.id,
            action: 'ORGANIZATION_CREATED',
            targetType: 'Organization',
            targetId: organization.id,
          },
          tx,
        );
        return {
          membershipId: membership.id,
          role: 'ORG_ADMIN' as const,
          orgRoleId: adminRole.id,
          orgRoleName: adminRole.name,
          dataScope: adminRole.dataScope,
          permissions: asPermissionList(adminRole.permissions),
          organization: {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            industry: organization.industry,
            timezone: organization.timezone,
          },
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Organization slug is already in use');
      }
      throw error;
    }
  }

  async current(membership: RequestMembership): Promise<OrganizationDetail> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: membership.organizationId },
    });
    const grouped = await this.prisma.membership.groupBy({
      by: ['role'],
      where: { organizationId: organization.id, active: true },
      _count: { _all: true },
    });
    const roleCounts = emptyRoleCounts();
    for (const row of grouped) {
      roleCounts[row.role] = row._count._all;
    }

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      industry: organization.industry,
      timezone: organization.timezone,
      createdAt: organization.createdAt.toISOString(),
      memberCount: Object.values(roleCounts).reduce((sum, count) => sum + count, 0),
      roleCounts,
      currentRole: membership.role,
      currentOrgRoleId: membership.orgRoleId,
      currentOrgRoleName: membership.orgRoleName,
      currentDataScope: membership.dataScope,
      currentPermissions: membership.permissions,
    };
  }

  async update(membership: RequestMembership, actorId: string, input: UpdateOrganizationInput) {
    const timezone = input.timezone?.trim() || 'Asia/Kolkata';
    this.assertTimezone(timezone);
    const organization = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.organization.update({
        where: { id: membership.organizationId },
        data: {
          name: input.name,
          industry: blankToNull(input.industry),
          timezone,
        },
      });
      await this.audit.record(
        {
          organizationId: updated.id,
          actorId,
          action: 'ORGANIZATION_UPDATED',
          targetType: 'Organization',
          targetId: updated.id,
        },
        tx,
      );
      return updated;
    });

    return this.current({
      ...membership,
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        industry: organization.industry,
        timezone: organization.timezone,
      },
    });
  }

  async listRoles(organizationId: string): Promise<OrganizationRoleRecord[]> {
    await this.prisma.$transaction(async (tx) => {
      await ensureSystemOrgRoles(tx, organizationId);
    });
    const rows = await this.prisma.organizationRole.findMany({
      where: { organizationId },
      include: { _count: { select: { memberships: true } } },
      orderBy: [{ system: 'desc' }, { name: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      baseRole: row.baseRole,
      dataScope: row.dataScope,
      permissions: asPermissionList(row.permissions),
      system: row.system,
      memberCount: row._count.memberships,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async createRole(membership: RequestMembership, input: CreateOrgRoleInput) {
    this.assertRolePermissions(input.permissions, input.dataScope);
    const slugBase = slugifyRoleName(input.name);
    return this.prisma.$transaction(async (tx) => {
      await ensureSystemOrgRoles(tx, membership.organizationId);
      const existing = await tx.organizationRole.findMany({
        where: { organizationId: membership.organizationId, slug: { startsWith: slugBase } },
        select: { slug: true },
      });
      const slug = nextSlug(slugBase, new Set(existing.map((item) => item.slug)));
      const created = await tx.organizationRole.create({
        data: {
          organizationId: membership.organizationId,
          name: input.name.trim(),
          slug,
          baseRole: input.baseRole,
          dataScope: input.dataScope,
          permissions: sanitizePermissions(input.permissions),
          system: false,
        },
      });
      return {
        id: created.id,
        name: created.name,
        slug: created.slug,
        baseRole: created.baseRole,
        dataScope: created.dataScope,
        permissions: asPermissionList(created.permissions),
        system: created.system,
        memberCount: 0,
        createdAt: created.createdAt.toISOString(),
      } satisfies OrganizationRoleRecord;
    });
  }

  async updateRoleDefinition(
    membership: RequestMembership,
    roleId: string,
    input: UpdateOrgRoleInput,
  ) {
    const role = await this.prisma.organizationRole.findFirst({
      where: { id: roleId, organizationId: membership.organizationId },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.system) {
      throw new ForbiddenException('System roles cannot be edited');
    }
    if (input.permissions) {
      this.assertRolePermissions(input.permissions, role.dataScope);
    }
    const updated = await this.prisma.organizationRole.update({
      where: { id: role.id },
      data: {
        name: input.name?.trim() || undefined,
        permissions: input.permissions ? sanitizePermissions(input.permissions) : undefined,
      },
      include: { _count: { select: { memberships: true } } },
    });
    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      baseRole: updated.baseRole,
      dataScope: updated.dataScope,
      permissions: asPermissionList(updated.permissions),
      system: updated.system,
      memberCount: updated._count.memberships,
      createdAt: updated.createdAt.toISOString(),
    } satisfies OrganizationRoleRecord;
  }

  async deleteRole(membership: RequestMembership, roleId: string) {
    const role = await this.prisma.organizationRole.findFirst({
      where: { id: roleId, organizationId: membership.organizationId },
      include: {
        _count: { select: { memberships: true, invitations: true } },
      },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.system) {
      throw new ForbiddenException('System roles cannot be deleted');
    }
    if (role._count.memberships > 0 || role._count.invitations > 0) {
      throw new ConflictException('Reassign members and invitations before deleting this role');
    }
    await this.prisma.organizationRole.delete({ where: { id: role.id } });
    return this.listRoles(membership.organizationId);
  }

  async members(organizationId: string): Promise<MemberRecord[]> {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId, active: true },
      include: { user: true, orgRole: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => ({
      membershipId: row.id,
      userId: row.userId,
      name: row.user.name,
      email: row.user.email,
      phone: row.user.phone,
      jobTitle: row.user.jobTitle,
      role: row.role,
      orgRoleId: row.orgRoleId,
      orgRoleName: row.orgRole.name,
      dataScope: row.orgRole.dataScope,
      permissions: asPermissionList(row.orgRole.permissions),
      joinedAt: row.createdAt.toISOString(),
    }));
  }

  async updateRole(
    membership: RequestMembership,
    actor: UserProfile,
    membershipId: string,
    input: UpdateMemberRoleInput,
  ) {
    if (!isUuid(membershipId)) {
      throw new BadRequestException('Membership id is invalid');
    }

    const target = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId: membership.organizationId, active: true },
      include: { orgRole: true },
    });
    if (!target) {
      throw new NotFoundException('Member not found');
    }

    const nextRole = await this.prisma.$transaction(async (tx) => {
      await ensureSystemOrgRoles(tx, membership.organizationId);
      const resolved = await resolveOrgRole(tx, membership.organizationId, input);
      if (!resolved) {
        throw new BadRequestException('Role not found');
      }
      return resolved;
    });

    if (target.orgRoleId === nextRole.id) {
      return this.members(membership.organizationId);
    }

    await this.prisma.$transaction(async (tx) => {
      if (
        target.orgRole.permissions.includes('org.members.manage') &&
        !nextRole.permissions.includes('org.members.manage')
      ) {
        const managers = await tx.membership.count({
          where: {
            organizationId: membership.organizationId,
            active: true,
            orgRole: { permissions: { has: 'org.members.manage' } },
          },
        });
        if (managers <= 1) {
          throw new ConflictException('The organization needs at least one member manager');
        }
      }

      await tx.membership.update({
        where: { id: target.id },
        data: { role: nextRole.baseRole, orgRoleId: nextRole.id },
      });
      await this.audit.record(
        {
          organizationId: membership.organizationId,
          actorId: actor.id,
          action: 'MEMBER_ROLE_CHANGED',
          targetType: 'Membership',
          targetId: target.id,
          metadata: {
            from: target.role,
            to: nextRole.baseRole,
            fromOrgRoleId: target.orgRoleId,
            toOrgRoleId: nextRole.id,
          },
        },
        tx,
      );
    });

    return this.members(membership.organizationId);
  }

  async invite(
    membership: RequestMembership,
    actor: UserProfile,
    input: CreateInvitationInput,
  ): Promise<InvitationRecord> {
    const email = input.email.toLowerCase();
    if (email === actor.email) {
      throw new ConflictException('You are already in this organization');
    }

    const existingMember = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          where: { organizationId: membership.organizationId, active: true },
        },
      },
    });
    if (existingMember && existingMember.memberships.length > 0) {
      throw new ConflictException('That person is already a member');
    }

    const pending = await this.prisma.invitation.findFirst({
      where: {
        organizationId: membership.organizationId,
        email,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
    });
    if (pending) {
      throw new ConflictException('An invitation is already pending for this email');
    }

    const orgRole = await this.prisma.$transaction(async (tx) => {
      await ensureSystemOrgRoles(tx, membership.organizationId);
      return resolveOrgRole(tx, membership.organizationId, input);
    });
    if (!orgRole) {
      throw new BadRequestException('Role not found');
    }

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: membership.organizationId },
      select: { name: true },
    });
    const secret = newSecretToken();
    const invitation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.invitation.create({
        data: {
          organizationId: membership.organizationId,
          email,
          role: orgRole.baseRole,
          orgRoleId: orgRole.id,
          tokenHash: secret.tokenHash,
          invitedById: actor.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
        include: { orgRole: true },
      });
      await this.audit.record(
        {
          organizationId: membership.organizationId,
          actorId: actor.id,
          action: 'INVITATION_CREATED',
          targetType: 'Invitation',
          targetId: created.id,
          metadata: { email, role: orgRole.baseRole, orgRoleId: orgRole.id },
        },
        tx,
      );
      return created;
    });

    const record = this.toInvitation(invitation, secret.token);
    if (record.acceptPath) {
      try {
        await this.mail.sendInvitation({
          to: email,
          organizationName: organization.name,
          role: orgRole.baseRole,
          invitedByName: actor.name,
          acceptUrl: record.acceptPath,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown error';
        this.logger.error(`Invitation email failed for ${email}: ${detail}`);
      }
    }
    return record;
  }

  async invitations(organizationId: string): Promise<InvitationRecord[]> {
    const rows = await this.prisma.invitation.findMany({
      where: { organizationId },
      include: { orgRole: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => this.toInvitation(row));
  }

  async revoke(membership: RequestMembership, actorId: string, invitationId: string) {
    if (!isUuid(invitationId)) {
      throw new BadRequestException('Invitation id is invalid');
    }
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, organizationId: membership.organizationId },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status !== 'PENDING') {
      throw new ConflictException('Only pending invitations can be revoked');
    }

    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.invitation.updateMany({
        where: { id: invitation.id, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      if (revoked.count !== 1) {
        throw new ConflictException('Only pending invitations can be revoked');
      }
      await this.audit.record(
        {
          organizationId: membership.organizationId,
          actorId,
          action: 'INVITATION_REVOKED',
          targetType: 'Invitation',
          targetId: invitation.id,
        },
        tx,
      );
    });

    return this.invitations(membership.organizationId);
  }

  async accept(user: UserProfile, input: AcceptInvitationInput) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(input.token) },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status === 'REVOKED') {
      throw new ConflictException('Invitation was revoked');
    }
    if (invitation.status === 'ACCEPTED') {
      throw new ConflictException('Invitation was already accepted');
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      throw new ConflictException('Invitation has expired');
    }
    if (invitation.email !== user.email) {
      throw new ForbiddenException('This invitation was sent to a different email address');
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Invitation is no longer pending');
      }
      const existing = await tx.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId: user.id,
          },
        },
      });
      if (!existing) {
        await tx.membership.create({
          data: {
            organizationId: invitation.organizationId,
            userId: user.id,
            role: invitation.role,
            orgRoleId: invitation.orgRoleId,
          },
        });
      } else if (!existing.active) {
        await tx.membership.update({
          where: { id: existing.id },
          data: {
            active: true,
            role: invitation.role,
            orgRoleId: invitation.orgRoleId,
          },
        });
      }
      await this.audit.record(
        {
          organizationId: invitation.organizationId,
          actorId: user.id,
          action: 'INVITATION_ACCEPTED',
          targetType: 'Invitation',
          targetId: invitation.id,
        },
        tx,
      );
    });

    return { organizationId: invitation.organizationId };
  }

  private assertRolePermissions(permissions: Permission[], dataScope: string) {
    const cleaned = sanitizePermissions(permissions);
    if (cleaned.length === 0) {
      throw new BadRequestException('Select at least one permission');
    }
    if (
      dataScope !== 'ORG' &&
      (cleaned.includes('org.roles.manage') || cleaned.includes('org.members.manage'))
    ) {
      throw new BadRequestException(
        'Member and role management require organization-wide data scope',
      );
    }
  }

  private toInvitation(
    invitation: {
      id: string;
      email: string;
      role: MemberRole;
      orgRoleId: string;
      orgRole?: { name: string };
      status: InvitationRecord['status'];
      expiresAt: Date;
      createdAt: Date;
    },
    rawToken?: string,
  ): InvitationRecord {
    const expired = invitation.status === 'PENDING' && invitation.expiresAt.getTime() <= Date.now();
    const record: InvitationRecord = {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      orgRoleId: invitation.orgRoleId,
      orgRoleName: invitation.orgRole?.name ?? roleTemplateDefaults[invitation.role].name,
      status: expired ? 'EXPIRED' : invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
    if (rawToken) {
      const origin = this.config.getOrThrow<string>('WEB_ORIGIN');
      record.acceptPath = `${origin}/invite/accept?token=${rawToken}`;
    }
    return record;
  }

  private assertTimezone(timezone: string): void {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new BadRequestException('Unknown timezone');
    }
  }
}

function emptyRoleCounts(): Record<MemberRole, number> {
  return memberRoles.reduce(
    (counts, role) => {
      counts[role] = 0;
      return counts;
    },
    {} as Record<MemberRole, number>,
  );
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
