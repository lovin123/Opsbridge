import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import {
  acceptInvitationSchema,
  type AcceptInvitationInput,
  type UserProfile,
} from '@fieldops/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { OrganizationsService } from './organizations.service';

@ApiTags('invitations')
@ApiCookieAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post('accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: UserProfile,
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
  ) {
    return this.organizations.accept(user, body);
  }
}
