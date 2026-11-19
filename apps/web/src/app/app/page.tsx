"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge, Grid, Table, Text } from "@radix-ui/themes";
import { useSession } from "@/components/providers";
import { useCurrentOrganization } from "@/components/app-shell";
import { ApiError, api } from "@/lib/api";
import { EmptyState, LoadingBlock, MetricCard, PageHeader, PageStack, Panel } from "@/components/page";
import { ErrorCallout } from "@/components/ui";

interface Dashboard {
  active: number;
  critical: number;
  unassigned: number;
  overdue: number;
  resolvedToday: number;
  availableTechnicians: number;
  feed: Array<{
    id: string;
    number: string;
    title: string;
    priority: string;
    status: string;
    site: string;
    assignee: string | null;
  }>;
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

export default function OverviewPage() {
  const session = useSession();
  const current = useCurrentOrganization(session.data);
  const orgId = current?.organization.id;
  const dashboard = useQuery({
    queryKey: ["dashboard", orgId],
    enabled: Boolean(orgId),
    queryFn: () => api<Dashboard>("/dashboard", { orgId }),
  });

  if (dashboard.isError) {
    return (
      <ErrorCallout>
        {dashboard.error instanceof ApiError
          ? dashboard.error.message
          : "Could not load operations."}
      </ErrorCallout>
    );
  }

  if (!dashboard.data) {
    return <LoadingBlock label="Loading operations…" />;
  }

  const cards = [
    { label: "Active incidents", value: dashboard.data.active },
    { label: "Critical", value: dashboard.data.critical },
    { label: "Unassigned", value: dashboard.data.unassigned },
    { label: "Overdue", value: dashboard.data.overdue },
    { label: "Resolved today", value: dashboard.data.resolvedToday },
    { label: "Available technicians", value: dashboard.data.availableTechnicians },
  ];

  return (
    <PageStack>
      <PageHeader
        title="Overview"
        description={`${current?.organization.name ?? "Your organization"} · Bridge field operations in one workspace.`}
      />
      <Grid columns={{ initial: "1", sm: "2", xl: "3" }} gap="4">
        {cards.map(({ label, value }) => (
          <MetricCard key={label} label={label} value={value} />
        ))}
      </Grid>
      <Panel title="Live incident feed">
        {dashboard.data.feed.length === 0 ? (
          <EmptyState title="No incidents yet." />
        ) : (
          <Table.Root variant="surface" size="2">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>#</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Title</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Priority</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Site / Assignee</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {dashboard.data.feed.map((item) => (
                <Table.Row key={item.id}>
                  <Table.Cell>
                    <Text asChild size="2" weight="medium" color="teal">
                      <Link href={`/app/incidents/${item.id}`}>{item.number}</Link>
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="2">{item.title}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color={priorityColor(item.priority)} size="1">
                      {item.priority}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color={statusColor(item.status)} size="1" variant="soft">
                      {item.status}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="2" color="gray">
                      {item.site}
                      {item.assignee ? ` · ${item.assignee}` : ""}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Panel>
    </PageStack>
  );
}
