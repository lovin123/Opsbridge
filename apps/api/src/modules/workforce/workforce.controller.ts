import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import {
  createShiftSchema,
  createSiteSchema,
  createTeamSchema,
  updateAvailabilitySchema,
  updateTeamSchema,
  type CreateShiftInput,
  type CreateSiteInput,
  type CreateTeamInput,
  type UpdateAvailabilityInput,
  type UpdateTeamInput,
  type UserProfile,
} from '@fieldops/shared';
import type { RequestMembership } from '../../common/auth/authenticated-request';
import { CurrentMembership, CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { RequireOrg } from '../../common/auth/require-org.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { WorkforceService } from './workforce.service';

@ApiTags('workforce')
@ApiCookieAuth()
@RequireOrg()
@Controller()
export class WorkforceController {
  constructor(private readonly workforce: WorkforceService) {}

  @Get('sites')
  sites(@CurrentMembership() membership: RequestMembership) {
    return this.workforce.sites(membership.organizationId);
  }

  @RequirePermissions('sites.manage')
  @Post('sites')
  createSite(
    @CurrentMembership() membership: RequestMembership,
    @Body(new ZodValidationPipe(createSiteSchema)) body: CreateSiteInput,
  ) {
    return this.workforce.createSite(membership.organizationId, body);
  }

  @Get('teams')
  teams(@CurrentMembership() membership: RequestMembership) {
    return this.workforce.teams(membership.organizationId);
  }

  @RequirePermissions('teams.manage')
  @Post('teams')
  createTeam(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Body(new ZodValidationPipe(createTeamSchema)) body: CreateTeamInput,
  ) {
    return this.workforce.createTeam(membership.organizationId, user.id, body);
  }

  @RequirePermissions('teams.manage')
  @Patch('teams/:teamId')
  updateTeam(
    @CurrentMembership() membership: RequestMembership,
    @Param('teamId') teamId: string,
    @Body(new ZodValidationPipe(updateTeamSchema)) body: UpdateTeamInput,
  ) {
    return this.workforce.updateTeam(membership.organizationId, teamId, body);
  }

  @Get('shifts')
  shifts(@CurrentMembership() membership: RequestMembership) {
    return this.workforce.shifts(membership.organizationId);
  }

  @RequirePermissions('shifts.manage')
  @Post('shifts')
  createShift(
    @CurrentMembership() membership: RequestMembership,
    @Body(new ZodValidationPipe(createShiftSchema)) body: CreateShiftInput,
  ) {
    return this.workforce.createShift(membership.organizationId, body);
  }

  @Get('workforce/me')
  me(@CurrentUser() user: UserProfile, @CurrentMembership() membership: RequestMembership) {
    return this.workforce.myProfile(membership.organizationId, user.id);
  }

  @Patch('workforce/me')
  availability(
    @CurrentUser() user: UserProfile,
    @CurrentMembership() membership: RequestMembership,
    @Body(new ZodValidationPipe(updateAvailabilitySchema)) body: UpdateAvailabilityInput,
  ) {
    return this.workforce.updateAvailability(membership.organizationId, user.id, body);
  }

  @Get('workforce/directory')
  directory(@CurrentMembership() membership: RequestMembership) {
    return this.workforce.directory(membership.organizationId);
  }
}
