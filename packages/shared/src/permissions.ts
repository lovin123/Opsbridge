import { z } from 'zod';

export const dataScopes = ['ORG', 'SITE', 'ASSIGNED'] as const;
export const dataScopeSchema = z.enum(dataScopes);
export type DataScope = z.infer<typeof dataScopeSchema>;

export const permissions = [
  'org.settings.manage',
  'org.members.manage',
  'org.roles.manage',
  'sites.manage',
  'sites.view',
  'teams.manage',
  'teams.view',
  'workforce.view',
  'shifts.manage',
  'shifts.view',
  'handovers.draft',
  'handovers.publish',
  'handovers.view',
  'incidents.create',
  'incidents.assign',
  'incidents.update_any',
  'incidents.view',
  'analytics.view',
  'communications.view',
] as const;

export const permissionSchema = z.enum(permissions);
export type Permission = z.infer<typeof permissionSchema>;

export const permissionLabels: Record<Permission, string> = {
  'org.settings.manage': 'Manage organization settings',
  'org.members.manage': 'Manage members and invitations',
  'org.roles.manage': 'Manage custom roles',
  'sites.manage': 'Create and edit sites',
  'sites.view': 'View sites',
  'teams.manage': 'Create and edit teams',
  'teams.view': 'View teams',
  'workforce.view': 'View workforce directory',
  'shifts.manage': 'Create and edit shifts',
  'shifts.view': 'View shifts',
  'handovers.draft': 'Draft shift handovers',
  'handovers.publish': 'Publish shift handovers',
  'handovers.view': 'View handovers',
  'incidents.create': 'Create incidents',
  'incidents.assign': 'Assign incidents',
  'incidents.update_any': 'Update any incident',
  'incidents.view': 'View incidents',
  'analytics.view': 'View analytics',
  'communications.view': 'Use communications',
};

export const permissionGroups: Array<{ label: string; keys: Permission[] }> = [
  {
    label: 'Organization',
    keys: ['org.settings.manage', 'org.members.manage', 'org.roles.manage'],
  },
  {
    label: 'Sites & teams',
    keys: ['sites.manage', 'sites.view', 'teams.manage', 'teams.view', 'workforce.view'],
  },
  {
    label: 'Shifts & handovers',
    keys: [
      'shifts.manage',
      'shifts.view',
      'handovers.draft',
      'handovers.publish',
      'handovers.view',
    ],
  },
  {
    label: 'Incidents',
    keys: ['incidents.create', 'incidents.assign', 'incidents.update_any', 'incidents.view'],
  },
  {
    label: 'Insights & chat',
    keys: ['analytics.view', 'communications.view'],
  },
];

const allPermissions = [...permissions];

export const roleTemplateDefaults: Record<
  'ORG_ADMIN' | 'OPERATIONS_MANAGER' | 'SUPERVISOR' | 'TECHNICIAN',
  { dataScope: DataScope; permissions: Permission[]; name: string; slug: string }
> = {
  ORG_ADMIN: {
    name: 'Organization admin',
    slug: 'org-admin',
    dataScope: 'ORG',
    permissions: allPermissions,
  },
  OPERATIONS_MANAGER: {
    name: 'Operations manager',
    slug: 'operations-manager',
    dataScope: 'ORG',
    permissions: [
      'org.settings.manage',
      'sites.manage',
      'sites.view',
      'teams.manage',
      'teams.view',
      'workforce.view',
      'shifts.manage',
      'shifts.view',
      'handovers.draft',
      'handovers.publish',
      'handovers.view',
      'incidents.create',
      'incidents.assign',
      'incidents.update_any',
      'incidents.view',
      'analytics.view',
      'communications.view',
    ],
  },
  SUPERVISOR: {
    name: 'Supervisor',
    slug: 'supervisor',
    dataScope: 'SITE',
    permissions: [
      'sites.view',
      'teams.view',
      'workforce.view',
      'shifts.manage',
      'shifts.view',
      'handovers.draft',
      'handovers.publish',
      'handovers.view',
      'incidents.create',
      'incidents.assign',
      'incidents.update_any',
      'incidents.view',
      'analytics.view',
      'communications.view',
    ],
  },
  TECHNICIAN: {
    name: 'Technician',
    slug: 'technician',
    dataScope: 'ASSIGNED',
    permissions: [
      'sites.view',
      'teams.view',
      'shifts.view',
      'handovers.view',
      'incidents.view',
      'communications.view',
    ],
  },
};

export function hasPermission(
  granted: readonly string[] | null | undefined,
  required: Permission | Permission[],
): boolean {
  const set = new Set(granted ?? []);
  const keys = Array.isArray(required) ? required : [required];
  return keys.every((key) => set.has(key));
}

export function sanitizePermissions(input: string[]): Permission[] {
  const allowed = new Set<string>(permissions);
  return [...new Set(input.filter((item): item is Permission => allowed.has(item)))];
}

export const createOrgRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  baseRole: z.enum(['ORG_ADMIN', 'OPERATIONS_MANAGER', 'SUPERVISOR', 'TECHNICIAN']),
  dataScope: dataScopeSchema,
  permissions: z.array(permissionSchema).min(1).max(permissions.length),
});

export const updateOrgRoleSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  permissions: z.array(permissionSchema).min(1).max(permissions.length).optional(),
});

export const assignMemberOrgRoleSchema = z.object({
  orgRoleId: z.string().uuid(),
});

export const createInvitationSchemaWithRole = z.object({
  email: z.string().trim().email('Enter a valid email').max(254),
  orgRoleId: z.string().uuid(),
});

export type CreateOrgRoleInput = z.infer<typeof createOrgRoleSchema>;
export type UpdateOrgRoleInput = z.infer<typeof updateOrgRoleSchema>;
export type AssignMemberOrgRoleInput = z.infer<typeof assignMemberOrgRoleSchema>;
