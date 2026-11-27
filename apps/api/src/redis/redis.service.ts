import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  private connectAttempted = false;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      lazyConnect: true,
      // Upstash free often blocks after quota; don't spam reconnect.
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    });
    this.client.on('error', (error) => {
      // Avoid crashing Nest on Upstash quota / network errors.
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.client.status === 'wait') {
      this.connectAttempted = true;
      try {
        await this.client.connect();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'connect failed';
        this.logger.warn(`Redis unavailable at startup: ${message}`);
      }
    }
  }

  async ping(): Promise<string> {
    if (this.client.status !== 'ready') {
      if (!this.connectAttempted && this.client.status === 'wait') {
        try {
          await this.client.connect();
        } catch {
          throw new Error('redis not connected');
        }
      } else {
        throw new Error('redis not connected');
      }
    }
    return this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'end') {
      return;
    }
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
