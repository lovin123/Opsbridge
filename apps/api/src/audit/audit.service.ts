import { Injectable } from '@nestjs/common';
import type { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  organizationId?: string | null;
  actorId?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(entry: AuditEntry, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    return db.auditLog.create({
      data: {
        organizationId: entry.organizationId ?? null,
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata,
      },
    });
  }
}
