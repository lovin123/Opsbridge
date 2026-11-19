import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { OrganizationGuard } from './common/auth/organization.guard';
import { OriginGuard } from './common/auth/origin.guard';
import { PermissionsGuard } from './common/auth/permissions.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { SessionGuard } from './common/auth/session.guard';
import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MediaModule } from './modules/media/media.module';
import { NexconnModule } from './modules/nexconn/nexconn.module';
import { OperationsModule } from './modules/operations/operations.module';
import { WorkforceModule } from './modules/workforce/workforce.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { QueueModule } from './queue/queue.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UsersModule } from './modules/users/users.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    MailModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const env = config.getOrThrow<string>('NODE_ENV');
        return {
          pinoHttp: {
            level: env === 'test' ? 'silent' : 'info',
            autoLogging: env !== 'test',
            redact: ['req.headers.cookie', 'req.headers.authorization'],
            transport:
              env === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
          },
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: 60_000,
            limit: config.getOrThrow<string>('NODE_ENV') === 'test' ? 1000 : 120,
          },
        ],
      }),
    }),
    PrismaModule,
    RedisModule,
    QueueModule,
    AuditModule,
    HealthModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    NexconnModule,
    WorkforceModule,
    IncidentsModule,
    MediaModule,
    OperationsModule,
    JobsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: OrganizationGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
