import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { randomUUID } from 'crypto';
import type { ConfirmUploadInput, DataScope, MediaPurpose, SignUploadInput } from '@fieldops/shared';
import { PrismaService } from '../../prisma/prisma.service';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

@Injectable()
export class MediaService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  configured() {
    return Boolean(
      this.config.get('CLOUDINARY_CLOUD_NAME') &&
        this.config.get('CLOUDINARY_API_KEY') &&
        this.config.get('CLOUDINARY_API_SECRET'),
    );
  }

  async sign(
    organizationId: string,
    userId: string,
    input: SignUploadInput,
    dataScope: DataScope = 'ORG',
  ) {
    this.assertConfigured();
    if (!ALLOWED_MIME.has(input.mimeType)) {
      throw new BadRequestException('This file type is not allowed');
    }
    if (input.incidentId) {
      const where: {
        id: string;
        organizationId: string;
        siteId?: string;
        OR?: Array<{ assigneeId: string } | { createdById: string }>;
      } = { id: input.incidentId, organizationId };
      if (dataScope === 'ASSIGNED') {
        where.OR = [{ assigneeId: userId }, { createdById: userId }];
      } else if (dataScope === 'SITE') {
        const profile = await this.prisma.workforceProfile.findUnique({
          where: { organizationId_userId: { organizationId, userId } },
        });
        if (profile?.siteId) {
          where.siteId = profile.siteId;
        } else {
          where.OR = [{ assigneeId: userId }, { createdById: userId }];
        }
      }
      const incident = await this.prisma.incident.findFirst({ where });
      if (!incident) {
        throw new BadRequestException('Incident not found in this organization');
      }
    }
    const folder = this.folder(organizationId, input.purpose, input.incidentId);
    // Sign the leaf id + folder separately. Sending both a full-path public_id and
    // folder makes Cloudinary nest the path twice.
    const assetKey = randomUUID().replace(/-/g, '');
    const publicId = `${folder}/${assetKey}`;
    const timestamp = Math.round(Date.now() / 1000);
    const params = { timestamp, folder, public_id: assetKey, type: 'authenticated' };
    const apiSecret = this.config.getOrThrow<string>('CLOUDINARY_API_SECRET');
    const signature = cloudinary.utils.api_sign_request(params, apiSecret);
    const grant = await this.prisma.uploadGrant.create({
      data: {
        organizationId,
        publicId,
        folder,
        purpose: input.purpose,
        incidentId: input.incidentId,
        createdById: userId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return {
      grantId: grant.id,
      signature,
      timestamp,
      folder,
      publicId: assetKey,
      fullPublicId: publicId,
      apiKey: this.config.getOrThrow<string>('CLOUDINARY_API_KEY'),
      cloudName: this.config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
      type: 'authenticated',
      mimeType: input.mimeType,
    };
  }

  async confirm(organizationId: string, userId: string, input: ConfirmUploadInput) {
    this.assertConfigured();
    const grant = await this.prisma.uploadGrant.findFirst({
      where: { id: input.grantId, organizationId, createdById: userId, usedAt: null },
    });
    if (!grant || grant.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Upload authorization is invalid');
    }
    // Cloudinary may append a format suffix (e.g. ".pdf") to the signed public_id.
    if (!this.publicIdsMatch(grant.publicId, input.publicId)) {
      throw new BadRequestException('Uploaded asset does not match the authorization');
    }
    this.configureSdk();
    const storedPublicId = input.publicId;
    const deliveryType = await this.resolveDeliveryType(storedPublicId, input.resourceType);
    const mimeType =
      input.mimeType && ALLOWED_MIME.has(input.mimeType) ? input.mimeType : 'application/octet-stream';
    const filename =
      input.filename?.trim() ||
      storedPublicId.split('/').pop()?.replace(/\.[^/.]+$/, '') ||
      'file';
    const asset = await this.prisma.$transaction(async (tx) => {
      await tx.uploadGrant.update({ where: { id: grant.id }, data: { usedAt: new Date() } });
      return tx.mediaAsset.create({
        data: {
          organizationId,
          publicId: storedPublicId,
          assetId: input.assetId,
          resourceType: `${input.resourceType}:${deliveryType}`,
          format: input.format,
          filename,
          mimeType,
          bytes: input.bytes,
          width: input.width,
          height: input.height,
          duration: input.duration,
          purpose: grant.purpose,
          incidentId: grant.incidentId,
          uploadedById: userId,
        },
      });
    });
    return { id: asset.id, publicId: asset.publicId };
  }

  deliveryUrl(publicId: string, resourceType: string) {
    this.assertConfigured();
    this.configureSdk();
    const [kind, deliveryType = 'authenticated'] = resourceType.split(':');
    return cloudinary.url(publicId, {
      sign_url: true,
      type: deliveryType,
      resource_type: kind,
      secure: true,
      fetch_format: kind === 'image' ? 'auto' : undefined,
      quality: kind === 'image' ? 'auto' : undefined,
    });
  }

  async cleanupExpiredGrants() {
    const expired = await this.prisma.uploadGrant.findMany({
      where: { usedAt: null, expiresAt: { lt: new Date() } },
      take: 100,
    });
    if (expired.length === 0) {
      return 0;
    }
    await this.prisma.uploadGrant.deleteMany({ where: { id: { in: expired.map((grant) => grant.id) } } });
    return expired.length;
  }

  private folder(organizationId: string, purpose: MediaPurpose, incidentId?: string) {
    if (incidentId) {
      return `opsbridge/${organizationId}/incidents/${incidentId}`;
    }
    if (purpose === 'PROFILE') {
      return `opsbridge/${organizationId}/users`;
    }
    if (purpose === 'TEAM_LOGO') {
      return `opsbridge/${organizationId}/teams`;
    }
    return `opsbridge/${organizationId}/sites`;
  }

  private publicIdsMatch(granted: string, uploaded: string) {
    return uploaded === granted || uploaded.startsWith(`${granted}.`);
  }

  private async resolveDeliveryType(publicId: string, resourceType: string) {
    for (const type of ['authenticated', 'upload', 'private'] as const) {
      try {
        const resource = (await cloudinary.api.resource(publicId, {
          resource_type: resourceType,
          type,
        })) as { public_id?: string };
        if (resource.public_id && this.publicIdsMatch(resource.public_id, publicId)) {
          return type;
        }
      } catch (error: unknown) {
        const status =
          typeof error === 'object' && error && 'http_code' in error
            ? Number((error as { http_code?: number }).http_code)
            : undefined;
        if (status !== 404) {
          throw error;
        }
      }
    }
    throw new BadRequestException('Uploaded asset was not found in Cloudinary');
  }

  private configureSdk() {
    cloudinary.config({
      cloud_name: this.config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.config.getOrThrow<string>('CLOUDINARY_API_KEY'),
      api_secret: this.config.getOrThrow<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
  }

  private assertConfigured() {
    if (!this.configured()) {
      throw new ServiceUnavailableException('Cloudinary is not configured');
    }
  }
}
