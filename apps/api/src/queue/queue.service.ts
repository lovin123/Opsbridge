import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type ConnectionOptions, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

export type JobName = 'nexconn-event' | 'context-refresh' | 'escalation' | 'notification' | 'media-cleanup';
export type QueueDriver = 'inline' | 'bullmq';

type JobProcessor = (name: string, data: Record<string, string>) => Promise<void>;

/** Free-tier friendly: keep almost no job history in Redis (Upstash memory/commands are tiny). */
const DEFAULT_JOB_OPTS: JobsOptions = {
  removeOnComplete: { count: 5, age: 600 },
  removeOnFail: { count: 20, age: 3600 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
};

/**
 * Upstash free Redis cannot sustain a BullMQ worker (continuous BRPOP/XREAD burns the
 * ~500k commands/month quota in days). Default to in-process jobs; use bullmq only with
 * a Redis plan that allows high command volume.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly driver: QueueDriver;
  private readonly queue: Queue | null = null;
  private workers: Worker[] = [];
  private clients: IORedis[] = [];
  private processor: JobProcessor | null = null;
  private readonly delayed = new Map<string, NodeJS.Timeout>();
  private readonly intervals = new Map<string, NodeJS.Timeout>();
  private delaySeq = 0;

  constructor(private readonly config: ConfigService) {
    this.driver = (this.config.get<string>('QUEUE_DRIVER') as QueueDriver) || 'inline';
    if (this.driver === 'bullmq' && this.config.get('NODE_ENV') !== 'test') {
      this.queue = new Queue('opsbridge', {
        connection: this.connection(),
        defaultJobOptions: DEFAULT_JOB_OPTS,
      });
    } else {
      this.logger.log('Queue driver=inline (no BullMQ Redis polling)');
    }
  }

  async onModuleInit() {
    if (this.driver !== 'bullmq' || !this.queue) {
      return;
    }
    await this.pruneHistory();
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
    if (this.driver === 'inline' || !this.queue) {
      this.enqueueInline(name, data, options);
      return;
    }
    await this.queue.add(name, data, {
      ...DEFAULT_JOB_OPTS,
      ...options,
    });
  }

  async schedule(name: JobName, everyMs: number, data: Record<string, string> = {}) {
    if (this.driver === 'inline' || !this.queue) {
      const existing = this.intervals.get(name);
      if (existing) {
        clearInterval(existing);
      }
      const handle = setInterval(() => {
        void this.runInline(name, data);
      }, everyMs);
      // Unref so the timer does not keep the process alive on shutdown in tests.
      handle.unref?.();
      this.intervals.set(name, handle);
      return;
    }
    try {
      await this.queue.upsertJobScheduler(
        name,
        { every: everyMs },
        {
          name,
          data,
          opts: { ...DEFAULT_JOB_OPTS },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'scheduler upsert failed';
      this.logger.warn(message);
    }
  }

  registerWorker(processor: JobProcessor) {
    this.processor = processor;
    if (this.driver !== 'bullmq' || this.config.get('NODE_ENV') === 'test') {
      return;
    }
    const worker = new Worker(
      'opsbridge',
      async (job) => {
        await processor(job.name, job.data as Record<string, string>);
      },
      {
        connection: this.connection(),
        // Less aggressive Redis polling (still expensive on Upstash free).
        stalledInterval: 60_000,
        lockDuration: 30_000,
        drainDelay: 15,
        concurrency: 2,
      },
    );
    worker.on('failed', (job, error) => {
      this.logger.warn(`Job ${job?.name ?? 'unknown'} failed: ${error.message}`);
    });
    this.workers.push(worker);
  }

  /** Remove completed/failed job records so Redis memory can recover on free tiers. */
  async pruneHistory(graceMs = 0) {
    if (!this.queue) {
      return;
    }
    try {
      const [completed, failed] = await Promise.all([
        this.queue.clean(graceMs, 1000, 'completed'),
        this.queue.clean(graceMs, 1000, 'failed'),
      ]);
      if (completed.length || failed.length) {
        this.logger.log(
          `Pruned BullMQ history: ${completed.length} completed, ${failed.length} failed`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'queue prune failed';
      this.logger.warn(message);
    }
  }

  async onModuleDestroy() {
    for (const handle of this.delayed.values()) {
      clearTimeout(handle);
    }
    this.delayed.clear();
    for (const handle of this.intervals.values()) {
      clearInterval(handle);
    }
    this.intervals.clear();

    await Promise.all(this.workers.map((worker) => worker.close()));
    if (this.queue) {
      await this.queue.close();
    }
    await Promise.all(
      this.clients.map(async (client) => {
        try {
          if (client.status !== 'end') {
            await client.quit();
          }
        } catch {
          client.disconnect();
        }
      }),
    );
  }

  private enqueueInline(name: JobName, data: Record<string, string>, options?: JobsOptions) {
    const delay = typeof options?.delay === 'number' ? options.delay : 0;
    const jobId = typeof options?.jobId === 'string' ? options.jobId : `anon-${++this.delaySeq}`;

    if (this.delayed.has(jobId)) {
      // Match BullMQ custom jobId uniqueness.
      return;
    }

    if (delay <= 0) {
      void this.runInline(name, data);
      return;
    }

    const handle = setTimeout(() => {
      this.delayed.delete(jobId);
      void this.runInline(name, data);
    }, delay);
    handle.unref?.();
    this.delayed.set(jobId, handle);
  }

  private async runInline(name: string, data: Record<string, string>) {
    if (!this.processor) {
      this.logger.warn(`No worker registered for inline job ${name}`);
      return;
    }
    try {
      await this.processor(name, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'inline job failed';
      this.logger.warn(`Inline job ${name} failed: ${message}`);
    }
  }

  private connection(): ConnectionOptions {
    const client = new IORedis(this.config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.clients.push(client);
    return client;
  }
}
