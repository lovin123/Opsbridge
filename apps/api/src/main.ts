import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  app.useLogger(app.get(Logger));
  app.use(cookieParser());
  app.use((_req: unknown, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    next();
  });
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: [
      ...config
        .getOrThrow<string>('WEB_ORIGIN')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      `http://localhost:${config.getOrThrow<number>('API_PORT')}`,
    ],
    credentials: true,
  });

  const swagger = new DocumentBuilder()
    .setTitle('Opsbridge API')
    .setDescription('Workforce operations API. Phase 1 covers identity, organizations, and RBAC.')
    .setVersion('0.1.0')
    .addCookieAuth(config.getOrThrow<string>('SESSION_COOKIE_NAME'))
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  const config = app.get(ConfigService);
  await app.listen(config.getOrThrow<number>('API_PORT'));
}

if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
