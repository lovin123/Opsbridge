import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { isAllowedOrigin } from '../origin';
import { SKIP_ORIGIN } from './skip-origin.decorator';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ORIGIN, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(request.method)) {
      return true;
    }

    const allowed = this.config
      .getOrThrow<string>('WEB_ORIGIN')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    const port = this.config.getOrThrow<number>('API_PORT');
    allowed.push(`http://localhost:${port}`);

    const origin = request.header('origin');
    if (!isAllowedOrigin(origin, allowed)) {
      throw new ForbiddenException('Origin is not allowed');
    }

    return true;
  }
}
