import { Body, Controller, Get, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { UserProfile } from '@fieldops/shared';
import { CurrentMembership, CurrentUser } from '../../common/auth/current-user.decorator';
import { Public } from '../../common/auth/public.decorator';
import { RequireOrg } from '../../common/auth/require-org.decorator';
import { SkipOrigin } from '../../common/auth/skip-origin.decorator';
import type { RequestMembership } from '../../common/auth/authenticated-request';
import { signaturesMatch, nexconnSignature } from './signature';
import { NexconnService } from './nexconn.service';

interface WebhookBody {
  type?: string;
  id?: string;
  data?: Array<Record<string, unknown>>;
}

@ApiTags('nexconn')
@Controller('nexconn')
export class NexconnController {
  constructor(
    private readonly nexconn: NexconnService,
    private readonly config: ConfigService,
  ) {}

  @Post('token')
  @ApiCookieAuth()
  token(@CurrentUser() user: UserProfile) {
    return this.nexconn.tokenForUser(user.id);
  }

  @Public()
  @SkipOrigin()
  @SkipThrottle()
  @Post('webhooks')
  @HttpCode(200)
  async webhook(
    @Headers('appkey') appKey: string | undefined,
    @Headers('nonce') nonce: string | undefined,
    @Headers('timestamp') timestamp: string | undefined,
    @Headers('signature') signature: string | undefined,
    @Body() body: WebhookBody,
  ) {
    const secret = this.config.get<string>('NEXCONN_APP_SECRET') || '';
    const expectedKey = this.config.get<string>('NEXCONN_APP_KEY') || '';
    if (!secret || !appKey || !nonce || !timestamp || !signature || appKey !== expectedKey) {
      throw new UnauthorizedException('Webhook signature is invalid');
    }
    const age = Math.abs(Date.now() - Number(timestamp));
    if (!Number.isFinite(age) || age > 5 * 60 * 1000) {
      throw new UnauthorizedException('Webhook timestamp is stale');
    }
    if (!signaturesMatch(nexconnSignature(secret, nonce, timestamp), signature.toLowerCase())) {
      throw new UnauthorizedException('Webhook signature is invalid');
    }
    if (!body.id || !body.type) {
      return { ok: true };
    }
    await this.nexconn.handleWebhook({
      id: body.id,
      type: body.type,
      data: Array.isArray(body.data) ? body.data : [],
    });
    return { ok: true };
  }

  @Get('people')
  @ApiCookieAuth()
  @RequireOrg()
  people(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
  ) {
    return this.nexconn.people(
      membership.organizationId,
      user.id,
      membership.role,
      membership.dataScope,
    );
  }

  @Post('profiles')
  @ApiCookieAuth()
  @RequireOrg()
  profiles(
    @CurrentMembership() membership: RequestMembership,
    @Body() body: { userIds?: string[]; groupIds?: string[] },
  ) {
    return this.nexconn.profiles(membership.organizationId, {
      userIds: Array.isArray(body?.userIds) ? body.userIds.map(String) : [],
      groupIds: Array.isArray(body?.groupIds) ? body.groupIds.map(String) : [],
    });
  }

  @Post('group-members')
  @ApiCookieAuth()
  @RequireOrg()
  groupMembers(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Body() body: { groupId?: string },
  ) {
    return this.nexconn.groupMembers(
      membership.organizationId,
      String(body?.groupId ?? ''),
      user.id,
      membership.role,
      membership.dataScope,
    );
  }

  @Get('channels')
  @ApiCookieAuth()
  @RequireOrg()
  channels(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
  ) {
    return this.nexconn.channels(
      membership.organizationId,
      user.id,
      membership.role,
      membership.dataScope,
    );
  }
}
