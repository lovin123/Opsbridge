import { Injectable } from '@nestjs/common';
import type { MemberRole } from '@fieldops/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async dashboard(
    userId: string,
    membership: { organizationId: string; role: MemberRole; dataScope?: string },
  ) {
    const organizationId = membership.organizationId;
    const scope = await this.visibleWhere(userId, membership);
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const start = startOfDayInTimeZone(organization?.timezone || 'UTC');
    const [active, critical, unassigned, overdue, resolvedToday, available, byStatus, bySite] =
      await Promise.all([
        this.prisma.incident.count({
          where: { ...scope, status: { notIn: ['RESOLVED', 'CLOSED'] } },
        }),
        this.prisma.incident.count({
          where: { ...scope, priority: 'CRITICAL', status: { notIn: ['RESOLVED', 'CLOSED'] } },
        }),
        this.prisma.incident.count({
          where: { ...scope, assigneeId: null, status: { notIn: ['RESOLVED', 'CLOSED'] } },
        }),
        this.prisma.incident.count({
          where: {
            ...scope,
            dueAt: { lt: new Date() },
            status: { notIn: ['RESOLVED', 'CLOSED'] },
          },
        }),
        this.prisma.incident.count({
          where: { ...scope, resolvedAt: { gte: start } },
        }),
        this.prisma.workforceProfile.count({
          where: { organizationId, availability: 'AVAILABLE' },
        }),
        this.prisma.incident.groupBy({
          by: ['status'],
          where: scope,
          _count: { _all: true },
        }),
        this.prisma.incident.groupBy({
          by: ['siteId'],
          where: { ...scope, status: { notIn: ['CLOSED'] } },
          _count: { _all: true },
        }),
      ]);
    const sites = await this.prisma.site.findMany({ where: { organizationId } });
    const siteName = new Map(sites.map((site) => [site.id, site.name]));
    const feed = await this.prisma.incident.findMany({
      where: scope,
      orderBy: { updatedAt: 'desc' },
      take: 8,
      include: { site: true, assignee: true },
    });
    return {
      active,
      critical,
      unassigned,
      overdue,
      resolvedToday,
      availableTechnicians: available,
      byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
      bySite: bySite.map((row) => ({ site: siteName.get(row.siteId) ?? 'Site', count: row._count._all })),
      feed: feed.map((item) => ({
        id: item.id,
        number: item.number,
        title: item.title,
        priority: item.priority,
        status: item.status,
        site: item.site.name,
        assignee: item.assignee?.name ?? null,
      })),
    };
  }

  private async visibleWhere(
    userId: string,
    membership: { organizationId: string; role: MemberRole; dataScope?: string },
  ): Promise<Prisma.IncidentWhereInput> {
    const organizationId = membership.organizationId;
    const scope = membership.dataScope ?? (membership.role === 'ORG_ADMIN' || membership.role === 'OPERATIONS_MANAGER'
      ? 'ORG'
      : membership.role === 'SUPERVISOR'
        ? 'SITE'
        : 'ASSIGNED');
    if (scope === 'ORG') {
      return { organizationId };
    }
    if (scope === 'SITE') {
      const profile = await this.prisma.workforceProfile.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
      });
      if (profile?.siteId) {
        return { organizationId, siteId: profile.siteId };
      }
      return {
        organizationId,
        OR: [{ assigneeId: userId }, { createdById: userId }],
      };
    }
    return {
      organizationId,
      OR: [{ assigneeId: userId }, { createdById: userId }],
    };
  }

  async escalate(incidentId: string, priority: string) {
    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      include: { site: true },
    });
    if (!incident || ['RESOLVED', 'CLOSED'].includes(incident.status)) {
      return;
    }
    const generation = incident.updatedAt.getTime();
    const dedupeKey = `esc:${incident.id}:${priority}:${incident.status}:${generation}`;
    try {
      await this.prisma.escalationEvent.create({
        data: { incidentId, priority: incident.priority, dedupeKey },
      });
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : '';
      if (code === 'P2002') {
        return;
      }
      throw error;
    }
    const supervisors = await this.prisma.membership.findMany({
      where: {
        organizationId: incident.organizationId,
        active: true,
        role: { in: ['SUPERVISOR', 'OPERATIONS_MANAGER', 'ORG_ADMIN'] },
      },
    });
    for (const supervisor of supervisors) {
      await this.notifications.notify({
        organizationId: incident.organizationId,
        userId: supervisor.userId,
        kind: 'ESCALATION',
        title: `${incident.number} needs attention`,
        body: `${incident.priority} incident at ${incident.site.name} is still ${incident.status}`,
        incidentId: incident.id,
        dedupeKey: `esc-note:${incident.id}:${priority}:${supervisor.userId}:${generation}`,
      });
    }
  }
}

function startOfDayInTimeZone(timeZone: string, now = new Date()): Date {
  try {
    const dateFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const target = dateFmt.format(now);
    let cursor = now.getTime();
    for (let step = 0; step < 96; step += 1) {
      const previous = cursor - 15 * 60 * 1000;
      if (dateFmt.format(new Date(previous)) !== target) {
        let low = previous;
        let high = cursor;
        while (high - low > 1000) {
          const mid = Math.floor((low + high) / 2);
          if (dateFmt.format(new Date(mid)) === target) {
            high = mid;
          } else {
            low = mid;
          }
        }
        return new Date(high);
      }
      cursor = previous;
    }
  } catch {
    // fall through to server-local midnight
  }
  const fallback = new Date(now);
  fallback.setHours(0, 0, 0, 0);
  return fallback;
}
