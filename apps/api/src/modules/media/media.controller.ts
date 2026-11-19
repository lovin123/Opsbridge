import { Body, Controller, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import {
  confirmUploadSchema,
  signUploadSchema,
  type ConfirmUploadInput,
  type SignUploadInput,
  type UserProfile,
} from '@fieldops/shared';
import type { RequestMembership } from '../../common/auth/authenticated-request';
import { CurrentMembership, CurrentUser } from '../../common/auth/current-user.decorator';
import { RequireOrg } from '../../common/auth/require-org.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { MediaService } from './media.service';

@ApiTags('media')
@ApiCookieAuth()
@RequireOrg()
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('sign')
  sign(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Body(new ZodValidationPipe(signUploadSchema)) body: SignUploadInput,
  ) {
    return this.media.sign(membership.organizationId, user.id, body, membership.dataScope);
  }

  @Post('confirm')
  confirm(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Body(new ZodValidationPipe(confirmUploadSchema)) body: ConfirmUploadInput,
  ) {
    return this.media.confirm(membership.organizationId, user.id, body);
  }
}
