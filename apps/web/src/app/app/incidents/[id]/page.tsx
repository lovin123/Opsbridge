"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Badge,
  Box,
  Card,
  Flex,
  Grid,
  Heading,
  Select,
  Separator,
  Text,
  TextArea,
} from "@radix-ui/themes";
import { nextStatuses, type IncidentStatus } from "@fieldops/shared";
import { MediaUpload } from "@/components/media-upload";
import { NexconnChat } from "@/components/nexconn-chat";
import { useSession } from "@/components/providers";
import { useCurrentOrganization } from "@/components/app-shell";
import { Button, ErrorCallout, Input } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { LoadingBlock, PageStack } from "@/components/page";

interface IncidentDetail {
  id: string;
  number: string;
  title: string;
  description: string;
  priority: string;
  status: IncidentStatus;
  location: string | null;
  equipment: string | null;
  dueAt: string | null;
  resolutionNotes: string | null;
  channelSetup: string;
  channelId: string | null;
  channelError: string | null;
  site: { name: string };
  assignee: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  events: Array<{ id: string; message: string; createdAt: string }>;
  media: Array<{
    id: string;
    filename: string;
    purpose: string;
    bytes: number;
    resourceType?: string;
  }>;
}

interface DirectoryRow {
  userId: string;
  name: string;
}

interface TeamRow {
  id: string;
  name: string;
}

function statusColor(
  status: string,
): "orange" | "blue" | "cyan" | "teal" | "gray" {
  switch (status) {
    case "OPEN":
      return "orange";
    case "ASSIGNED":
      return "blue";
    case "IN_PROGRESS":
      return "cyan";
    case "RESOLVED":
      return "teal";
    case "CLOSED":
      return "gray";
    default:
      return "gray";
  }
}

function priorityColor(priority: string): "red" | "orange" | "yellow" | "gray" {
  switch (priority) {
    case "CRITICAL":
      return "red";
    case "HIGH":
      return "orange";
    case "MEDIUM":
      return "yellow";
    case "LOW":
      return "gray";
    default:
      return "gray";
  }
}

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const session = useSession();
  const current = useCurrentOrganization(session.data);
  const orgId = current?.organization.id;
  const canAssign = Boolean(current?.permissions?.includes("incidents.assign"));
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [nextStatus, setNextStatus] = useState<IncidentStatus | "">("");
  const [assigneeId, setAssigneeId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const incident = useQuery({
    queryKey: ["incident", params.id, orgId],
    enabled: Boolean(orgId),
    queryFn: () => api<IncidentDetail>(`/incidents/${params.id}`, { orgId }),
  });

  useEffect(() => {
    if (!incident.data) {
      return;
    }
    setAssigneeId(incident.data.assignee?.id ?? "");
    setTeamId(incident.data.team?.id ?? "");
    setNextStatus("");
  }, [
    incident.data?.id,
    incident.data?.assignee?.id,
    incident.data?.team?.id,
    incident.data?.status,
  ]);

  const context = useQuery({
    queryKey: ["context", params.id],
    enabled: Boolean(orgId),
    queryFn: () =>
      api<{ status?: string; version?: number; error?: string | null; createdAt?: string } | null>(
        `/incidents/${params.id}/context`,
        { orgId },
      ),
  });

  const directory = useQuery({
    queryKey: ["workforce-directory", orgId],
    enabled: Boolean(orgId && canAssign),
    queryFn: async () => {
      const rows = await api<Array<{ user: { id: string; name: string } }>>(
        "/workforce/directory",
        { orgId },
      );
      return rows.map((row) => ({
        userId: row.user.id,
        name: row.user.name,
      })) satisfies DirectoryRow[];
    },
  });

  const teams = useQuery({
    queryKey: ["teams", orgId],
    enabled: Boolean(orgId && canAssign),
    queryFn: () => api<TeamRow[]>("/teams", { orgId }),
  });

  const run = useMutation({
    mutationFn: async (action: "status" | "refresh" | "ask" | "assign" | "channel") => {
      if (action === "status") {
        const status = nextStatus || incident.data?.status;
        return api(`/incidents/${params.id}/status`, {
          method: "PATCH",
          orgId,
          body: { status, resolutionNotes: notes || undefined },
        });
      }
      if (action === "assign") {
        return api(`/incidents/${params.id}/assignment`, {
          method: "PATCH",
          orgId,
          body: {
            assigneeId: assigneeId || null,
            teamId: teamId || null,
          },
        });
      }
      if (action === "channel") {
        return api(`/incidents/${params.id}/channel`, { method: "POST", orgId });
      }
      if (action === "refresh") {
        return api(`/incidents/${params.id}/context/refresh`, {
          method: "POST",
          orgId,
        });
      }
      return api<{ answer: { answer: string } }>(
        `/incidents/${params.id}/assistant`,
        {
          method: "POST",
          orgId,
          body: { question },
        },
      );
    },
    onSuccess: async (result) => {
      setError(null);
      if (result && typeof result === "object" && "answer" in result) {
        const payload = result.answer as { answer?: string };
        if (payload.answer) {
          setAnswer(payload.answer);
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["incident", params.id] });
      await queryClient.invalidateQueries({ queryKey: ["context", params.id] });
    },
    onError: (cause: unknown) =>
      setError(cause instanceof ApiError ? cause.message : "Request failed"),
  });

  if (incident.isError) {
    return (
      <ErrorCallout>
        {incident.error instanceof ApiError
          ? incident.error.message
          : "Could not load incident."}
      </ErrorCallout>
    );
  }

  if (!incident.data) {
    return <LoadingBlock label="Loading incident…" />;
  }

  const data = incident.data;
  const hasAssignee = Boolean(assigneeId || data.assignee?.id);
  const assignedScopeOnly =
    current?.dataScope === "ASSIGNED" &&
    !current?.permissions?.includes("incidents.update_any");
  const allowed = nextStatuses(data.status).filter((status) => {
    if (status === "ASSIGNED" && !hasAssignee) {
      return false;
    }
    if (assignedScopeOnly && status === "OPEN") {
      return false;
    }
    return true;
  });
  const busy = run.isPending;

  return (
    <PageStack>
      <Grid
        columns={{ initial: "1", xl: "280px minmax(0,1fr) 300px" }}
        gap="4"
      >
        {/* Left: Incident details */}
        <Card size="2" variant="surface">
          <Flex direction="column" gap="3">
            <Box>
              <Text size="1" color="gray">
                {data.number}
              </Text>
              <Heading size="4" mt="1" highContrast>
                {data.title}
              </Heading>
            </Box>
            <Text size="2" style={{ lineHeight: 1.6 }}>
              {data.description}
            </Text>
            <Flex gap="2" wrap="wrap">
              <Badge color={priorityColor(data.priority)} size="1">
                {data.priority}
              </Badge>
              <Badge color={statusColor(data.status)} size="1" variant="soft">
                {data.status}
              </Badge>
            </Flex>
            <Separator size="4" />
            <Flex direction="column" gap="1">
              <Text size="2">
                <Text color="gray">Site: </Text>
                {data.site.name}
              </Text>
              <Text size="2">
                <Text color="gray">Equipment: </Text>
                {data.equipment ?? "Not recorded"}
              </Text>
              <Text size="2">
                <Text color="gray">Location: </Text>
                {data.location ?? "Not recorded"}
              </Text>
            </Flex>
            <Separator size="4" />
            <Box>
              <Text size="2" weight="medium" mb="2" as="p">
                Evidence
              </Text>
              <Flex direction="column" gap="1">
                {data.media.map((asset) => (
                  <MediaLink key={asset.id} orgId={orgId} asset={asset} />
                ))}
                {data.media.length === 0 ? (
                  <Text size="2" color="gray">
                    No files yet.
                  </Text>
                ) : null}
              </Flex>
              {orgId ? (
                <Box mt="3">
                  <MediaUpload
                    orgId={orgId}
                    incidentId={data.id}
                    onUploaded={() =>
                      void queryClient.invalidateQueries({
                        queryKey: ["incident", params.id],
                      })
                    }
                  />
                </Box>
              ) : null}
            </Box>
          </Flex>
        </Card>

        {/* Center: Chat */}
        <Box style={{ minHeight: 420 }}>
          {data.channelId && data.channelSetup === "READY" ? (
            <NexconnChat channelId={data.channelId} mode="group" layout="channel" />
          ) : (
            <Card size="2" variant="surface">
              <Flex direction="column" gap="3">
                <Text size="2" color="gray">
                  Channel setup is {data.channelSetup}.{" "}
                  {data.channelError}
                </Text>
                {canAssign ? (
                  <Box>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => run.mutate("channel")}
                    >
                      Retry channel provisioning
                    </Button>
                  </Box>
                ) : null}
              </Flex>
            </Card>
          )}
        </Box>

        {/* Right: Actions */}
        <Flex direction="column" gap="4">
          {error ? <ErrorCallout>{error}</ErrorCallout> : null}

          {/* Meta panel */}
          <Card size="2" variant="surface">
            <Flex direction="column" gap="2">
              <Text size="2">
                <Text color="gray">Assignee: </Text>
                {data.assignee?.name ?? "Unassigned"}
              </Text>
              <Text size="2">
                <Text color="gray">Team: </Text>
                {data.team?.name ?? "None"}
              </Text>
              <Text size="2">
                <Text color="gray">Due: </Text>
                {data.dueAt
                  ? new Date(data.dueAt).toLocaleString()
                  : "None"}
              </Text>
              <Text size="2">
                <Text color="gray">Channel: </Text>
                {data.channelSetup}
              </Text>
              <Text size="2">
                <Text color="gray">Context: </Text>
                {context.data?.status ?? "not generated"}
                {context.data?.version ? ` v${context.data.version}` : ""}
              </Text>
              {context.data?.error ? (
                <Text size="2" color="red">
                  {context.data.error}
                </Text>
              ) : null}
            </Flex>
          </Card>

          {/* Assignment */}
          {canAssign ? (
            <Card size="2" variant="surface">
              <Flex direction="column" gap="3">
                <Text size="2" weight="medium" as="p">
                  Assign technician
                </Text>
                <Select.Root
                  value={assigneeId || "__none__"}
                  onValueChange={(v) =>
                    setAssigneeId(v === "__none__" ? "" : v)
                  }
                >
                  <Select.Trigger style={{ width: "100%" }} />
                  <Select.Content>
                    <Select.Item value="__none__">Unassigned</Select.Item>
                    {(directory.data ?? []).map((person) => (
                      <Select.Item key={person.userId} value={person.userId}>
                        {person.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <Text size="2" weight="medium" as="p">
                  Team
                </Text>
                <Select.Root
                  value={teamId || "__none__"}
                  onValueChange={(v) =>
                    setTeamId(v === "__none__" ? "" : v)
                  }
                >
                  <Select.Trigger style={{ width: "100%" }} />
                  <Select.Content>
                    <Select.Item value="__none__">None</Select.Item>
                    {(teams.data ?? []).map((team) => (
                      <Select.Item key={team.id} value={team.id}>
                        {team.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => run.mutate("assign")}
                >
                  Save assignment
                </Button>
              </Flex>
            </Card>
          ) : null}

          {/* Status update */}
          <Card size="2" variant="surface">
            <Flex direction="column" gap="3">
              <Text size="2" weight="medium" as="p">
                Next status
              </Text>
              <Select.Root
                value={nextStatus || "__none__"}
                onValueChange={(v) =>
                  setNextStatus(v === "__none__" ? "" : (v as IncidentStatus))
                }
              >
                <Select.Trigger style={{ width: "100%" }} />
                <Select.Content>
                  <Select.Item value="__none__">Select</Select.Item>
                  {allowed.map((status) => (
                    <Select.Item key={status} value={status}>
                      {status}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <Text size="2" weight="medium" as="p">
                Resolution notes
                {nextStatus === "RESOLVED" ? " (required)" : ""}
              </Text>
              <TextArea
                size="2"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                style={{ minHeight: 80 }}
              />
              <Flex gap="2" wrap="wrap">
                <Button
                  type="button"
                  disabled={
                    !nextStatus ||
                    busy ||
                    (nextStatus === "RESOLVED" && notes.trim().length === 0)
                  }
                  onClick={() => run.mutate("status")}
                >
                  Update status
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => run.mutate("refresh")}
                >
                  Refresh summary
                </Button>
              </Flex>
            </Flex>
          </Card>

          {/* Ask assistant */}
          <Card size="2" variant="surface">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                run.mutate("ask");
              }}
            >
              <Flex direction="column" gap="3">
                <Text size="2" weight="medium" as="p">
                  Ask about this incident
                </Text>
                <Input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Your question…"
                />
                <Button
                  type="submit"
                  disabled={busy || question.trim().length < 3}
                >
                  Ask
                </Button>
                {answer ? (
                  <Text size="2" style={{ lineHeight: 1.6 }}>
                    {answer}
                  </Text>
                ) : null}
              </Flex>
            </form>
          </Card>

          {/* Event log */}
          {data.events.length > 0 ? (
            <Card size="2" variant="surface">
              <Text size="2" weight="medium" as="p" mb="3">
                Activity
              </Text>
              <Flex direction="column" gap="2">
                {data.events.map((event) => (
                  <Text key={event.id} size="2">
                    <Text color="gray">
                      {new Date(event.createdAt).toLocaleString()}
                    </Text>{" "}
                    {event.message}
                  </Text>
                ))}
              </Flex>
            </Card>
          ) : null}
        </Flex>
      </Grid>
    </PageStack>
  );
}

function MediaLink({
  orgId,
  asset,
}: {
  orgId?: string;
  asset: { id: string; filename: string; purpose: string };
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <Flex gap="1" align="center">
      <Text
        asChild
        size="2"
        color="teal"
        style={{ cursor: "pointer", opacity: !orgId ? 0.5 : 1 }}
      >
        <button
          type="button"
          disabled={!orgId}
          onClick={async () => {
            if (!orgId) {
              return;
            }
            if (url) {
              window.open(url, "_blank", "noopener,noreferrer");
              return;
            }
            try {
              const result = await api<{ url: string }>(
                `/media/${asset.id}/url`,
                { orgId },
              );
              if (result.url) {
                setUrl(result.url);
                setFailed(false);
                window.open(result.url, "_blank", "noopener,noreferrer");
              }
            } catch {
              setFailed(true);
            }
          }}
        >
          {asset.filename}
        </button>
      </Text>
      <Text size="2" color="gray">
        · {asset.purpose}
      </Text>
      {failed ? (
        <Text size="2" color="red">
          · unavailable
        </Text>
      ) : null}
    </Flex>
  );
}
