import { Injectable } from '@nestjs/common';
import type { UpdateProfileInput, UserProfile } from '@fieldops/shared';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserProfile> {
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          name: input.name,
          phone: blankToNull(input.phone),
          jobTitle: blankToNull(input.jobTitle),
        },
      });
      await this.audit.record(
        {
          actorId: userId,
          action: 'PROFILE_UPDATED',
          targetType: 'User',
          targetId: userId,
        },
        tx,
      );
      return updated;
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      jobTitle: user.jobTitle,
      nexconnUserId: user.nexconnUserId,
    };
  }
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
