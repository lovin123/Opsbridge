import { Injectable, OnModuleInit } from '@nestjs/common';
import { ContextService } from '../ai-context/context.service';
import { MediaService } from '../media/media.service';
import { NexconnService } from '../nexconn/nexconn.service';
import { OperationsService } from '../operations/operations.service';
import { QueueService } from '../../queue/queue.service';

@Injectable()
export class JobsService implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly nexconn: NexconnService,
    private readonly context: ContextService,
    private readonly operations: OperationsService,
    private readonly media: MediaService,
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
        await this.media.cleanupExpiredGrants();
      }
    });
    void this.queue.schedule('media-cleanup', 60 * 60 * 1000);
  }
}
