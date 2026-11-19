import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateShiftInput,
  CreateSiteInput,
  CreateTeamInput,
  UpdateAvailabilityInput,
  UpdateTeamInput,
} from '@fieldops/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { NexconnApiClient } from '../nexconn/nexconn-api.client';

@Injectable()
export class WorkforceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nexconn: NexconnApiClient,
  ) {}

  sites(organizationId: string) {
    return this.prisma.site.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
  }

  async createSite(organizationId: string, input: CreateSiteInput) {
    const timezone = input.timezone || 'Asia/Kolkata';
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new BadRequestException('Unknown timezone');
    }
    return this.prisma.site.create({
      data: {
        organizationId,
        name: input.name,
        address: input.address,
        timezone,
      },
    });
  }

  teams(organizationId: string) {
    return this.prisma.team.findMany({
      where: { organizationId },
      include: {
        site: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
        channel: { select: { channelId: true, setupStatus: true, lastError: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createTeam(organizationId: string, creatorUserId: string, input: CreateTeamInput) {
    if (input.siteId) {
      const site = await this.prisma.site.findFirst({ where: { id: input.siteId, organizationId } });
      if (!site) {
        throw new BadRequestException('Site not found in this organization');
      }
    }
    const memberIds = [...new Set([creatorUserId, ...(input.memberIds ?? [])])];
    const members = await this.prisma.membership.findMany({
      where: { organizationId, userId: { in: memberIds }, active: true },
      select: { userId: true },
    });
    if (members.length !== memberIds.length) {
      throw new BadRequestException('One or more team members are not in this organization');
    }
    const team = await this.prisma.team.create({
      data: {
        organizationId,
        name: input.name,
        siteId: input.siteId,
        members: {
          create: memberIds.map((userId) => ({ userId })),
        },
      },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, nexconnUserId: true } } },
        },
      },
    });
    const channelId = `tm${team.id.replace(/-/g, '')}`;
    await this.prisma.channelMapping.create({
      data: {
        organizationId,
        kind: 'TEAM',
        channelId,
        name: team.name.slice(0, 64),
        teamId: team.id,
        setupStatus: this.nexconn.configured() ? 'PENDING' : 'FAILED',
        lastError: this.nexconn.configured() ? null : 'Nexconn is not configured',
      },
    });
    if (this.nexconn.configured()) {
      const owner =
        team.members.find((member) => member.userId === creatorUserId)?.user ?? team.members[0]?.user;
      if (!owner) {
        await this.prisma.channelMapping.update({
          where: { channelId },
          data: { setupStatus: 'FAILED', lastError: 'Team has no members to own the channel' },
        });
        return team;
      }
      try {
        for (const member of team.members) {
          await this.nexconn.issueToken(member.user.nexconnUserId, member.user.name);
        }
        const others = team.members
          .map((member) => member.user.nexconnUserId)
          .filter((id) => id !== owner.nexconnUserId);
        const created = await this.nexconn.createGroup({
          channelId,
          name: team.name,
          owner: owner.nexconnUserId,
          userIds: others.slice(0, 30),
        });
        if (created.code === 0 && others.length > 30) {
          const overflow = await this.nexconn.joinGroup(channelId, others.slice(30));
          if (overflow.code !== 0 && !/exist|already|duplicate|member/i.test(overflow.msg || '')) {
            await this.prisma.channelMapping.update({
              where: { channelId },
              data: {
                setupStatus: 'FAILED',
                lastError: overflow.msg || 'Could not add remaining channel members',
              },
            });
            return this.teams(organizationId).then((rows) => rows.find((row) => row.id === team.id) ?? team);
          }
        }
        if (created.code !== 0) {
          const joined = await this.nexconn.joinGroup(channelId, [
            owner.nexconnUserId,
            ...others,
          ]);
          const joinOk =
            joined.code === 0 || /exist|already|duplicate|member/i.test(joined.msg || '');
          await this.prisma.channelMapping.update({
            where: { channelId },
            data: {
              setupStatus: joinOk ? 'READY' : 'FAILED',
              lastError: joinOk
                ? null
                : joined.msg || created.msg || 'Channel exists but membership sync failed',
            },
          });
        } else {
          await this.prisma.channelMapping.update({
            where: { channelId },
            data: { setupStatus: 'READY', lastError: null },
          });
        }
      } catch (error) {
        await this.prisma.channelMapping.update({
          where: { channelId },
          data: {
            setupStatus: 'FAILED',
            lastError: error instanceof Error ? error.message : 'Channel setup failed',
          },
        });
      }
    }
    const safe = await this.teams(organizationId);
    return safe.find((row) => row.id === team.id) ?? {
      ...team,
      members: team.members.map((member) => ({
        ...member,
        user: { id: member.user.id, name: member.user.name, email: member.user.email },
      })),
    };
  }

  async updateTeam(organizationId: string, teamId: string, input: UpdateTeamInput) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(teamId)) {
      throw new BadRequestException('Team id is invalid');
    }
    const existing = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId },
      include: {
        members: true,
        channel: true,
      },
    });
    if (!existing) {
      throw new NotFoundException('Team not found');
    }

    const memberIds = [...new Set(input.memberIds)];
    if (memberIds.length === 0) {
      throw new BadRequestException('A team needs at least one member');
    }
    const members = await this.prisma.membership.findMany({
      where: { organizationId, userId: { in: memberIds }, active: true },
      select: { userId: true },
    });
    if (members.length !== memberIds.length) {
      throw new BadRequestException('One or more team members are not in this organization');
    }

    await this.prisma.$transaction(async (tx) => {
      if (input.name && input.name !== existing.name) {
        await tx.team.update({ where: { id: teamId }, data: { name: input.name } });
        if (existing.channel) {
          await tx.channelMapping.update({
            where: { id: existing.channel.id },
            data: { name: input.name.slice(0, 64) },
          });
        }
      }
      await tx.teamMember.deleteMany({ where: { teamId } });
      await tx.teamMember.createMany({
        data: memberIds.map((userId) => ({ teamId, userId })),
      });
    });

    const team = await this.prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, nexconnUserId: true } } },
        },
        channel: true,
      },
    });

    if (team.channel && this.nexconn.configured()) {
      try {
        for (const member of team.members) {
          await this.nexconn.issueToken(member.user.nexconnUserId, member.user.name);
        }
        const userIds = team.members.map((member) => member.user.nexconnUserId);
        const joined = await this.nexconn.joinGroup(team.channel.channelId, userIds);
        const joinOk =
          joined.code === 0 || /exist|already|duplicate|member/i.test(joined.msg || '');
        await this.prisma.channelMapping.update({
          where: { id: team.channel.id },
          data: {
            setupStatus: joinOk ? 'READY' : team.channel.setupStatus,
            lastError: joinOk ? null : joined.msg || 'Could not sync team channel members',
          },
        });
      } catch (error) {
        await this.prisma.channelMapping.update({
          where: { id: team.channel.id },
          data: {
            lastError: error instanceof Error ? error.message : 'Could not sync team channel members',
          },
        });
      }
    }

    const rows = await this.teams(organizationId);
    return rows.find((row) => row.id === teamId) ?? team;
  }

  shifts(organizationId: string) {
    return this.prisma.shift.findMany({
      where: { organizationId },
      include: {
        site: { select: { id: true, name: true } },
        supervisor: { select: { id: true, name: true } },
        assignments: { include: { user: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createShift(organizationId: string, input: CreateShiftInput) {
    const site = await this.prisma.site.findFirst({ where: { id: input.siteId, organizationId } });
    if (!site) {
      throw new NotFoundException('Site not found');
    }
    const daysOfWeek = [...new Set(input.daysOfWeek)].sort((a, b) => a - b);
    if (daysOfWeek.length === 0) {
      throw new BadRequestException('Select at least one day');
    }
    if (input.startTime === input.endTime) {
      throw new BadRequestException('Shift end time must differ from start time');
    }
    if (input.supervisorId) {
      const supervisor = await this.prisma.membership.findFirst({
        where: { organizationId, userId: input.supervisorId, active: true },
      });
      if (!supervisor) {
        throw new BadRequestException('Supervisor is not a member of this organization');
      }
    }
    const memberIds = [...new Set(input.memberIds)];
    if (memberIds.length > 0) {
      const members = await this.prisma.membership.findMany({
        where: { organizationId, userId: { in: memberIds }, active: true },
        select: { userId: true },
      });
      if (members.length !== memberIds.length) {
        throw new BadRequestException('One or more shift members are not in this organization');
      }
    }
    return this.prisma.shift.create({
      data: {
        organizationId,
        siteId: site.id,
        name: input.name,
        daysOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        supervisorId: input.supervisorId,
        assignments: { create: memberIds.map((userId) => ({ userId })) },
      },
    });
  }

  myProfile(organizationId: string, userId: string) {
    return this.prisma.workforceProfile.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { site: true },
    });
  }

  async updateAvailability(organizationId: string, userId: string, input: UpdateAvailabilityInput) {
    if (input.siteId) {
      const site = await this.prisma.site.findFirst({ where: { id: input.siteId, organizationId } });
      if (!site) {
        throw new BadRequestException('Site not found in this organization');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.workforceProfile.upsert({
        where: { organizationId_userId: { organizationId, userId } },
        update: {
          availability: input.availability,
          siteId: input.siteId === undefined ? undefined : input.siteId,
        },
        create: {
          organizationId,
          userId,
          availability: input.availability,
          siteId: input.siteId ?? undefined,
        },
      });
      if (input.skillNames) {
        for (const name of input.skillNames) {
          const skill = await tx.skill.upsert({
            where: { organizationId_name: { organizationId, name } },
            update: {},
            create: { organizationId, name },
          });
          await tx.userSkill.upsert({
            where: { userId_skillId: { userId, skillId: skill.id } },
            update: {},
            create: { userId, skillId: skill.id },
          });
        }
      }
      return profile;
    });
  }

  directory(organizationId: string) {
    return this.prisma.membership.findMany({
      where: { organizationId, active: true },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            jobTitle: true,
            presence: { select: { status: true, updatedAt: true } },
            skills: {
              where: { skill: { organizationId } },
              include: { skill: { select: { id: true, name: true } } },
            },
            workforceProfiles: {
              where: { organizationId },
              select: { availability: true, siteId: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
