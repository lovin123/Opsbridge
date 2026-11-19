import {
  hasPermission as sharedHasPermission,
  type MembershipSummary,
  type Permission,
  type SessionResponse,
} from "@fieldops/shared";

export function membershipHasPermission(
  membership: MembershipSummary | null | undefined,
  required: Permission | Permission[],
) {
  return sharedHasPermission(membership?.permissions, required);
}

export function sessionMembership(
  session: SessionResponse | null | undefined,
  organizationId: string | null | undefined,
) {
  if (!session) return null;
  return (
    session.memberships.find((item) => item.organization.id === organizationId) ??
    session.memberships[0] ??
    null
  );
}
