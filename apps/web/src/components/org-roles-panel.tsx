"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Badge, Box, Checkbox, Flex, Grid, Select, Text } from "@radix-ui/themes";
import {
  createOrgRoleSchema,
  dataScopes,
  memberRoles,
  permissionGroups,
  roleLabels,
  roleTemplateDefaults,
  type CreateOrgRoleInput,
  type OrganizationRoleRecord,
  type Permission,
  type UpdateOrgRoleInput,
} from "@fieldops/shared";
import { Button, ErrorCallout, Input, Label } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { EmptyState, LoadingBlock, Panel } from "@/components/page";

export function OrgRolesPanel({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateOrgRoleInput>({
    name: "",
    baseRole: "TECHNICIAN",
    dataScope: "ASSIGNED",
    permissions: [...roleTemplateDefaults.TECHNICIAN.permissions],
  });

  const roles = useQuery({
    queryKey: ["org-roles", orgId],
    queryFn: () => api<OrganizationRoleRecord[]>("/organizations/current/roles", { orgId }),
  });

  const create = useMutation({
    mutationFn: (body: CreateOrgRoleInput) =>
      api<OrganizationRoleRecord>("/organizations/current/roles", {
        method: "POST",
        body,
        orgId,
      }),
    onSuccess: async () => {
      setError(null);
      setForm({
        name: "",
        baseRole: "TECHNICIAN",
        dataScope: "ASSIGNED",
        permissions: [...roleTemplateDefaults.TECHNICIAN.permissions],
      });
      await queryClient.invalidateQueries({ queryKey: ["org-roles", orgId] });
    },
    onError: (cause: unknown) =>
      setError(cause instanceof ApiError ? cause.message : "Could not create role"),
  });

  const update = useMutation({
    mutationFn: (input: { id: string; body: UpdateOrgRoleInput }) =>
      api<OrganizationRoleRecord>(`/organizations/current/roles/${input.id}`, {
        method: "PATCH",
        body: input.body,
        orgId,
      }),
    onSuccess: async () => {
      setError(null);
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["org-roles", orgId] });
    },
    onError: (cause: unknown) =>
      setError(cause instanceof ApiError ? cause.message : "Could not update role"),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/organizations/current/roles/${id}`, { method: "DELETE", orgId }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["org-roles", orgId] });
    },
    onError: (cause: unknown) =>
      setError(cause instanceof ApiError ? cause.message : "Could not delete role"),
  });

  const editing = useMemo(
    () => (roles.data ?? []).find((role) => role.id === editingId) ?? null,
    [editingId, roles.data],
  );

  const applyTemplate = (baseRole: CreateOrgRoleInput["baseRole"]) => {
    const template = roleTemplateDefaults[baseRole];
    setForm((current) => ({
      ...current,
      baseRole,
      dataScope: template.dataScope,
      permissions: [...template.permissions],
      name: current.name || `Custom ${template.name}`,
    }));
  };

  const togglePermission = (key: Permission, checked: boolean) => {
    setForm((current) => ({
      ...current,
      permissions: checked
        ? [...new Set([...current.permissions, key])]
        : current.permissions.filter((item) => item !== key),
    }));
  };

  return (
    <Panel title="Roles & permissions">
      {error ? (
        <Box mb="3">
          <ErrorCallout>{error}</ErrorCallout>
        </Box>
      ) : null}

      {roles.isLoading ? <LoadingBlock label="Loading roles…" /> : null}
      {roles.isError ? (
        <ErrorCallout>
          {roles.error instanceof ApiError ? roles.error.message : "Could not load roles."}
        </ErrorCallout>
      ) : null}

      <Box mb="5">
        <Text size="2" weight="medium" mb="2" as="p">
          Create custom role
        </Text>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = createOrgRoleSchema.safeParse(form);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? "Invalid role");
              return;
            }
            create.mutate(parsed.data);
          }}
        >
          <Grid columns={{ initial: "1", md: "2" }} gap="3" mb="3">
            <Box>
              <Label htmlFor="role-name">Name</Label>
              <Box mt="1">
                <Input
                  id="role-name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </Box>
            </Box>
            <Box>
              <Text as="p" size="2" weight="medium" mb="1">
                Start from template
              </Text>
              <Select.Root value={form.baseRole} onValueChange={(value) => applyTemplate(value as CreateOrgRoleInput["baseRole"])}>
                <Select.Trigger style={{ width: "100%" }} />
                <Select.Content>
                  {memberRoles.map((role) => (
                    <Select.Item key={role} value={role}>
                      {roleLabels[role]}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Box>
            <Box>
              <Text as="p" size="2" weight="medium" mb="1">
                Data scope
              </Text>
              <Select.Root
                value={form.dataScope}
                onValueChange={(value) =>
                  setForm({ ...form, dataScope: value as CreateOrgRoleInput["dataScope"] })
                }
              >
                <Select.Trigger style={{ width: "100%" }} />
                <Select.Content>
                  {dataScopes.map((scope) => (
                    <Select.Item key={scope} value={scope}>
                      {scope}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Box>
          </Grid>

          <PermissionChecklist
            selected={form.permissions}
            onToggle={togglePermission}
          />

          <Box mt="3">
            <Button type="submit" disabled={create.isPending || form.permissions.length === 0}>
              {create.isPending ? "Creating…" : "Create role"}
            </Button>
          </Box>
        </form>
      </Box>

      {(roles.data ?? []).length === 0 ? (
        <EmptyState title="No roles yet." />
      ) : (
        <Flex direction="column" gap="3">
          {(roles.data ?? []).map((role) => (
            <Box
              key={role.id}
              p="3"
              style={{ border: "1px solid var(--gray-a5)", borderRadius: "var(--radius-3)" }}
            >
              <Flex align="center" justify="between" gap="3" wrap="wrap" mb="2">
                <Flex align="center" gap="2" wrap="wrap">
                  <Text size="2" weight="medium">
                    {role.name}
                  </Text>
                  {role.system ? (
                    <Badge size="1" color="gray" variant="soft">
                      System
                    </Badge>
                  ) : (
                    <Badge size="1" color="indigo" variant="soft">
                      Custom
                    </Badge>
                  )}
                  <Text size="1" color="gray">
                    {role.dataScope} · based on {roleLabels[role.baseRole]} · {role.memberCount}{" "}
                    members
                  </Text>
                </Flex>
                {!role.system ? (
                  <Flex gap="2">
                    <Button
                      type="button"
                      size="1"
                      variant="outline"
                      onClick={() => {
                        setEditingId(role.id);
                        setForm({
                          name: role.name,
                          baseRole: role.baseRole,
                          dataScope: role.dataScope,
                          permissions: [...role.permissions],
                        });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="1"
                      variant="outline"
                      color="red"
                      disabled={remove.isPending || role.memberCount > 0}
                      onClick={() => remove.mutate(role.id)}
                    >
                      Delete
                    </Button>
                  </Flex>
                ) : null}
              </Flex>
              <Text size="1" color="gray">
                {role.permissions.length} permissions
              </Text>
              {editing && editing.id === role.id ? (
                <Box mt="3">
                  <Label htmlFor={`edit-name-${role.id}`}>Name</Label>
                  <Box mt="1" mb="3">
                    <Input
                      id={`edit-name-${role.id}`}
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                    />
                  </Box>
                  <PermissionChecklist
                    selected={form.permissions}
                    onToggle={togglePermission}
                  />
                  <Flex gap="2" mt="3">
                    <Button
                      type="button"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({
                          id: role.id,
                          body: { name: form.name, permissions: form.permissions },
                        })
                      }
                    >
                      Save
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </Flex>
                </Box>
              ) : null}
            </Box>
          ))}
        </Flex>
      )}
    </Panel>
  );
}

function PermissionChecklist({
  selected,
  onToggle,
}: {
  selected: Permission[];
  onToggle: (key: Permission, checked: boolean) => void;
}) {
  const selectedSet = new Set(selected);
  return (
    <Flex direction="column" gap="3">
      {permissionGroups.map((group) => (
        <Box key={group.label}>
          <Text size="2" weight="medium" mb="2" as="p">
            {group.label}
          </Text>
          <Grid columns={{ initial: "1", sm: "2" }} gap="2">
            {group.keys.map((key) => (
              <Text as="label" key={key} size="2">
                <Flex align="center" gap="2">
                  <Checkbox
                    checked={selectedSet.has(key)}
                    onCheckedChange={(value) => onToggle(key, value === true)}
                  />
                  {key}
                </Flex>
              </Text>
            ))}
          </Grid>
        </Box>
      ))}
    </Flex>
  );
}
