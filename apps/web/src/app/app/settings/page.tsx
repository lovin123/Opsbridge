"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Grid, Text } from "@radix-ui/themes";
import {
  escalationPolicySchema,
  updateOrganizationSchema,
  type EscalationPolicyInput,
  type OrganizationDetail,
  type UpdateOrganizationInput,
} from "@fieldops/shared";
import { useSession } from "@/components/providers";
import { useCurrentOrganization } from "@/components/app-shell";
import { OrgRolesPanel } from "@/components/org-roles-panel";
import { Button, ErrorCallout, FieldError, InfoCallout, Input, Label } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { membershipHasPermission } from "@/lib/permissions";
import { LoadingBlock, PageHeader, PageStack, Panel } from "@/components/page";

export default function SettingsPage() {
  const session = useSession();
  const current = useCurrentOrganization(session.data);
  const orgId = current?.organization.id;
  const canManageSettings = membershipHasPermission(current, "org.settings.manage");
  const canManageRoles = membershipHasPermission(current, "org.roles.manage");
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const organization = useQuery({
    queryKey: ["organization", orgId],
    enabled: Boolean(orgId),
    queryFn: () => api<OrganizationDetail>("/organizations/current", { orgId }),
  });

  const policy = useQuery({
    queryKey: ["escalation-policy", orgId],
    enabled: Boolean(orgId),
    queryFn: () =>
      api<{
        criticalMinutes: number;
        highMinutes: number;
        mediumMinutes: number;
      } | null>("/escalation-policy", { orgId }),
  });

  const form = useForm<UpdateOrganizationInput>({
    resolver: zodResolver(updateOrganizationSchema),
    values: organization.data
      ? {
          name: organization.data.name,
          industry: organization.data.industry ?? "",
          timezone: organization.data.timezone,
        }
      : undefined,
  });

  const escalation = useForm<EscalationPolicyInput>({
    resolver: zodResolver(escalationPolicySchema),
    values: {
      criticalMinutes: policy.data?.criticalMinutes ?? 5,
      highMinutes: policy.data?.highMinutes ?? 15,
      mediumMinutes: policy.data?.mediumMinutes ?? 30,
    },
  });

  const save = useMutation({
    mutationFn: (body: UpdateOrganizationInput) =>
      api<OrganizationDetail>("/organizations/current", {
        method: "PATCH",
        body,
        orgId,
      }),
    onSuccess: async () => {
      setMessage("Organization updated.");
      await queryClient.invalidateQueries({
        queryKey: ["organization", orgId],
      });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (error: unknown) => {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Could not update the organization",
      );
    },
  });

  const savePolicy = useMutation({
    mutationFn: (body: EscalationPolicyInput) =>
      api("/escalation-policy", { method: "POST", body, orgId }),
    onSuccess: async () => {
      setMessage("Escalation policy saved.");
      await queryClient.invalidateQueries({
        queryKey: ["escalation-policy", orgId],
      });
    },
    onError: (error: unknown) => {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Could not save escalation policy",
      );
    },
  });

  return (
    <PageStack>
      <PageHeader
        title="Settings"
        description="Organization profile and escalation thresholds."
      />

      <Box style={{ maxWidth: canManageRoles ? 720 : 560 }}>
        <PageStack>
          {message ? <InfoCallout>{message}</InfoCallout> : null}

          {organization.isError ? (
            <ErrorCallout>
              {organization.error instanceof ApiError
                ? organization.error.message
                : "Could not load organization settings."}
            </ErrorCallout>
          ) : null}

          {organization.isLoading ? (
            <LoadingBlock label="Loading settings…" />
          ) : null}

          <Panel title="Organization profile">
            <form
              onSubmit={form.handleSubmit((values) => save.mutate(values))}
            >
              <Box mb="4">
                <Label htmlFor="org-name">Name</Label>
                <Box mt="1">
                  <Input
                    id="org-name"
                    disabled={!canManageSettings}
                    {...form.register("name")}
                  />
                </Box>
                <FieldError message={form.formState.errors.name?.message} />
              </Box>
              <Box mb="4">
                <Label htmlFor="org-industry">Industry</Label>
                <Box mt="1">
                  <Input
                    id="org-industry"
                    disabled={!canManageSettings}
                    {...form.register("industry")}
                  />
                </Box>
              </Box>
              <Box mb="4">
                <Label htmlFor="org-timezone">Timezone</Label>
                <Box mt="1">
                  <Input
                    id="org-timezone"
                    disabled={!canManageSettings}
                    {...form.register("timezone")}
                  />
                </Box>
                <FieldError
                  message={form.formState.errors.timezone?.message}
                />
              </Box>
              {canManageSettings ? (
                <Button
                  type="submit"
                  disabled={
                    save.isPending ||
                    organization.isLoading ||
                    organization.isError
                  }
                >
                  Save
                </Button>
              ) : (
                <Text size="2" color="gray">
                  You do not have permission to edit these settings.
                </Text>
              )}
            </form>
          </Panel>

          <Panel title="Escalation policy">
            <form
              onSubmit={escalation.handleSubmit((values) =>
                savePolicy.mutate(values),
              )}
            >
              <Text size="2" color="gray" as="p" mb="4">
                Minutes before an open incident of each priority escalates.
              </Text>
              <Grid columns="3" gap="4" mb="4">
                <Box>
                  <Label htmlFor="critical">Critical</Label>
                  <Box mt="1">
                    <Input
                      id="critical"
                      type="number"
                      disabled={!canManageSettings}
                      {...escalation.register("criticalMinutes", {
                        valueAsNumber: true,
                      })}
                    />
                  </Box>
                </Box>
                <Box>
                  <Label htmlFor="high">High</Label>
                  <Box mt="1">
                    <Input
                      id="high"
                      type="number"
                      disabled={!canManageSettings}
                      {...escalation.register("highMinutes", {
                        valueAsNumber: true,
                      })}
                    />
                  </Box>
                </Box>
                <Box>
                  <Label htmlFor="medium">Medium</Label>
                  <Box mt="1">
                    <Input
                      id="medium"
                      type="number"
                      disabled={!canManageSettings}
                      {...escalation.register("mediumMinutes", {
                        valueAsNumber: true,
                      })}
                    />
                  </Box>
                </Box>
              </Grid>
              {policy.isError ? (
                <Box mb="4">
                  <ErrorCallout>
                    {policy.error instanceof ApiError
                      ? policy.error.message
                      : "Could not load escalation policy."}
                  </ErrorCallout>
                </Box>
              ) : null}
              {policy.isLoading ? (
                <LoadingBlock label="Loading policy…" />
              ) : null}
              {canManageSettings ? (
                <Button
                  type="submit"
                  disabled={
                    savePolicy.isPending ||
                    policy.isLoading ||
                    policy.isError
                  }
                >
                  Save policy
                </Button>
              ) : null}
            </form>
          </Panel>

          {canManageRoles && orgId ? <OrgRolesPanel orgId={orgId} /> : null}
        </PageStack>
      </Box>
    </PageStack>
  );
}
