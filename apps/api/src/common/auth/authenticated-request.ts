import type { DataScope, MemberRole, Permission, UserProfile } from '@fieldops/shared';
import type { Request } from 'express';

export interface RequestMembership {
  id: string;
  role: MemberRole;
  orgRoleId: string;
  orgRoleName: string;
  dataScope: DataScope;
  permissions: Permission[];
  organizationId: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    industry: string | null;
    timezone: string;
  };
}

export interface AuthenticatedRequest extends Request {
  user?: UserProfile;
  sessionId?: string;
  membership?: RequestMembership;
}
