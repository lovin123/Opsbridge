import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { incidentChannelId, type DataScope, type MemberRole } from '@fieldops/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { NexconnApiClient } from './nexconn-api.client';

@Injectable()
export class NexconnService {
  private readonly logger = new Logger(NexconnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: NexconnApiClient,
    private readonly queue: QueueService,
    private readonly config: ConfigService,
  ) {}

  async tokenForUser(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const areaCode = this.config.get<string>('NEXCONN_AREA_CODE') || 'SG';
    const appKey = this.config.get<string>('NEXCONN_APP_KEY') || '';
    if (!this.api.configured()) {
      return { token: '', userId: user.nexconnUserId, areaCode, appKey: '' };
    }
    const token = await this.api.issueToken(user.nexconnUserId, user.name);
    return {
      token,
      userId: user.nexconnUserId,
      areaCode,
      appKey,
    };
  }

  async provisionIncidentChannel(incidentId: string) {
    const incident = await this.prisma.incident.findUniqueOrThrow({
      where: { id: incidentId },
      include: {
        createdBy: true,
        assignee: true,
        team: { include: { members: { include: { user: true } } } },
      },
    });
    const year = incident.createdAt.getUTCFullYear();
    const channelId = incidentChannelId(year, incident.sequence);
    const participants = new Map<string, { id: string; nexconnUserId: string; name: string }>();
    const add = (user: { id: string; nexconnUserId: string; name: string } | null) => {
      if (user) {
        participants.set(user.nexconnUserId, user);
      }
    };
    add(incident.createdBy);
    add(incident.assignee);
    for (const member of incident.team?.members ?? []) {
      add(member.user);
    }

    const mapping = await this.prisma.channelMapping.upsert({
      where: { channelId },
      update: { name: incident.title.slice(0, 64) },
      create: {
        organizationId: incident.organizationId,
        kind: 'INCIDENT',
        channelId,
        name: incident.title.slice(0, 64),
        incidentId: incident.id,
      },
    });

    if (!this.api.configured()) {
      await this.mark(incident.id, mapping.id, 'PENDING', 'Nexconn is not configured');
      return mapping;
    }

    try {
      const people = [...participants.values()];
      for (const person of people) {
        await this.api.issueToken(person.nexconnUserId, person.name);
      }
      const owner = incident.createdBy.nexconnUserId;
      const others = people.map((person) => person.nexconnUserId).filter((id) => id !== owner);
      const created = await this.api.createGroup({
        channelId,
        name: incident.title.slice(0, 64),
        owner,
        userIds: others.slice(0, 30),
      });
      if (created.code === 0 && others.length > 30) {
        const overflow = await this.api.joinGroup(channelId, others.slice(30));
        if (overflow.code !== 0 && !/exist|already|duplicate|member/i.test(overflow.msg || '')) {
          await this.mark(
            incident.id,
            mapping.id,
            'FAILED',
            overflow.msg || 'Could not add remaining channel members',
          );
          return mapping;
        }
      }
      if (created.code !== 0) {
        const joined = await this.api.joinGroup(
          channelId,
          people.map((person) => person.nexconnUserId),
        );
        const alreadyExists = /exist|already|duplicate/i.test(created.msg || '');
        const joinOk =
          joined.code === 0 || /exist|already|duplicate|member/i.test(joined.msg || '');
        if (!joinOk && !alreadyExists) {
          await this.mark(
            incident.id,
            mapping.id,
            'FAILED',
            joined.msg || created.msg || 'Group provisioning failed',
          );
          return mapping;
        }
        if (alreadyExists && !joinOk) {
          await this.mark(
            incident.id,
            mapping.id,
            'FAILED',
            joined.msg || 'Channel exists but membership sync failed',
          );
          return mapping;
        }
      }
      await this.mark(incident.id, mapping.id, 'READY', null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Group provisioning failed';
      this.logger.warn(message);
      await this.mark(incident.id, mapping.id, 'FAILED', message);
    }
    return this.prisma.channelMapping.findUniqueOrThrow({ where: { id: mapping.id } });
  }

  async syncMembership(incidentId: string) {
    const mapping = await this.prisma.channelMapping.findUnique({ where: { incidentId } });
    if (!mapping || mapping.setupStatus !== 'READY' || !this.api.configured()) {
      await this.provisionIncidentChannel(incidentId);
      return;
    }
    const incident = await this.prisma.incident.findUniqueOrThrow({
      where: { id: incidentId },
      include: {
        createdBy: true,
        assignee: true,
        team: { include: { members: { include: { user: true } } } },
      },
    });
    const userIds = new Set<string>();
    const add = (user: { nexconnUserId: string } | null) => {
      if (user) {
        userIds.add(user.nexconnUserId);
      }
    };
    add(incident.createdBy);
    add(incident.assignee);
    for (const member of incident.team?.members ?? []) {
      add(member.user);
    }
    if (userIds.size === 0) {
      return;
    }
    try {
      const joined = await this.api.joinGroup(mapping.channelId, [...userIds]);
      if (joined.code !== 0) {
        this.logger.warn(joined.msg || 'Nexconn membership sync failed');
      }
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : 'Nexconn membership sync failed');
    }
  }

  async people(organizationId: string, userId: string, role: MemberRole, dataScope?: DataScope) {
    const scope = dataScope ?? scopeFromRole(role);
    const members = await this.prisma.membership.findMany({
      where: { organizationId, active: true },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            nexconnUserId: true,
            presence: { select: { status: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const mapped = members.map((member) => ({
      userId: member.user.id,
      name: member.user.name,
      nexconnUserId: member.user.nexconnUserId,
      role: member.role,
      presence: member.user.presence?.status ?? 'offline',
    }));

    if (scope === 'ORG') {
      return mapped;
    }

    const allowedUserIds = await this.visiblePeopleIds(organizationId, userId, role, scope);
    return mapped.filter((person) => allowedUserIds.has(person.userId));
  }

  async groupMembers(
    organizationId: string,
    groupId: string,
    userId: string,
    role: MemberRole,
    dataScope?: DataScope,
  ) {
    const mapping = await this.prisma.channelMapping.findFirst({
      where: { organizationId, channelId: groupId },
      include: {
        incident: {
          include: {
            createdBy: true,
            assignee: true,
            team: { include: { members: { include: { user: true } } } },
          },
        },
        team: { include: { members: { include: { user: true } } } },
        site: {
          include: {
            profiles: { include: { user: true } },
          },
        },
        shift: {
          include: {
            supervisor: true,
            assignments: { include: { user: true } },
          },
        },
      },
    });
    if (!mapping) {
      return [];
    }
    const allowed = await this.canAccessChannel(
      organizationId,
      userId,
      role,
      mapping.id,
      dataScope,
    );
    if (!allowed) {
      throw new ForbiddenException('You cannot access this channel');
    }
    const people = new Map<string, { userId: string; name: string; role?: string }>();
    const add = (user: { nexconnUserId: string; name: string } | null | undefined, role?: string) => {
      if (!user) {
        return;
      }
      // Chat UI ServiceHooks expect Nexconn user ids in `userId`.
      people.set(user.nexconnUserId, { userId: user.nexconnUserId, name: user.name, role });
    };
    if (mapping.incident) {
      add(mapping.incident.createdBy, 'creator');
      add(mapping.incident.assignee, 'assignee');
      for (const member of mapping.incident.team?.members ?? []) {
        add(member.user, 'member');
      }
    }
    if (mapping.team) {
      for (const member of mapping.team.members) {
        add(member.user, 'member');
      }
    }
    if (mapping.site) {
      for (const profile of mapping.site.profiles) {
        add(profile.user, 'member');
      }
      // Site channels are org-scoped for managers; include active members when no profiles yet.
      if (people.size === 0) {
        const members = await this.prisma.membership.findMany({
          where: { organizationId, active: true },
          include: { user: true },
          take: 100,
        });
        for (const member of members) {
          add(member.user, member.role.toLowerCase());
        }
      }
    }
    if (mapping.shift) {
      add(mapping.shift.supervisor, 'supervisor');
      for (const assignment of mapping.shift.assignments) {
        add(assignment.user, 'member');
      }
    }
    return [...people.values()];
  }

  async profiles(organizationId: string, input: { userIds?: string[]; groupIds?: string[] }) {
    const userIds = [...new Set(input.userIds ?? [])].slice(0, 100);
    const groupIds = [...new Set(input.groupIds ?? [])].slice(0, 100);
    const users =
      userIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: {
              nexconnUserId: { in: userIds },
              memberships: { some: { organizationId, active: true } },
            },
          });
    const groups =
      groupIds.length === 0
        ? []
        : await this.prisma.channelMapping.findMany({
            where: { organizationId, channelId: { in: groupIds } },
            include: {
              incident: {
                include: {
                  createdBy: { select: { nexconnUserId: true } },
                  assignee: { select: { nexconnUserId: true } },
                  team: { include: { members: { include: { user: { select: { nexconnUserId: true } } } } } },
                },
              },
              team: { include: { members: { include: { user: { select: { nexconnUserId: true } } } } } },
              site: {
                include: {
                  profiles: { include: { user: { select: { nexconnUserId: true } } } },
                },
              },
              shift: {
                include: {
                  supervisor: { select: { nexconnUserId: true } },
                  assignments: { include: { user: { select: { nexconnUserId: true } } } },
                },
              },
            },
          });
    const emptySiteIds = groups
      .filter((group) => group.siteId && this.countChannelMembers(group) === 0)
      .map((group) => group.channelId);
    const orgMemberCount =
      emptySiteIds.length === 0
        ? 0
        : await this.prisma.membership.count({ where: { organizationId, active: true } });

    return {
      users: users.map((user) => ({
        userId: user.nexconnUserId,
        name: user.name,
        avatarUrl: '',
      })),
      groups: groups.map((group) => {
        const counted = this.countChannelMembers(group);
        return {
          groupId: group.channelId,
          name: group.name,
          memberCount:
            counted === 0 && group.siteId ? orgMemberCount : counted,
          avatarUrl: '',
        };
      }),
    };
  }

  private countChannelMembers(mapping: {
    incident?: {
      createdBy?: { nexconnUserId: string } | null;
      assignee?: { nexconnUserId: string } | null;
      team?: { members: Array<{ user: { nexconnUserId: string } }> } | null;
    } | null;
    team?: { members: Array<{ user: { nexconnUserId: string } }> } | null;
    site?: { profiles: Array<{ user: { nexconnUserId: string } }> } | null;
    shift?: {
      supervisor?: { nexconnUserId: string } | null;
      assignments: Array<{ user: { nexconnUserId: string } }>;
    } | null;
  }) {
    const ids = new Set<string>();
    const add = (nexconnUserId?: string | null) => {
      if (nexconnUserId) ids.add(nexconnUserId);
    };
    if (mapping.incident) {
      add(mapping.incident.createdBy?.nexconnUserId);
      add(mapping.incident.assignee?.nexconnUserId);
      for (const member of mapping.incident.team?.members ?? []) add(member.user.nexconnUserId);
    }
    if (mapping.team) {
      for (const member of mapping.team.members) add(member.user.nexconnUserId);
    }
    if (mapping.site) {
      for (const profile of mapping.site.profiles) add(profile.user.nexconnUserId);
    }
    if (mapping.shift) {
      add(mapping.shift.supervisor?.nexconnUserId);
      for (const assignment of mapping.shift.assignments) add(assignment.user.nexconnUserId);
    }
    // Prefer a real count; site channels with no profiles still show 0 until fallback in groupMembers.
    return ids.size;
  }

  async channels(organizationId: string, userId: string, role: MemberRole, dataScope?: DataScope) {
    const where = await this.visibleChannelWhere(organizationId, userId, role, dataScope);
    return this.prisma.channelMapping.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  private async visibleChannelWhere(
    organizationId: string,
    userId: string,
    role: MemberRole,
    dataScope?: DataScope,
  ) {
    const scope = dataScope ?? scopeFromRole(role);
    if (scope === 'ORG') {
      return { organizationId };
    }

    const profile = await this.prisma.workforceProfile.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });

    const [teamMemberships, shiftLinks, incidents] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: { userId, team: { organizationId } },
        select: { teamId: true },
      }),
      this.prisma.shift.findMany({
        where: {
          organizationId,
          OR: [{ supervisorId: userId }, { assignments: { some: { userId } } }],
        },
        select: { id: true, siteId: true },
      }),
      this.prisma.incident.findMany({
        where:
          scope === 'SITE' && profile?.siteId
            ? { organizationId, siteId: profile.siteId }
            : {
                organizationId,
                OR: [
                  { assigneeId: userId },
                  { createdById: userId },
                  { team: { members: { some: { userId } } } },
                ],
              },
        select: { id: true, siteId: true },
      }),
    ]);

    const teamIds = teamMemberships.map((item) => item.teamId);
    const shiftIds = shiftLinks.map((item) => item.id);
    const incidentIds = incidents.map((item) => item.id);
    const siteIds = new Set<string>();
    if (scope === 'SITE' && profile?.siteId) {
      siteIds.add(profile.siteId);
    }
    for (const shift of shiftLinks) {
      siteIds.add(shift.siteId);
    }
    for (const incident of incidents) {
      siteIds.add(incident.siteId);
    }

    const orFilters = [
      ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
      ...(shiftIds.length > 0 ? [{ shiftId: { in: shiftIds } }] : []),
      ...(incidentIds.length > 0 ? [{ incidentId: { in: incidentIds } }] : []),
      ...(siteIds.size > 0 && scope === 'SITE' ? [{ siteId: { in: [...siteIds] } }] : []),
    ];

    if (orFilters.length === 0) {
      return { organizationId, id: { in: [] as string[] } };
    }

    return { organizationId, OR: orFilters };
  }

  private async canAccessChannel(
    organizationId: string,
    userId: string,
    role: MemberRole,
    channelMappingId: string,
    dataScope?: DataScope,
  ) {
    const where = await this.visibleChannelWhere(organizationId, userId, role, dataScope);
    const match = await this.prisma.channelMapping.findFirst({
      where: { ...where, id: channelMappingId },
      select: { id: true },
    });
    return Boolean(match);
  }

  private async visiblePeopleIds(
    organizationId: string,
    userId: string,
    role: MemberRole,
    dataScope?: DataScope,
  ) {
    const scope = dataScope ?? scopeFromRole(role);
    const ids = new Set<string>([userId]);

    const [teamMembers, shiftPeople, incidentPeople, sitePeers] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: {
          team: {
            organizationId,
            members: { some: { userId } },
          },
        },
        select: { userId: true },
      }),
      this.prisma.shift.findMany({
        where: {
          organizationId,
          OR: [{ supervisorId: userId }, { assignments: { some: { userId } } }],
        },
        select: {
          supervisorId: true,
          assignments: { select: { userId: true } },
        },
      }),
      this.prisma.incident.findMany({
        where:
          scope === 'SITE'
            ? await this.supervisorIncidentWhere(organizationId, userId)
            : {
                organizationId,
                OR: [
                  { assigneeId: userId },
                  { createdById: userId },
                  { team: { members: { some: { userId } } } },
                ],
              },
        select: {
          assigneeId: true,
          createdById: true,
          team: { select: { members: { select: { userId: true } } } },
        },
      }),
      scope === 'SITE'
        ? this.peersAtSupervisorSite(organizationId, userId)
        : Promise.resolve([] as string[]),
    ]);

    for (const member of teamMembers) ids.add(member.userId);
    for (const shift of shiftPeople) {
      if (shift.supervisorId) ids.add(shift.supervisorId);
      for (const assignment of shift.assignments) ids.add(assignment.userId);
    }
    for (const incident of incidentPeople) {
      if (incident.assigneeId) ids.add(incident.assigneeId);
      ids.add(incident.createdById);
      for (const member of incident.team?.members ?? []) ids.add(member.userId);
    }
    for (const peerId of sitePeers) ids.add(peerId);
    return ids;
  }

  private async supervisorIncidentWhere(organizationId: string, userId: string) {
    const profile = await this.prisma.workforceProfile.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (profile?.siteId) {
      return { organizationId, siteId: profile.siteId };
    }
    return {
      organizationId,
      OR: [{ assigneeId: userId }, { createdById: userId }, { team: { members: { some: { userId } } } }],
    };
  }

  private async peersAtSupervisorSite(organizationId: string, userId: string) {
    const profile = await this.prisma.workforceProfile.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!profile?.siteId) {
      return [];
    }
    const peers = await this.prisma.workforceProfile.findMany({
      where: { organizationId, siteId: profile.siteId },
      select: { userId: true },
    });
    return peers.map((peer) => peer.userId);
  }

  async handleWebhook(event: { type: string; id: string; data: Array<Record<string, unknown>> }) {
    try {
      await this.prisma.webhookReceipt.create({ data: { id: event.id, type: event.type } });
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : '';
      if (code === 'P2002') {
        return;
      }
      throw error;
    }
    try {
      await this.queue.enqueueOrThrow('nexconn-event', {
        eventId: event.id,
        type: event.type,
        data: JSON.stringify(event.data),
      });
    } catch (error) {
      await this.prisma.webhookReceipt.delete({ where: { id: event.id } }).catch(() => undefined);
      throw error;
    }
  }

  async processEvent(type: string, raw: string) {
    const data = JSON.parse(raw) as Array<Record<string, unknown>>;
    const item = data[0];
    if (!item) {
      return;
    }
    if (type === 'message:send') {
      await this.indexMessage(item);
    }
    if (type === 'message:delete') {
      await this.deleteIndexedMessage(item);
    }
    if (type === 'user:connection_status') {
      await this.recordPresence(item);
    }
  }

  private async indexMessage(item: Record<string, unknown>) {
    const channelId = String(item.channelId ?? '');
    const messageId = String(item.messageId ?? '');
    if (!channelId || !messageId) {
      return;
    }
    const mapping = await this.prisma.channelMapping.findUnique({ where: { channelId } });
    if (!mapping) {
      return;
    }
    await this.prisma.messageIndex.upsert({
      where: { messageId },
      update: {},
      create: {
        organizationId: mapping.organizationId,
        channelId,
        messageId,
        senderUserId: String(item.userId ?? ''),
        messageType: String(item.messageType ?? ''),
        content: String(item.content ?? '').slice(0, 8000),
        sentAt: new Date(Number(item.time ?? Date.now())),
      },
    });
    if (mapping.incidentId) {
      const bucket = Math.floor(Date.now() / 20_000);
      await this.queue.enqueue(
        'context-refresh',
        { incidentId: mapping.incidentId },
        { jobId: `ctx-${mapping.incidentId}-${bucket}`, delay: 20_000 },
      );
    }
  }

  private async deleteIndexedMessage(item: Record<string, unknown>) {
    const messageId = String(item.messageId ?? '');
    if (!messageId) {
      return;
    }
    const existing = await this.prisma.messageIndex.findUnique({ where: { messageId } });
    if (!existing) {
      return;
    }
    await this.prisma.messageIndex.delete({ where: { messageId } });
    const mapping = await this.prisma.channelMapping.findUnique({ where: { channelId: existing.channelId } });
    if (mapping?.incidentId) {
      const bucket = Math.floor(Date.now() / 20_000);
      await this.queue.enqueue(
        'context-refresh',
        { incidentId: mapping.incidentId },
        { jobId: `ctx-${mapping.incidentId}-${bucket}`, delay: 20_000 },
      );
    }
  }

  private async recordPresence(item: Record<string, unknown>) {
    const nexconnUserId = String(item.userId ?? '');
    const status = item.status === '0' ? 'online' : item.status === '2' ? 'logout' : 'offline';
    const user = await this.prisma.user.findUnique({ where: { nexconnUserId } });
    if (!user) {
      return;
    }
    await this.prisma.presenceState.upsert({
      where: { userId: user.id },
      update: { status },
      create: { userId: user.id, status },
    });
  }

  private async mark(
    incidentId: string,
    mappingId: string,
    status: 'PENDING' | 'READY' | 'FAILED',
    lastError: string | null,
  ) {
    await this.prisma.channelMapping.update({
      where: { id: mappingId },
      data: { setupStatus: status, lastError },
    });
    await this.prisma.incident.update({
      where: { id: incidentId },
      data: { channelSetup: status },
    });
  }
}

function scopeFromRole(role: MemberRole): DataScope {
  if (role === 'ORG_ADMIN' || role === 'OPERATIONS_MANAGER') return 'ORG';
  if (role === 'SUPERVISOR') return 'SITE';
  return 'ASSIGNED';
}
