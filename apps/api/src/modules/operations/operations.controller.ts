import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  askAssistantSchema,
  escalationPolicySchema,
  type AskAssistantInput,
  type EscalationPolicyInput,
  type UserProfile,
} from '@fieldops/shared';
import { z } from 'zod';
import type { RequestMembership } from '../../common/auth/authenticated-request';
import { CurrentMembership, CurrentUser } from '../../common/auth/current-user.decorator';
import { RequireOrg } from '../../common/auth/require-org.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ContextService } from '../ai-context/context.service';
import { MediaService } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationsService } from './operations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { hasPermission } from '@fieldops/shared';

@ApiTags('operations')
@ApiCookieAuth()
@RequireOrg()
@Controller()
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly notifications: NotificationsService,
    private readonly context: ContextService,
    private readonly media: MediaService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: UserProfile, @CurrentMembership() membership: RequestMembership) {
    return this.operations.dashboard(user.id, membership);
  }

  @Get('notifications')
  notificationsList(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
  ) {
    return this.notifications.list(user.id, membership.organizationId);
  }

  @Get('notifications/unread-count')
  unreadCount(@CurrentUser() user: UserProfile, @CurrentMembership() membership: RequestMembership) {
    return this.notifications.unreadCount(user.id, membership.organizationId).then((count) => ({ count }));
  }

  @Post('notifications/read-all')
  readAll(@CurrentUser() user: UserProfile, @CurrentMembership() membership: RequestMembership) {
    return this.notifications.markAllRead(user.id, membership.organizationId);
  }

  @Post('notifications/:id/read')
  read(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Param('id') id: string,
  ) {
    return this.notifications.markRead(user.id, membership.organizationId, id);
  }

  @RequirePermissions('org.settings.manage')
  @Post('escalation-policy')
  policy(
    @CurrentMembership() membership: RequestMembership,
    @Body(new ZodValidationPipe(escalationPolicySchema)) body: EscalationPolicyInput,
  ) {
    return this.prisma.escalationPolicy.upsert({
      where: { organizationId: membership.organizationId },
      update: body,
      create: { organizationId: membership.organizationId, ...body },
    });
  }

  @Get('escalation-policy')
  getPolicy(@CurrentMembership() membership: RequestMembership) {
    return this.prisma.escalationPolicy.findUnique({
      where: { organizationId: membership.organizationId },
    });
  }

  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 500 : 10, ttl: 60_000 } })
  @Post('incidents/:id/intelligence')
  intelligence(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Param('id') id: string,
  ) {
    return this.context.intelligence(
      id,
      membership.organizationId,
      membership.role,
      user.id,
      membership.dataScope,
    );
  }

  @Post('incidents/:id/context/refresh')
  refresh(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Param('id') id: string,
  ) {
    return this.context.refreshForActor(
      id,
      membership.organizationId,
      membership.role,
      user.id,
      membership.dataScope,
    );
  }

  @Get('incidents/:id/context')
  contextView(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Param('id') id: string,
  ) {
    return this.context.freshness(
      id,
      membership.organizationId,
      membership.role,
      user.id,
      membership.dataScope,
    );
  }

  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 500 : 10, ttl: 60_000 } })
  @Post('incidents/:id/assistant')
  ask(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(askAssistantSchema)) body: AskAssistantInput,
  ) {
    return this.context.ask({
      incidentId: id,
      organizationId: membership.organizationId,
      userId: user.id,
      role: membership.role,
      dataScope: membership.dataScope,
      question: body.question,
    });
  }

  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 500 : 10, ttl: 60_000 } })
  @Post('ai/classify')
  classify(
    @Body(new ZodValidationPipe(z.object({ description: z.string().trim().min(3).max(4000) })))
    body: { description: string },
  ) {
    return this.context.classify(body.description);
  }

  @Get('handovers')
  handovers(@CurrentMembership() membership: RequestMembership) {
    const canSeeDrafts =
      hasPermission(membership.permissions, 'handovers.draft') ||
      hasPermission(membership.permissions, 'handovers.publish');
    return this.prisma.shiftHandover.findMany({
      where: {
        organizationId: membership.organizationId,
        ...(canSeeDrafts ? {} : { status: 'PUBLISHED' }),
      },
      include: {
        shift: {
          select: {
            id: true,
            name: true,
            daysOfWeek: true,
            startTime: true,
            endTime: true,
            site: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 500 : 5, ttl: 60_000 } })
  @RequirePermissions('handovers.draft')
  @Post('handovers')
  handover(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Body(
      new ZodValidationPipe(
        z.preprocess(
          (value) => value ?? {},
          z.object({ shiftId: z.string().uuid().optional() }),
        ),
      ),
    )
    body: { shiftId?: string },
  ) {
    return this.context.handover(
      membership.organizationId,
      user.id,
      membership.role,
      body.shiftId,
      membership.dataScope,
    );
  }

  @RequirePermissions('handovers.publish')
  @Post('handovers/:id/publish')
  publish(@CurrentMembership() membership: RequestMembership, @Param('id') id: string) {
    return this.context.publishHandover(membership.organizationId, id);
  }

  @Get('media/:id/url')
  async mediaUrl(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Param('id') id: string,
  ) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new NotFoundException('Media asset not found');
    }
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, organizationId: membership.organizationId },
      include: { incident: { select: { assigneeId: true, createdById: true, siteId: true } } },
    });
    if (!asset) {
      throw new NotFoundException('Media asset not found');
    }
    const restricted = membership.dataScope !== 'ORG';
    if (restricted && !asset.incident) {
      // Orphaned or non-incident assets are org-scoped roles only.
      if (asset.uploadedById !== user.id) {
        throw new NotFoundException('Media asset not found');
      }
    }
    if (membership.dataScope === 'ASSIGNED' && asset.incident) {
      const allowed =
        asset.incident.assigneeId === user.id || asset.incident.createdById === user.id;
      if (!allowed) {
        throw new NotFoundException('Media asset not found');
      }
    }
    if (membership.dataScope === 'SITE' && asset.incident) {
      const profile = await this.prisma.workforceProfile.findUnique({
        where: {
          organizationId_userId: { organizationId: membership.organizationId, userId: user.id },
        },
      });
      if (profile?.siteId && asset.incident.siteId !== profile.siteId) {
        throw new NotFoundException('Media asset not found');
      }
      if (
        !profile?.siteId &&
        asset.incident.assigneeId !== user.id &&
        asset.incident.createdById !== user.id
      ) {
        throw new NotFoundException('Media asset not found');
      }
    }
    return { url: this.media.deliveryUrl(asset.publicId, asset.resourceType) };
  }
}
