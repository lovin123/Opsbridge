import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cap Prisma's connection pool for free-tier managed Postgres (Aiven etc.).
 * Each open PG connection consumes meaningful server RAM; unbounded pools
 * (Prisma default ≈ num_cpus*2+1) are a common cause of "memory full" alerts.
 */
function databaseUrlWithPoolLimits(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '5');
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '10');
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: {
          url: databaseUrlWithPoolLimits(process.env.DATABASE_URL ?? ''),
        },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
