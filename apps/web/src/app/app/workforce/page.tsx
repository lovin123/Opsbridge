"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { format } from "date-fns";
import {
  Badge,
  Box,
  Flex,
  Grid,
  Select,
  Table,
  Text,
} from "@radix-ui/themes";
import {
  createInvitationSchema,
  type CreateInvitationInput,
  type InvitationRecord,
  type MemberRecord,
  type OrganizationRoleRecord,
} from "@fieldops/shared";
import { useSession } from "@/components/providers";
import { useCurrentOrganization } from "@/components/app-shell";
import { Button, ErrorCallout, FieldError, InfoCallout, Input, Label } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { membershipHasPermission } from "@/lib/permissions";
import { EmptyState, LoadingBlock, PageHeader, PageStack, Panel } from "@/components/page";

function invitationStatusColor(
  status: string,
): "orange" | "teal" | "red" | "gray" {
  switch (status) {
    case "PENDING":
      return "orange";
    case "ACCEPTED":
      return "teal";
    case "REVOKED":
      return "red";
    case "EXPIRED":
      return "gray";
    default:
      return "gray";
  }
}

export default function WorkforcePage() {
  const session = useSession();
  const current = useCurrentOrganization(session.data);
  const orgId = current?.organization.id;
  const canManageMembers = membershipHasPermission(current, "org.members.manage");
  const queryClient = useQueryClient();
  const [banner, setBanner] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ["members", orgId],
    enabled: Boolean(orgId),
    queryFn: () =>
      api<MemberRecord[]>("/organizations/current/members", { orgId }),
  });

  const roles = useQuery({
    queryKey: ["org-roles", orgId],
    enabled: Boolean(orgId && canManageMembers),
    queryFn: () =>
      api<OrganizationRoleRecord[]>("/organizations/current/roles", { orgId }),
  });

  const invitations = useQuery({
    queryKey: ["invitations", orgId],
    enabled: Boolean(orgId && canManageMembers),
    queryFn: () =>
      api<InvitationRecord[]>("/organizations/current/invitations", { orgId }),
  });

  const defaultOrgRoleId =
    roles.data?.find((role) => role.slug === "technician")?.id ??
    roles.data?.[0]?.id ??
    "";

  const form = useForm<CreateInvitationInput>({
    resolver: zodResolver(createInvitationSchema),
    defaultValues: { email: "", orgRoleId: "" },
  });

  useEffect(() => {
    if (defaultOrgRoleId && !form.getValues("orgRoleId")) {
      form.setValue("orgRoleId", defaultOrgRoleId);
    }
  }, [defaultOrgRoleId, form]);

  const invite = useMutation({
    mutationFn: (body: CreateInvitationInput) =>
      api<InvitationRecord>("/organizations/current/invitations", {
        method: "POST",
        body,
        orgId,
      }),
    onSuccess: async (invitation) => {
      form.reset({ email: "", orgRoleId: defaultOrgRoleId });
      setBanner(`Invitation ready: ${invitation.acceptPath}`);
      await queryClient.invalidateQueries({
        queryKey: ["invitations", orgId],
      });
    },
    onError: (error: unknown) => {
      setBanner(
        error instanceof ApiError
          ? error.message
          : "Could not create the invitation",
      );
    },
  });

  const changeRole = useMutation({
    mutationFn: (input: { membershipId: string; orgRoleId: string }) =>
      api<MemberRecord[]>(
        `/organizations/current/members/${input.membershipId}`,
        {
          method: "PATCH",
          body: { orgRoleId: input.orgRoleId },
          orgId,
        },
      ),
    onSuccess: async () => {
      setBanner(null);
      await queryClient.invalidateQueries({ queryKey: ["members", orgId] });
      await queryClient.invalidateQueries({
        queryKey: ["organization", orgId],
      });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (error: unknown) => {
      setBanner(
        error instanceof ApiError
          ? error.message
          : "Could not change the role",
      );
    },
  });

  const revoke = useMutation({
    mutationFn: (invitationId: string) =>
      api<InvitationRecord[]>(
        `/organizations/current/invitations/${invitationId}/revoke`,
        {
          method: "POST",
          orgId,
        },
      ),
    onSuccess: async () => {
      setBanner(null);
      await queryClient.invalidateQueries({
        queryKey: ["invitations", orgId],
      });
    },
    onError: (error: unknown) => {
      setBanner(
        error instanceof ApiError
          ? error.message
          : "Could not revoke the invitation",
      );
    },
  });

  return (
    <PageStack>
      <PageHeader
        title="Workforce"
        description={`People in ${current?.organization.name ?? "your organization"}.`}
      />

      {banner ? <InfoCallout>{banner}</InfoCallout> : null}

      {canManageMembers ? (
        <Panel title="Invite member">
          <form onSubmit={form.handleSubmit((values) => invite.mutate(values))}>
            <Grid columns={{ initial: "1", md: "1fr 240px auto" }} gap="4" align="end">
              <Box>
                <Label htmlFor="invite-email">Email</Label>
                <Box mt="1">
                  <Input
                    id="invite-email"
                    type="email"
                    {...form.register("email")}
                  />
                </Box>
                <FieldError message={form.formState.errors.email?.message} />
              </Box>
              <Box>
                <Label htmlFor="invite-role">Role</Label>
                <Box mt="1">
                  <Controller
                    control={form.control}
                    name="orgRoleId"
                    render={({ field }) => (
                      <Select.Root
                        value={field.value || undefined}
                        onValueChange={field.onChange}
                      >
                        <Select.Trigger style={{ width: "100%" }} placeholder="Select role" />
                        <Select.Content>
                          {(roles.data ?? []).map((role) => (
                            <Select.Item key={role.id} value={role.id}>
                              {role.name}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                    )}
                  />
                </Box>
              </Box>
              <Box>
                <Button type="submit" disabled={invite.isPending || !form.watch("orgRoleId")}>
                  Invite
                </Button>
              </Box>
            </Grid>
          </form>
        </Panel>
      ) : null}

      {members.isError ? (
        <ErrorCallout>
          {members.error instanceof ApiError
            ? members.error.message
            : "Could not load members."}
        </ErrorCallout>
      ) : null}

      {members.isLoading ? (
        <LoadingBlock label="Loading workforce…" />
      ) : (
        <Panel title="Members">
          {(members.data ?? []).length === 0 ? (
            <EmptyState
              title="No members yet."
              description="Invite people using the form above."
            />
          ) : (
            <Table.Root variant="surface" size="2">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Details</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Role</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(members.data ?? []).map((member) => (
                  <Table.Row key={member.membershipId}>
                    <Table.Cell>
                      <Text size="2" weight="medium" highContrast>
                        {member.name}
                      </Text>
                      <Text size="2" color="gray" as="p">
                        {member.email}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2" color="gray">
                        {member.jobTitle || "No title"} · Joined{" "}
                        {format(new Date(member.joinedAt), "d MMM yyyy")}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {canManageMembers ? (
                        <Select.Root
                          value={member.orgRoleId}
                          onValueChange={(value) =>
                            changeRole.mutate({
                              membershipId: member.membershipId,
                              orgRoleId: value,
                            })
                          }
                        >
                          <Select.Trigger />
                          <Select.Content>
                            {(roles.data ?? []).map((role) => (
                              <Select.Item key={role.id} value={role.id}>
                                {role.name}
                              </Select.Item>
                            ))}
                          </Select.Content>
                        </Select.Root>
                      ) : (
                        <Text size="2">{member.orgRoleName}</Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Panel>
      )}

      {canManageMembers ? (
        <Panel title="Invitations">
          {invitations.isError ? (
            <ErrorCallout>
              {invitations.error instanceof ApiError
                ? invitations.error.message
                : "Could not load invitations."}
            </ErrorCallout>
          ) : null}
          {invitations.isLoading ? (
            <LoadingBlock label="Loading invitations…" />
          ) : null}
          {!invitations.isLoading && (invitations.data ?? []).length === 0 ? (
            <EmptyState title="No invitations yet." />
          ) : (
            <Table.Root variant="surface" size="2">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Role</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(invitations.data ?? []).map((invitation) => (
                  <Table.Row key={invitation.id}>
                    <Table.Cell>
                      <Text size="2">{invitation.email}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2">{invitation.orgRoleName}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge
                        color={invitationStatusColor(invitation.status)}
                        size="1"
                        variant="soft"
                      >
                        {invitation.status}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      {invitation.status === "PENDING" ? (
                        <Button
                          variant="outline"
                          type="button"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(invitation.id)}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Panel>
      ) : null}
    </PageStack>
  );
}
