import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import {
  createIncidentSchema,
  updateIncidentStatusSchema,
  type CreateIncidentInput,
  type UpdateIncidentStatusInput,
  type UserProfile,
} from '@fieldops/shared';
import { z } from 'zod';
import type { RequestMembership } from '../../common/auth/authenticated-request';
import { CurrentMembership, CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { RequireOrg } from '../../common/auth/require-org.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { IncidentsService } from './incidents.service';

const assignSchema = z.object({
  assigneeId: z.string().uuid().nullable(),
  teamId: z.string().uuid().nullable().optional(),
});

@ApiTags('incidents')
@ApiCookieAuth()
@RequireOrg()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  list(@CurrentUser() user: UserProfile, @CurrentMembership() membership: RequestMembership) {
    return this.incidents.list({ user, membership });
  }

  @Get(':id')
  get(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Param('id') id: string,
  ) {
    return this.incidents.get({ user, membership }, id);
  }

  @RequirePermissions('incidents.create')
  @Post()
  create(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Body(new ZodValidationPipe(createIncidentSchema)) body: CreateIncidentInput,
  ) {
    return this.incidents.create({ user, membership }, body);
  }

  @RequirePermissions('incidents.assign')
  @Patch(':id/assignment')
  assign(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignSchema)) body: z.infer<typeof assignSchema>,
  ) {
    return this.incidents.assign({ user, membership }, id, body);
  }

  @RequirePermissions('incidents.update_any')
  @Post(':id/channel')
  retryChannel(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Param('id') id: string,
  ) {
    return this.incidents.retryChannel({ user, membership }, id);
  }

  @Patch(':id/status')
  status(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateIncidentStatusSchema)) body: UpdateIncidentStatusInput,
  ) {
    return this.incidents.changeStatus({ user, membership }, id, body);
  }
}
