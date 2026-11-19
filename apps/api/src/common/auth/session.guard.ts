import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { UserProfile } from '@fieldops/shared';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { setSessionCookie } from '../cookies';
import { hashToken } from '../tokens';
import type { AuthenticatedRequest } from './authenticated-request';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookieName = this.config.getOrThrow<string>('SESSION_COOKIE_NAME');
    const token = request.cookies?.[cookieName] as string | undefined;
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Authentication required');
    }

    const ttlHours = this.config.getOrThrow<number>('SESSION_TTL_HOURS');
    const ttlMs = ttlHours * 60 * 60 * 1000;
    const remaining = session.expiresAt.getTime() - Date.now();
    if (remaining < ttlMs * 0.25) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() + ttlMs) },
      });
      const response = context.switchToHttp().getResponse<Response>();
      setSessionCookie(
        response,
        cookieName,
        token,
        ttlHours,
        this.config.getOrThrow<string>('NODE_ENV') === 'production',
      );
    }

    const user: UserProfile = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      phone: session.user.phone,
      jobTitle: session.user.jobTitle,
      nexconnUserId: session.user.nexconnUserId,
    };
    request.user = user;
    request.sessionId = session.id;
    return true;
  }
}
