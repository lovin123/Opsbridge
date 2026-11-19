import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canTransition,
  hasPermission,
  incidentNumber,
  type CreateIncidentInput,
  type IncidentStatus,
  type UpdateIncidentStatusInput,
  type UserProfile,
} from '@fieldops/shared';
import { AuditService } from '../../audit/audit.service';
import type { RequestMembership } from '../../common/auth/authenticated-request';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { NexconnService } from '../nexconn/nexconn.service';
import { NotificationsService } from '../notifications/notifications.service';

type Actor = { user: UserProfile; membership: RequestMembership };

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly nexconn: NexconnService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
  ) {}

  async list(actor: Actor) {
    const where = await this.visibleWhere(actor);
    const rows = await this.prisma.incident.findMany({
      where,
      include: {
        site: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        channel: { select: { channelId: true, setupStatus: true, lastError: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return rows.map(presentIncident);
  }

  async get(actor: Actor, id: string) {
    const incident = await this.loadVisible(actor, id);
    const events = await this.prisma.incidentEvent.findMany({
      where: { incidentId: id },
      orderBy: { createdAt: 'asc' },
      include: { actor: true },
    });
    const media = await this.prisma.mediaAsset.findMany({ where: { incidentId: id } });
    return {
      ...presentIncident(incident),
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        message: event.message,
        actorName: event.actor?.name ?? null,
        createdAt: event.createdAt.toISOString(),
      })),
      media: media.map((asset) => ({
        id: asset.id,
        filename: asset.filename,
        mimeType: asset.mimeType,
        bytes: asset.bytes,
        purpose: asset.purpose,
        publicId: asset.publicId,
        resourceType: asset.resourceType,
        createdAt: asset.createdAt.toISOString(),
      })),
    };
  }

  async create(actor: Actor, input: CreateIncidentInput) {
    this.assertCanCreate(actor.membership);
    const site = await this.prisma.site.findFirst({
      where: { id: input.siteId, organizationId: actor.membership.organizationId },
    });
    if (!site) {
      throw new NotFoundException('Site not found');
    }
    if (actor.membership.dataScope === 'SITE') {
      const profile = await this.prisma.workforceProfile.findUnique({
        where: {
          organizationId_userId: {
            organizationId: actor.membership.organizationId,
            userId: actor.user.id,
          },
        },
      });
      if (profile?.siteId && profile.siteId !== input.siteId) {
        throw new ForbiddenException('Supervisors can only create incidents for their site');
      }
    }
    if (input.assigneeId) {
      const member = await this.prisma.membership.findFirst({
        where: {
          organizationId: actor.membership.organizationId,
          userId: input.assigneeId,
          active: true,
        },
      });
      if (!member) {
        throw new BadRequestException('Assignee is not a member of this organization');
      }
    }
    if (input.teamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: input.teamId, organizationId: actor.membership.organizationId },
      });
      if (!team) {
        throw new BadRequestException('Team not found in this organization');
      }
    }
    const year = new Date().getUTCFullYear();
    let incident;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        incident = await this.prisma.$transaction(async (tx) => {
          const latest = await tx.incident.aggregate({
            where: { organizationId: actor.membership.organizationId },
            _max: { sequence: true },
          });
          const sequence = (latest._max.sequence ?? 0) + 1;
          const created = await tx.incident.create({
            data: {
              organizationId: actor.membership.organizationId,
              number: incidentNumber(year, sequence),
              sequence,
              title: input.title,
              description: input.description,
              category: input.category,
              priority: input.priority,
              status: input.assigneeId ? 'ASSIGNED' : 'OPEN',
              siteId: site.id,
              location: input.location,
              equipment: input.equipment,
              teamId: input.teamId,
              assigneeId: input.assigneeId,
              dueAt: input.dueAt ? new Date(input.dueAt) : null,
              createdById: actor.user.id,
            },
            include: { site: true, assignee: true, team: true, channel: true },
          });
          await tx.incidentEvent.create({
            data: {
              incidentId: created.id,
              actorId: actor.user.id,
              type: 'CREATED',
              message: `${actor.user.name} opened ${created.number}`,
            },
          });
          await this.audit.record(
            {
              organizationId: actor.membership.organizationId,
              actorId: actor.user.id,
              action: 'INCIDENT_CREATED',
              targetType: 'Incident',
              targetId: created.id,
            },
            tx,
          );
          return created;
        });
        break;
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code !== 'P2002' || attempt === 2) {
          throw error;
        }
      }
    }
    if (!incident) {
      throw new BadRequestException('Could not allocate an incident number');
    }
    await this.nexconn.provisionIncidentChannel(incident.id);
    await this.queue.enqueue('context-refresh', { incidentId: incident.id });
    await this.scheduleEscalation(incident.id, incident.priority);
    if (incident.assigneeId) {
      await this.notifications.notify({
        organizationId: incident.organizationId,
        userId: incident.assigneeId,
        kind: 'ASSIGNMENT',
        title: `Assigned ${incident.number}`,
        body: incident.title,
        incidentId: incident.id,
        dedupeKey: `assign:${incident.id}:${incident.assigneeId}`,
      });
    }
    return this.get(actor, incident.id);
  }

  async assign(actor: Actor, id: string, input: { assigneeId: string | null; teamId?: string | null }) {
    if (!hasPermission(actor.membership.permissions, 'incidents.assign')) {
      throw new ForbiddenException('You cannot assign incidents');
    }
    const current = await this.loadVisible(actor, id);
    if (input.assigneeId) {
      const member = await this.prisma.membership.findFirst({
        where: {
          organizationId: actor.membership.organizationId,
          userId: input.assigneeId,
          active: true,
        },
      });
      if (!member) {
        throw new BadRequestException('Assignee is not a member of this organization');
      }
    }
    if (input.teamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: input.teamId, organizationId: actor.membership.organizationId },
      });
      if (!team) {
        throw new BadRequestException('Team not found in this organization');
      }
    }
    const nextStatus = input.assigneeId
      ? current.status === 'OPEN'
        ? 'ASSIGNED'
        : current.status
      : 'OPEN';
    const updated = await this.prisma.incident.update({
      where: { id: current.id },
      data: {
        assigneeId: input.assigneeId,
        teamId: input.teamId === undefined ? current.teamId : input.teamId,
        status: nextStatus,
      },
    });
    await this.prisma.incidentEvent.create({
      data: {
        incidentId: id,
        actorId: actor.user.id,
        type: 'ASSIGNED',
        message: input.assigneeId ? 'Assignment updated' : 'Assignment cleared',
      },
    });
    await this.nexconn.syncMembership(id);
    await this.queue.enqueue('context-refresh', { incidentId: id });
    if (input.assigneeId && input.assigneeId !== current.assigneeId) {
      await this.notifications.notify({
        organizationId: current.organizationId,
        userId: input.assigneeId,
        kind: current.assigneeId ? 'REASSIGNMENT' : 'ASSIGNMENT',
        title: `${current.number} assigned to you`,
        body: current.title,
        incidentId: id,
        dedupeKey: `assign:${id}:${input.assigneeId}`,
      });
    }
    return this.get(actor, updated.id);
  }

  async changeStatus(actor: Actor, id: string, input: UpdateIncidentStatusInput) {
    const current = await this.loadVisible(actor, id);
    const next = input.status as IncidentStatus;
    if (!canTransition(current.status, next)) {
      throw new BadRequestException(`Cannot move ${current.status} to ${next}`);
    }
    if (next === 'ASSIGNED' && !current.assigneeId) {
      throw new BadRequestException('Assign a technician before moving to ASSIGNED');
    }
    if (next === 'RESOLVED' && !input.resolutionNotes?.trim()) {
      throw new BadRequestException('Resolution notes are required');
    }
    if (
      actor.membership.dataScope === 'ASSIGNED' &&
      !hasPermission(actor.membership.permissions, 'incidents.update_any') &&
      current.assigneeId !== actor.user.id
    ) {
      throw new ForbiddenException('You can only update incidents assigned to you');
    }
    if (
      actor.membership.dataScope === 'ASSIGNED' &&
      !hasPermission(actor.membership.permissions, 'incidents.update_any') &&
      next === 'OPEN'
    ) {
      throw new ForbiddenException('You cannot unassign incidents');
    }
    await this.prisma.incident.update({
      where: { id },
      data: {
        status: next,
        assigneeId: next === 'OPEN' ? null : current.assigneeId,
        resolutionNotes: input.resolutionNotes ?? current.resolutionNotes,
        resolvedAt:
          next === 'RESOLVED'
            ? new Date()
            : next === 'CLOSED'
              ? current.resolvedAt
              : null,
        closedAt: next === 'CLOSED' ? new Date() : null,
      },
    });
    await this.prisma.incidentEvent.create({
      data: {
        incidentId: id,
        actorId: actor.user.id,
        type: 'STATUS',
        message: `Status changed from ${current.status} to ${next}`,
      },
    });
    if (next === 'OPEN' && current.assigneeId) {
      await this.nexconn.syncMembership(id);
    }
    await this.queue.enqueue('context-refresh', { incidentId: id });
    if (!['RESOLVED', 'CLOSED'].includes(next)) {
      const reopened = ['RESOLVED', 'CLOSED'].includes(current.status);
      if (reopened || next === 'ASSIGNED' || next === 'ACCEPTED' || next === 'IN_PROGRESS') {
        await this.scheduleEscalation(id, current.priority);
      }
    }
    if (next === 'RESOLVED' && current.createdById !== actor.user.id) {
      await this.notifications.notify({
        organizationId: current.organizationId,
        userId: current.createdById,
        kind: 'RESOLUTION',
        title: `${current.number} was resolved`,
        body: input.resolutionNotes ?? current.title,
        incidentId: id,
        dedupeKey: `resolved:${id}`,
      });
    }
    return this.get(actor, id);
  }

  async retryChannel(actor: Actor, id: string) {
    await this.loadVisible(actor, id);
    const mapping = await this.prisma.channelMapping.findUnique({ where: { incidentId: id } });
    if (mapping?.setupStatus === 'READY') {
      await this.nexconn.syncMembership(id);
    } else {
      await this.nexconn.provisionIncidentChannel(id);
    }
    return this.get(actor, id);
  }

  async scheduleEscalation(incidentId: string, priority: string) {
    const incident = await this.prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) {
      return;
    }
    const policy = await this.prisma.escalationPolicy.findUnique({
      where: { organizationId: incident.organizationId },
    });
    const minutes =
      priority === 'CRITICAL'
        ? (policy?.criticalMinutes ?? 5)
        : priority === 'HIGH'
          ? (policy?.highMinutes ?? 15)
          : priority === 'MEDIUM'
            ? (policy?.mediumMinutes ?? 30)
            : null;
    // Explicit policy value 0 means "escalate immediately"; missing policy uses safer defaults above.
    if (minutes === null) {
      return;
    }
    await this.queue.enqueue(
      'escalation',
      { incidentId, priority },
      {
        delay: minutes * 60 * 1000,
        jobId: `esc-${incidentId}-${priority}-${incident.updatedAt.getTime()}`,
      },
    );
  }

  private assertCanCreate(membership: RequestMembership) {
    if (!hasPermission(membership.permissions, 'incidents.create')) {
      throw new ForbiddenException('You cannot create incidents');
    }
  }

  private async visibleWhere(actor: Actor) {
    const organizationId = actor.membership.organizationId;
    if (actor.membership.dataScope === 'ORG') {
      return { organizationId };
    }
    if (actor.membership.dataScope === 'SITE') {
      const profile = await this.prisma.workforceProfile.findUnique({
        where: { organizationId_userId: { organizationId, userId: actor.user.id } },
      });
      if (profile?.siteId) {
        return { organizationId, siteId: profile.siteId };
      }
      // No site on profile: fail closed to incidents the user owns or is assigned to.
      return {
        organizationId,
        OR: [{ assigneeId: actor.user.id }, { createdById: actor.user.id }],
      };
    }
    return {
      organizationId,
      OR: [{ assigneeId: actor.user.id }, { createdById: actor.user.id }],
    };
  }

  private async loadVisible(actor: Actor, id: string) {
    const incident = await this.prisma.incident.findFirst({
      where: { id, ...(await this.visibleWhere(actor)) },
      include: {
        site: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        channel: { select: { channelId: true, setupStatus: true, lastError: true } },
      },
    });
    if (!incident) {
      throw new NotFoundException('Incident not found');
    }
    return incident;
  }
}

function presentIncident(incident: {
  id: string;
  number: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  location: string | null;
  equipment: string | null;
  dueAt: Date | null;
  resolutionNotes: string | null;
  channelSetup: string;
  createdAt: Date;
  updatedAt: Date;
  site: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  channel: { channelId: string; setupStatus: string; lastError: string | null } | null;
}) {
  return {
    id: incident.id,
    number: incident.number,
    title: incident.title,
    description: incident.description,
    category: incident.category,
    priority: incident.priority,
    status: incident.status,
    location: incident.location,
    equipment: incident.equipment,
    dueAt: incident.dueAt?.toISOString() ?? null,
    resolutionNotes: incident.resolutionNotes,
    channelSetup: incident.channelSetup,
    channelId: incident.channel?.channelId ?? null,
    channelError: incident.channel?.lastError ?? null,
    site: incident.site,
    assignee: incident.assignee ? { id: incident.assignee.id, name: incident.assignee.name } : null,
    team: incident.team ? { id: incident.team.id, name: incident.team.name } : null,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
  };
}
