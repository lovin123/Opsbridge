import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationKind } from '@prisma/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async notify(input: {
    organizationId: string;
    userId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    incidentId?: string;
    dedupeKey: string;
  }) {
    const existing = await this.prisma.notification.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (existing) {
      return existing;
    }

    let notification;
    try {
      notification = await this.prisma.notification.create({ data: input });
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : '';
      if (code === 'P2002') {
        return this.prisma.notification.findUniqueOrThrow({ where: { dedupeKey: input.dedupeKey } });
      }
      throw error;
    }

    void this.emailNotification(notification.id, input).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Notification email failed for ${input.userId}: ${detail}`);
    });

    return notification;
  }

  list(userId: string, organizationId: string) {
    return this.prisma.notification.findMany({
      where: { userId, organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(userId: string, organizationId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, organizationId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string, organizationId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, organizationId, readAt: null },
      data: { readAt: new Date() },
    });
    return this.list(userId, organizationId);
  }

  unreadCount(userId: string, organizationId: string) {
    return this.prisma.notification.count({
      where: { userId, organizationId, readAt: null },
    });
  }

  private async emailNotification(
    notificationId: string,
    input: {
      organizationId: string;
      userId: string;
      title: string;
      body: string;
      incidentId?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true, name: true },
    });
    if (!user) {
      return;
    }

    const origin = this.config.getOrThrow<string>('WEB_ORIGIN').replace(/\/$/, '');
    const actionUrl = input.incidentId
      ? `${origin}/app/incidents/${input.incidentId}`
      : `${origin}/app/notifications`;

    await this.mail.sendNotification({
      to: user.email,
      name: user.name,
      title: input.title,
      body: input.body,
      actionUrl,
    });

    this.logger.debug(`Emailed notification ${notificationId} to ${user.email}`);
  }
}
