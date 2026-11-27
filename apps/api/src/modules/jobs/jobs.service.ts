import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ContextService } from '../ai-context/context.service';
import { MediaService } from '../media/media.service';
import { NexconnService } from '../nexconn/nexconn.service';
import { OperationsService } from '../operations/operations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';

@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly queue: QueueService,
    private readonly nexconn: NexconnService,
    private readonly context: ContextService,
    private readonly operations: OperationsService,
    private readonly media: MediaService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.queue.registerWorker(async (name, data) => {
      if (name === 'nexconn-event') {
        await this.nexconn.processEvent(data.type, data.data);
      }
      if (name === 'context-refresh') {
        await this.context.refresh(data.incidentId);
      }
      if (name === 'escalation') {
        await this.operations.escalate(data.incidentId, data.priority);
      }
      if (name === 'media-cleanup') {
        await this.runMaintenance();
      }
    });
    // Hourly maintenance: grants, sessions, webhook receipts, Redis job history.
    void this.queue.schedule('media-cleanup', 60 * 60 * 1000);
  }

  private async runMaintenance() {
    const grants = await this.media.cleanupExpiredGrants();
    const sessions = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const receipts = await this.prisma.webhookReceipt.deleteMany({
      where: { receivedAt: { lt: weekAgo } },
    });
    await this.queue.pruneHistory();
    this.logger.log(
      `Maintenance: grants=${grants}, sessions=${sessions.count}, receipts=${receipts.count}`,
    );
  }
}
