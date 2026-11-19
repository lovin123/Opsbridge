import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signinSchema,
  signupSchema,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type SigninInput,
  type SignupInput,
  type UserProfile,
} from '@fieldops/shared';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/authenticated-request';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Public } from '../../common/auth/public.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 500 : 10, ttl: 60_000 } })
  @ApiOkResponse({ description: 'Creates an account and session cookie' })
  signup(
    @Body(new ZodValidationPipe(signupSchema)) body: SignupInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.signup(body, response, this.meta(request));
  }

  @Public()
  @Post('signin')
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 500 : 10, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOkResponse({ description: 'Signs in and sets a session cookie' })
  signin(
    @Body(new ZodValidationPipe(signinSchema)) body: SigninInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.signin(body, response, this.meta(request));
  }

  @Post('signout')
  @HttpCode(204)
  @ApiCookieAuth()
  async signout(
    @CurrentUser() user: UserProfile,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.signout(request.sessionId ?? '', user.id, response);
  }

  @Public()
  @Post('forgot-password')
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 500 : 10, ttl: 60_000 } })
  @HttpCode(200)
  forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput) {
    return this.auth.forgotPassword(body);
  }

  @Public()
  @Post('reset-password')
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 500 : 10, ttl: 60_000 } })
  @HttpCode(200)
  resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput) {
    return this.auth.resetPassword(body);
  }

  @Get('me')
  @ApiCookieAuth()
  me(@CurrentUser() user: UserProfile) {
    return this.auth.sessionFor(user.id);
  }

  private meta(request: Request): { userAgent?: string; ipAddress?: string } {
    return {
      userAgent: request.header('user-agent'),
      ipAddress: request.ip,
    };
  }
}
