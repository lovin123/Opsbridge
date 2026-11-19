import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
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
  ) {}

  @Public()
  @Get()
  @ApiOkResponse({ description: 'Database and Redis are reachable' })
  async check() {
    const database = await this.pingDatabase();
    const redis = await this.pingRedis();
    const body = {
      status: database === 'up' && redis === 'up' ? 'ok' : 'degraded',
      database,
      redis,
    };

    if (body.status !== 'ok') {
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
