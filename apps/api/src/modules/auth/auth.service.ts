import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ForgotPasswordInput,
  ForgotPasswordResponse,
  MembershipSummary,
  ResetPasswordInput,
  SessionResponse,
  SigninInput,
  SignupInput,
  UserProfile,
} from '@fieldops/shared';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { AuditService } from '../../audit/audit.service';
import { clearSessionCookie, setSessionCookie } from '../../common/cookies';
import { newUserIdentity } from '../../common/ids';
import { hashPassword, verifyPassword } from '../../common/password';
import { hashToken, newSecretToken } from '../../common/tokens';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';

const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async signup(
    input: SignupInput,
    response: Response,
    meta: { userAgent?: string; ipAddress?: string },
  ): Promise<SessionResponse> {
    const email = input.email.toLowerCase();
    const passwordHash = await hashPassword(input.password);
    const identity = newUserIdentity();

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            id: identity.id,
            email,
            name: input.name,
            passwordHash,
            nexconnUserId: identity.nexconnUserId,
          },
        });
        await this.audit.record(
          {
            actorId: created.id,
            action: 'USER_SIGNED_UP',
            targetType: 'User',
            targetId: created.id,
          },
          tx,
        );
        return created;
      });

      return this.openSession(user, response, meta, 'USER_SIGNED_IN');
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
  }

  async signin(
    input: SigninInput,
    response: Response,
    meta: { userAgent?: string; ipAddress?: string },
  ): Promise<SessionResponse> {
    const email = input.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = user ? await verifyPassword(user.passwordHash, input.password) : false;
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.openSession(user, response, meta, 'USER_SIGNED_IN');
  }

  async signout(sessionId: string, actorId: string, response: Response): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { id: sessionId } });
      await this.audit.record(
        {
          actorId,
          action: 'USER_SIGNED_OUT',
          targetType: 'Session',
          targetId: sessionId,
        },
        tx,
      );
    });
    this.clearCookie(response);
  }

  async forgotPassword(input: ForgotPasswordInput): Promise<ForgotPasswordResponse> {
    const email = input.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const message = 'If an account exists, a reset link has been issued.';
    if (!user) {
      return { message };
    }

    const secret = newSecretToken();
    const resetUrl = `${this.config.getOrThrow<string>('WEB_ORIGIN')}/reset-password?token=${secret.token}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: secret.tokenHash,
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'PASSWORD_RESET_REQUESTED',
          targetType: 'User',
          targetId: user.id,
        },
        tx,
      );
    });

    try {
      await this.mail.sendPasswordReset({
        to: email,
        name: user.name,
        resetUrl,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Password reset email failed for ${email}: ${detail}`);
    }

    if (this.config.getOrThrow<string>('NODE_ENV') !== 'production') {
      this.logger.log(`Password reset link for ${email}: ${resetUrl}`);
      return { message, devResetUrl: resetUrl };
    }

    return { message };
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(input.token) },
    });

    if (!token || token.usedAt || token.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Reset link is invalid or expired');
    }

    const passwordHash = await hashPassword(input.password);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: token.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException('Reset link is invalid or expired');
      }
      await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      });
      await tx.session.deleteMany({ where: { userId: token.userId } });
      await this.audit.record(
        {
          actorId: token.userId,
          action: 'PASSWORD_RESET_COMPLETED',
          targetType: 'User',
          targetId: token.userId,
        },
        tx,
      );
    });

    return { message: 'Password updated. Sign in with the new password.' };
  }

  async sessionFor(userId: string): Promise<SessionResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      user: toProfile(user),
      memberships: await this.membershipsFor(userId),
    };
  }

  private async openSession(
    user: ProfileSource,
    response: Response,
    meta: { userAgent?: string; ipAddress?: string },
    action: 'USER_SIGNED_IN',
  ): Promise<SessionResponse> {
    const secret = newSecretToken();
    const ttlHours = this.config.getOrThrow<number>('SESSION_TTL_HOURS');
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: secret.tokenHash,
          expiresAt,
          userAgent: meta.userAgent?.slice(0, 255),
          ipAddress: meta.ipAddress?.slice(0, 64),
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action,
          targetType: 'Session',
          targetId: session.id,
        },
        tx,
      );
    });

    setSessionCookie(
      response,
      this.config.getOrThrow<string>('SESSION_COOKIE_NAME'),
      secret.token,
      ttlHours,
      this.config.getOrThrow<string>('NODE_ENV') === 'production',
    );

    return {
      user: toProfile(user),
      memberships: await this.membershipsFor(user.id),
    };
  }

  private clearCookie(response: Response): void {
    clearSessionCookie(
      response,
      this.config.getOrThrow<string>('SESSION_COOKIE_NAME'),
      this.config.getOrThrow<string>('NODE_ENV') === 'production',
    );
  }

  private async membershipsFor(userId: string): Promise<MembershipSummary[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, active: true },
      include: { organization: true, orgRole: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      id: membership.id,
      role: membership.role,
      orgRoleId: membership.orgRoleId,
      orgRoleName: membership.orgRole.name,
      dataScope: membership.orgRole.dataScope,
      permissions: membership.orgRole.permissions as MembershipSummary['permissions'],
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        industry: membership.organization.industry,
        timezone: membership.organization.timezone,
      },
    }));
  }
}

interface ProfileSource {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  jobTitle: string | null;
  nexconnUserId: string;
}

function toProfile(user: ProfileSource): UserProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    jobTitle: user.jobTitle,
    nexconnUserId: user.nexconnUserId,
  };
}
