import type { MemberRole, Permission } from '@fieldops/shared';
import { roleTemplateDefaults, sanitizePermissions } from '@fieldops/shared';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export async function ensureSystemOrgRoles(tx: Tx, organizationId: string) {
  const templates = Object.entries(roleTemplateDefaults) as Array<
    [MemberRole, (typeof roleTemplateDefaults)[MemberRole]]
  >;
  for (const [baseRole, template] of templates) {
    await tx.organizationRole.upsert({
      where: {
        organizationId_slug: { organizationId, slug: template.slug },
      },
      update: {},
      create: {
        organizationId,
        name: template.name,
        slug: template.slug,
        baseRole,
        dataScope: template.dataScope,
        permissions: template.permissions,
        system: true,
      },
    });
  }
}

export async function resolveOrgRole(
  tx: Tx,
  organizationId: string,
  input: { orgRoleId?: string; role?: MemberRole },
) {
  if (input.orgRoleId) {
    const role = await tx.organizationRole.findFirst({
      where: { id: input.orgRoleId, organizationId },
    });
    if (!role) {
      return null;
    }
    return role;
  }
  if (input.role) {
    const template = roleTemplateDefaults[input.role];
    return tx.organizationRole.findFirst({
      where: { organizationId, slug: template.slug, system: true },
    });
  }
  return null;
}

export function asPermissionList(values: string[]): Permission[] {
  return sanitizePermissions(values);
}

export function slugifyRoleName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'role';
}
