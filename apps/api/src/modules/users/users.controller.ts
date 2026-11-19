import { Body, Controller, Patch } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { updateProfileSchema, type UpdateProfileInput, type UserProfile } from '@fieldops/shared';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiCookieAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch('me')
  updateProfile(
    @CurrentUser() user: UserProfile,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
  ) {
    return this.users.updateProfile(user.id, body);
  }
}
