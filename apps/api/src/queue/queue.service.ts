import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

export type JobName = 'nexconn-event' | 'context-refresh' | 'escalation' | 'notification' | 'media-cleanup';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queue: Queue;
  private workers: Worker[] = [];
  private clients: IORedis[] = [];

  constructor(private readonly config: ConfigService) {
    this.queue = new Queue('opsbridge', { connection: this.connection() });
  }

  async enqueue(name: JobName, data: Record<string, string>, options?: JobsOptions) {
    try {
      await this.enqueueOrThrow(name, data, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'queue add failed';
      if (!message.includes('JobId') && !message.toLowerCase().includes('already exists')) {
        this.logger.warn(message);
      }
    }
  }

  async enqueueOrThrow(name: JobName, data: Record<string, string>, options?: JobsOptions) {
    await this.queue.add(name, data, {
      removeOnComplete: 100,
      removeOnFail: 100,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      ...options,
    });
  }

  async schedule(name: JobName, everyMs: number, data: Record<string, string> = {}) {
    try {
      await this.queue.upsertJobScheduler(
        name,
        { every: everyMs },
        {
          name,
          data,
          opts: {
            removeOnComplete: 100,
            removeOnFail: 100,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'scheduler upsert failed';
      this.logger.warn(message);
    }
  }

  registerWorker(processor: (name: string, data: Record<string, string>) => Promise<void>) {
    if (this.config.get('NODE_ENV') === 'test') {
      return;
    }
    const worker = new Worker(
      'opsbridge',
      async (job) => {
        await processor(job.name, job.data as Record<string, string>);
      },
      { connection: this.connection() },
    );
    worker.on('failed', (job, error) => {
      this.logger.warn(`Job ${job?.name ?? 'unknown'} failed: ${error.message}`);
    });
    this.workers.push(worker);
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await this.queue.close();
    await Promise.all(this.clients.map((client) => client.quit()));
  }

  private connection() {
    const client = new IORedis(this.config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null,
    });
    this.clients.push(client);
    return client;
  }
}
