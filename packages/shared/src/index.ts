import { z } from 'zod';

export const memberRoles = [
  'ORG_ADMIN',
  'OPERATIONS_MANAGER',
  'SUPERVISOR',
  'TECHNICIAN',
] as const;

export const memberRoleSchema = z.enum(memberRoles);

export type MemberRole = z.infer<typeof memberRoleSchema>;

export const roleLabels: Record<MemberRole, string> = {
  ORG_ADMIN: 'Organization admin',
  OPERATIONS_MANAGER: 'Operations manager',
  SUPERVISOR: 'Supervisor',
  TECHNICIAN: 'Technician',
};

export const invitationStatuses = ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] as const;

export const invitationStatusSchema = z.enum(invitationStatuses);

export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must include a letter')
  .regex(/[0-9]/, 'Password must include a number');

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: z.string().trim().email('Enter a valid email').max(254),
  password: passwordSchema,
});

export const signinSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required').max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Organization name is required').max(80),
  industry: z.string().trim().max(80).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

export const updateOrganizationSchema = createOrganizationSchema;

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  phone: z.string().trim().max(32).optional(),
  jobTitle: z.string().trim().max(80).optional(),
});

export const createInvitationSchema = z
  .object({
    email: z.string().trim().email('Enter a valid email').max(254),
    orgRoleId: z.string().uuid().optional(),
    role: memberRoleSchema.optional(),
  })
  .refine((value) => Boolean(value.orgRoleId || value.role), {
    message: 'Select a role',
    path: ['orgRoleId'],
  });

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
});

export const updateMemberRoleSchema = z
  .object({
    orgRoleId: z.string().uuid().optional(),
    role: memberRoleSchema.optional(),
  })
  .refine((value) => Boolean(value.orgRoleId || value.role), {
    message: 'Select a role',
    path: ['orgRoleId'],
  });

export type SignupInput = z.infer<typeof signupSchema>;
export type SigninInput = z.infer<typeof signinSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export * from './operations';
export * from './permissions';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  jobTitle: string | null;
  nexconnUserId: string;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  timezone: string;
}

export interface MembershipSummary {
  id: string;
  role: MemberRole;
  orgRoleId: string;
  orgRoleName: string;
  dataScope: import('./permissions').DataScope;
  permissions: import('./permissions').Permission[];
  organization: OrganizationSummary;
}

export interface SessionResponse {
  user: UserProfile;
  memberships: MembershipSummary[];
}

export interface OrganizationDetail extends OrganizationSummary {
  createdAt: string;
  memberCount: number;
  roleCounts: Record<MemberRole, number>;
  currentRole: MemberRole;
  currentOrgRoleId: string;
  currentOrgRoleName: string;
  currentDataScope: import('./permissions').DataScope;
  currentPermissions: import('./permissions').Permission[];
}

export interface MemberRecord {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  role: MemberRole;
  orgRoleId: string;
  orgRoleName: string;
  dataScope: import('./permissions').DataScope;
  permissions: import('./permissions').Permission[];
  joinedAt: string;
}

export interface InvitationRecord {
  id: string;
  email: string;
  role: MemberRole;
  orgRoleId: string;
  orgRoleName: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  acceptPath?: string;
}

export interface OrganizationRoleRecord {
  id: string;
  name: string;
  slug: string;
  baseRole: MemberRole;
  dataScope: import('./permissions').DataScope;
  permissions: import('./permissions').Permission[];
  system: boolean;
  memberCount: number;
  createdAt: string;
}

export interface ForgotPasswordResponse {
  message: string;
  devResetUrl?: string;
}
