"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Card,
  Checkbox,
  Flex,
  Separator,
  Text,
} from "@radix-ui/themes";
import type { MemberRecord } from "@fieldops/shared";
import { useSession } from "@/components/providers";
import { useCurrentOrganization } from "@/components/app-shell";
import { Button, ErrorCallout, Input } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { EmptyState, LoadingBlock, PageHeader, PageStack, Panel } from "@/components/page";

interface TeamRow {
  id: string;
  name: string;
  channel: {
    channelId: string;
    setupStatus: string;
    lastError: string | null;
  } | null;
  members: Array<{ user: { id: string; name: string; email: string } }>;
}

function channelColor(status: string): "teal" | "amber" | "red" | "gray" {
  if (status === "READY") return "teal";
  if (status === "PENDING" || status === "PROVISIONING") return "amber";
  if (status === "FAILED") return "red";
  return "gray";
}

export default function TeamsPage() {
  const session = useSession();
  const current = useCurrentOrganization(session.data);
  const orgId = current?.organization.id;
  const queryClient = useQueryClient();
  const canManage = current?.permissions?.includes("teams.manage") ?? false;
  const selfId = session.data?.user.id;
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMemberIds, setEditMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selfId) {
      setMemberIds((currentIds) =>
        currentIds.length === 0 ? [selfId] : currentIds,
      );
    }
  }, [selfId]);

  const teams = useQuery({
    queryKey: ["teams", orgId],
    enabled: Boolean(orgId),
    queryFn: () => api<TeamRow[]>("/teams", { orgId }),
  });

  const members = useQuery({
    queryKey: ["members", orgId],
    enabled: Boolean(orgId && canManage),
    queryFn: () =>
      api<MemberRecord[]>("/organizations/current/members", { orgId }),
  });

  const create = useMutation({
    mutationFn: (body: { name: string; memberIds: string[] }) =>
      api("/teams", { method: "POST", orgId, body }),
    onSuccess: async () => {
      setName("");
      setMemberIds(selfId ? [selfId] : []);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["teams", orgId] });
      await queryClient.invalidateQueries({ queryKey: ["channels", orgId] });
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof ApiError ? cause.message : "Could not create team",
      ),
  });

  const update = useMutation({
    mutationFn: (body: { teamId: string; name: string; memberIds: string[] }) =>
      api(`/teams/${body.teamId}`, {
        method: "PATCH",
        orgId,
        body: { name: body.name, memberIds: body.memberIds },
      }),
    onSuccess: async () => {
      setEditingId(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["teams", orgId] });
      await queryClient.invalidateQueries({ queryKey: ["channels", orgId] });
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof ApiError ? cause.message : "Could not update team",
      ),
  });

  function toggleMember(
    list: string[],
    userId: string,
    setter: (next: string[]) => void,
  ) {
    setter(
      list.includes(userId)
        ? list.filter((id) => id !== userId)
        : [...list, userId],
    );
  }

  function startEdit(team: TeamRow) {
    setEditingId(team.id);
    setEditName(team.name);
    setEditMemberIds(team.members.map((member) => member.user.id));
    setError(null);
  }

  return (
    <PageStack>
      <PageHeader
        title="Teams"
        description="Team members are synced into the Nexconn team channel. Add people here before they can open that chat."
      />

      {error ? <ErrorCallout>{error}</ErrorCallout> : null}

      {canManage ? (
        <Panel title="Create team">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const ids =
                memberIds.length > 0 ? memberIds : selfId ? [selfId] : [];
              create.mutate({ name, memberIds: ids });
            }}
          >
            <Flex direction="column" gap="3">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Team name"
              />
              <MemberPicker
                people={members.data ?? []}
                selected={memberIds}
                onToggle={(userId) =>
                  toggleMember(memberIds, userId, setMemberIds)
                }
              />
              <Box>
                <Button
                  type="submit"
                  disabled={create.isPending || name.trim().length < 2}
                >
                  Add team
                </Button>
              </Box>
            </Flex>
          </form>
        </Panel>
      ) : null}

      {teams.isError ? (
        <ErrorCallout>
          {teams.error instanceof ApiError
            ? teams.error.message
            : "Could not load teams."}
        </ErrorCallout>
      ) : null}

      {teams.isLoading ? (
        <LoadingBlock label="Loading teams…" />
      ) : (
        <Panel title="Teams">
          {(teams.data ?? []).length === 0 ? (
            <EmptyState
              title="No teams yet."
              description="Create your first team to get started."
            />
          ) : (
            <Flex direction="column" gap="1">
              {(teams.data ?? []).map((team, index) => (
                <Box key={team.id}>
                  {index > 0 ? <Separator size="4" mb="3" /> : null}
                  {editingId === team.id ? (
                    <Flex direction="column" gap="3">
                      <Input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                      />
                      <MemberPicker
                        people={members.data ?? []}
                        selected={editMemberIds}
                        onToggle={(userId) =>
                          toggleMember(editMemberIds, userId, setEditMemberIds)
                        }
                      />
                      <Flex gap="2">
                        <Button
                          type="button"
                          disabled={
                            update.isPending ||
                            editMemberIds.length === 0 ||
                            editName.trim().length < 2
                          }
                          onClick={() =>
                            update.mutate({
                              teamId: team.id,
                              name: editName,
                              memberIds: editMemberIds,
                            })
                          }
                        >
                          Save members
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </Flex>
                    </Flex>
                  ) : (
                    <Flex align="start" justify="between" gap="3">
                      <Box>
                        <Text size="2" weight="medium" highContrast>
                          {team.name}
                        </Text>
                        <Text size="2" color="gray" as="p" mt="1">
                          {team.members
                            .map((member) => member.user.name)
                            .join(", ") || "No members"}
                        </Text>
                        <Flex gap="2" mt="2" align="center">
                          {team.channel ? (
                            <Badge
                              color={channelColor(team.channel.setupStatus)}
                              size="1"
                              variant="soft"
                            >
                              Channel {team.channel.setupStatus}
                            </Badge>
                          ) : (
                            <Badge color="gray" size="1" variant="soft">
                              Channel not provisioned
                            </Badge>
                          )}
                          {team.channel?.lastError ? (
                            <Text size="1" color="red">
                              {team.channel.lastError}
                            </Text>
                          ) : null}
                        </Flex>
                      </Box>
                      {canManage ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => startEdit(team)}
                        >
                          Manage members
                        </Button>
                      ) : null}
                    </Flex>
                  )}
                </Box>
              ))}
            </Flex>
          )}
        </Panel>
      )}
    </PageStack>
  );
}

function MemberPicker({
  people,
  selected,
  onToggle,
}: {
  people: MemberRecord[];
  selected: string[];
  onToggle: (userId: string) => void;
}) {
  if (people.length === 0) {
    return (
      <Text size="2" color="gray">
        Loading people…
      </Text>
    );
  }
  return (
    <Card variant="surface" style={{ maxHeight: 192, overflowY: "auto" }}>
      <Flex direction="column" gap="2">
        {people.map((person) => {
          const checked = selected.includes(person.userId);
          return (
            <Text as="label" key={person.userId} size="2" style={{ cursor: "pointer" }}>
              <Flex align="center" gap="2">
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => onToggle(person.userId)}
                />
                <span>
                  {person.name}
                  <Text color="gray"> · {person.email}</Text>
                </span>
              </Flex>
            </Text>
          );
        })}
      </Flex>
    </Card>
  );
}
