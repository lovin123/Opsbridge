import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  @ApiOkResponse({ description: 'Database (and Redis when required) are reachable' })
  async check() {
    const database = await this.pingDatabase();
    const redis = await this.pingRedis();
    const queueDriver = this.config.get<string>('QUEUE_DRIVER') ?? 'inline';
    // Inline queue does not need Redis; do not 503 the API when Upstash quota is exhausted.
    const redisRequired = queueDriver === 'bullmq';
    const ok = database === 'up' && (!redisRequired || redis === 'up');
    const body = {
      status: ok ? 'ok' : 'degraded',
      database,
      redis,
      queueDriver,
    };

    if (!ok) {
      throw new ServiceUnavailableException(body);
    }

    return body;
  }

  private async pingDatabase(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async pingRedis(): Promise<'up' | 'down'> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
