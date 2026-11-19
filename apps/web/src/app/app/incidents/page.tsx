"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge, Table, Text } from "@radix-ui/themes";
import { useSession } from "@/components/providers";
import { useCurrentOrganization } from "@/components/app-shell";
import { ApiError, api } from "@/lib/api";
import { EmptyState, LoadingBlock, PageHeader, PageStack, Panel } from "@/components/page";
import { Button, ErrorCallout } from "@/components/ui";

interface IncidentRow {
  id: string;
  number: string;
  title: string;
  priority: string;
  status: string;
  site: { name: string };
  assignee: { name: string } | null;
  channelSetup: string;
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

function channelColor(setup: string): "teal" | "amber" | "red" | "gray" {
  if (setup === "READY") return "teal";
  if (setup === "PENDING" || setup === "PROVISIONING") return "amber";
  if (setup === "FAILED") return "red";
  return "gray";
}

export default function IncidentsPage() {
  const session = useSession();
  const current = useCurrentOrganization(session.data);
  const incidents = useQuery({
    queryKey: ["incidents", current?.organization.id],
    enabled: Boolean(current),
    queryFn: () => api<IncidentRow[]>("/incidents", { orgId: current?.organization.id }),
  });

  return (
    <PageStack>
      <PageHeader
        title="Incidents"
        description="Each incident keeps an owner, a status, and a channel."
        actions={
          current?.permissions?.includes("incidents.create") ? (
            <Button asChild>
              <Link href="/app/incidents/new">Create incident</Link>
            </Button>
          ) : undefined
        }
      />

      {incidents.isError ? (
        <ErrorCallout>
          {incidents.error instanceof ApiError
            ? incidents.error.message
            : "Could not load incidents."}
        </ErrorCallout>
      ) : null}

      {incidents.isLoading ? (
        <LoadingBlock label="Loading incidents…" />
      ) : (
        <Panel>
          {!incidents.isLoading && (incidents.data ?? []).length === 0 ? (
            <EmptyState
              title="No incidents yet."
              description="Create your first incident to get started."
            />
          ) : (
            <Table.Root variant="surface" size="2">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>#</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Title</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Priority</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Site</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Assignee</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Channel</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(incidents.data ?? []).map((incident) => (
                  <Table.Row key={incident.id}>
                    <Table.Cell>
                      <Text asChild size="2" weight="medium" color="teal">
                        <Link href={`/app/incidents/${incident.id}`}>
                          {incident.number}
                        </Link>
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2">{incident.title}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge color={priorityColor(incident.priority)} size="1">
                        {incident.priority}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge
                        color={statusColor(incident.status)}
                        size="1"
                        variant="soft"
                      >
                        {incident.status}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2" color="gray">
                        {incident.site.name}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2" color="gray">
                        {incident.assignee?.name ?? "Unassigned"}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge color={channelColor(incident.channelSetup)} size="1" variant="soft">
                        {incident.channelSetup}
                      </Badge>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Panel>
      )}
    </PageStack>
  );
}
