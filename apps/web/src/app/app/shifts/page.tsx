"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Badge, Box, Checkbox, Flex, Grid, Select, Table, Text } from "@radix-ui/themes";
import { useSession } from "@/components/providers";
import { useCurrentOrganization } from "@/components/app-shell";
import { Button, ErrorCallout, Input, Label } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { membershipHasPermission } from "@/lib/permissions";
import { EmptyState, LoadingBlock, PageHeader, PageStack, Panel } from "@/components/page";

interface SiteRow {
  id: string;
  name: string;
}

interface MemberRow {
  userId: string;
  name: string;
}

interface ShiftRow {
  id: string;
  name: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  site: { name: string };
  supervisor: { name: string } | null;
  assignments: Array<{ user: { name: string } }>;
}

interface HandoverRow {
  id: string;
  status: string;
  createdAt: string;
  publishedAt: string | null;
  shift: {
    id: string;
    name: string;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    site: { name: string };
  } | null;
  report: {
    narrative?: string;
    criticalIssues?: string[];
    pendingActions?: Array<{ action: string; owner: string }>;
    priorities?: string[];
  };
}

const WEEKDAYS: Array<{ value: number; label: string; short: string }> = [
  { value: 1, label: "Mon", short: "Mon" },
  { value: 2, label: "Tue", short: "Tue" },
  { value: 3, label: "Wed", short: "Wed" },
  { value: 4, label: "Thu", short: "Thu" },
  { value: 5, label: "Fri", short: "Fri" },
  { value: 6, label: "Sat", short: "Sat" },
  { value: 7, label: "Sun", short: "Sun" },
];

const PRESET_MON_FRI = [1, 2, 3, 4, 5];
const PRESET_MON_SAT = [1, 2, 3, 4, 5, 6];

function sameDays(a: number[], b: number[]) {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((day, index) => day === right[index]);
}

function formatDaysOfWeek(days: number[]) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 0) return "No days";
  if (sameDays(sorted, PRESET_MON_FRI)) return "Mon–Fri";
  if (sameDays(sorted, PRESET_MON_SAT)) return "Mon–Sat";
  if (sameDays(sorted, [1, 2, 3, 4, 5, 6, 7])) return "Every day";

  const contiguous =
    sorted.length > 1 &&
    sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);
  if (contiguous) {
    const first = WEEKDAYS.find((day) => day.value === sorted[0])?.short ?? String(sorted[0]);
    const last =
      WEEKDAYS.find((day) => day.value === sorted[sorted.length - 1])?.short ??
      String(sorted[sorted.length - 1]);
    return `${first}–${last}`;
  }

  return sorted
    .map((value) => WEEKDAYS.find((day) => day.value === value)?.short ?? String(value))
    .join(", ");
}

function formatShiftWindow(daysOfWeek: number[], startTime: string, endTime: string) {
  return `${formatDaysOfWeek(daysOfWeek)} · ${startTime}–${endTime}`;
}

function handoverStatusColor(status: string): "amber" | "teal" | "gray" {
  if (status === "DRAFT") return "amber";
  if (status === "PUBLISHED") return "teal";
  return "gray";
}

export default function ShiftsPage() {
  const session = useSession();
  const current = useCurrentOrganization(session.data);
  const orgId = current?.organization.id;
  const canManage = membershipHasPermission(current, "shifts.manage");
  const canDraftHandover = membershipHasPermission(current, "handovers.draft");
  const canPublishHandover = membershipHasPermission(current, "handovers.publish");
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    siteId: "",
    name: "Day shift",
    daysOfWeek: PRESET_MON_FRI,
    startTime: "08:00",
    endTime: "16:00",
    supervisorId: "",
  });
  const [handoverShiftId, setHandoverShiftId] = useState("");

  const sites = useQuery({
    queryKey: ["sites", orgId],
    enabled: Boolean(orgId) && canManage,
    queryFn: () => api<SiteRow[]>("/sites", { orgId }),
  });
  const members = useQuery({
    queryKey: ["members", orgId],
    enabled: Boolean(orgId) && canManage,
    queryFn: () => api<MemberRow[]>("/organizations/current/members", { orgId }),
  });
  const shifts = useQuery({
    queryKey: ["shifts", orgId],
    enabled: Boolean(orgId),
    queryFn: () => api<ShiftRow[]>("/shifts", { orgId }),
  });
  const handovers = useQuery({
    queryKey: ["handovers", orgId],
    enabled: Boolean(orgId),
    queryFn: () => api<HandoverRow[]>("/handovers", { orgId }),
  });

  const defaultSiteId = form.siteId || sites.data?.[0]?.id || "";

  const create = useMutation({
    mutationFn: () =>
      api("/shifts", {
        method: "POST",
        orgId,
        body: {
          siteId: defaultSiteId,
          name: form.name,
          daysOfWeek: form.daysOfWeek,
          startTime: form.startTime,
          endTime: form.endTime,
          supervisorId: form.supervisorId || undefined,
          memberIds: [],
        },
      }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["shifts", orgId] });
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof ApiError ? cause.message : "Could not create shift",
      ),
  });

  const handover = useMutation({
    mutationFn: (shiftId?: string) =>
      api<HandoverRow>("/handovers", {
        method: "POST",
        orgId,
        body: {
          shiftId: shiftId || undefined,
        },
      }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["handovers", orgId] });
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof ApiError ? cause.message : "Could not draft handover",
      ),
  });

  const publish = useMutation({
    mutationFn: (id: string) =>
      api(`/handovers/${id}/publish`, { method: "POST", orgId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["handovers", orgId] });
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not publish handover",
      ),
  });

  const memberOptions = useMemo(() => members.data ?? [], [members.data]);
  const shiftOptions = useMemo(() => shifts.data ?? [], [shifts.data]);
  const selectedHandoverShiftId =
    handoverShiftId || shiftOptions[0]?.id || "";
  const draftButton = canDraftHandover ? (
    <Flex align="center" gap="2" wrap="wrap">
      {shiftOptions.length > 0 ? (
        <Select.Root
          value={selectedHandoverShiftId}
          onValueChange={setHandoverShiftId}
        >
          <Select.Trigger placeholder="Shift for handover" />
          <Select.Content>
            {shiftOptions.map((shift) => (
              <Select.Item key={shift.id} value={shift.id}>
                {shift.name} · {formatShiftWindow(shift.daysOfWeek, shift.startTime, shift.endTime)}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      ) : null}
      <Button
        type="button"
        onClick={() => handover.mutate(selectedHandoverShiftId || undefined)}
        disabled={handover.isPending}
      >
        {handover.isPending ? "Drafting…" : "Draft handover"}
      </Button>
    </Flex>
  ) : null;

  const toggleDay = (day: number) => {
    setForm((currentForm) => {
      const exists = currentForm.daysOfWeek.includes(day);
      const daysOfWeek = exists
        ? currentForm.daysOfWeek.filter((value) => value !== day)
        : [...currentForm.daysOfWeek, day].sort((a, b) => a - b);
      return { ...currentForm, daysOfWeek };
    });
  };

  return (
    <PageStack>
      <PageHeader
        title="Shifts"
        description={
          canManage
            ? "Recurring coverage windows and shift handovers."
            : "Your schedule and published shift handovers."
        }
        actions={draftButton ?? undefined}
      />

      {error ? <ErrorCallout>{error}</ErrorCallout> : null}
      {canManage && sites.isError ? (
        <ErrorCallout>
          {sites.error instanceof ApiError
            ? sites.error.message
            : "Could not load sites."}
        </ErrorCallout>
      ) : null}
      {canManage && members.isError ? (
        <ErrorCallout>
          {members.error instanceof ApiError
            ? members.error.message
            : "Could not load members."}
        </ErrorCallout>
      ) : null}

      {canManage ? (
        <Panel title="Schedule shift">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <Grid columns={{ initial: "1", md: "2" }} gap="4">
              <Box>
                <Text as="p" size="2" weight="medium" mb="1">
                  Site
                </Text>
                <Select.Root
                  value={defaultSiteId || undefined}
                  onValueChange={(v) => setForm({ ...form, siteId: v })}
                >
                  <Select.Trigger
                    placeholder="Select site"
                    style={{ width: "100%" }}
                  />
                  <Select.Content>
                    {(sites.data ?? []).map((site) => (
                      <Select.Item key={site.id} value={site.id}>
                        {site.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Box>
              <Box>
                <Label htmlFor="shift-name">Name</Label>
                <Box mt="1">
                  <Input
                    id="shift-name"
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </Box>
              </Box>
              <Box style={{ gridColumn: "1 / -1" }}>
                <Text as="p" size="2" weight="medium" mb="2">
                  Days
                </Text>
                <Flex gap="2" wrap="wrap" mb="3">
                  <Button
                    type="button"
                    size="1"
                    variant={sameDays(form.daysOfWeek, PRESET_MON_FRI) ? "default" : "outline"}
                    onClick={() => setForm({ ...form, daysOfWeek: PRESET_MON_FRI })}
                  >
                    Mon–Fri
                  </Button>
                  <Button
                    type="button"
                    size="1"
                    variant={sameDays(form.daysOfWeek, PRESET_MON_SAT) ? "default" : "outline"}
                    onClick={() => setForm({ ...form, daysOfWeek: PRESET_MON_SAT })}
                  >
                    Mon–Sat
                  </Button>
                </Flex>
                <Flex gap="3" wrap="wrap">
                  {WEEKDAYS.map((day) => {
                    const checked = form.daysOfWeek.includes(day.value);
                    return (
                      <Text as="label" key={day.value} size="2">
                        <Flex align="center" gap="2">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleDay(day.value)}
                          />
                          {day.label}
                        </Flex>
                      </Text>
                    );
                  })}
                </Flex>
              </Box>
              <Box>
                <Label htmlFor="starts">Start time</Label>
                <Box mt="1">
                  <Input
                    id="starts"
                    type="time"
                    value={form.startTime}
                    onChange={(event) =>
                      setForm({ ...form, startTime: event.target.value })
                    }
                  />
                </Box>
              </Box>
              <Box>
                <Label htmlFor="ends">End time</Label>
                <Box mt="1">
                  <Input
                    id="ends"
                    type="time"
                    value={form.endTime}
                    onChange={(event) =>
                      setForm({ ...form, endTime: event.target.value })
                    }
                  />
                </Box>
                <Text size="1" color="gray" mt="1" as="p">
                  End can be earlier than start for overnight shifts.
                </Text>
              </Box>
              <Box>
                <Text as="p" size="2" weight="medium" mb="1">
                  Supervisor
                </Text>
                <Select.Root
                  value={form.supervisorId || "__none__"}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      supervisorId: v === "__none__" ? "" : v,
                    })
                  }
                >
                  <Select.Trigger style={{ width: "100%" }} />
                  <Select.Content>
                    <Select.Item value="__none__">None</Select.Item>
                    {memberOptions.map((member) => (
                      <Select.Item key={member.userId} value={member.userId}>
                        {member.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Box>
            </Grid>
            <Flex mt="4" direction="column" gap="2">
              <Box>
                <Button
                  type="submit"
                  disabled={
                    create.isPending ||
                    form.daysOfWeek.length === 0 ||
                    !form.startTime ||
                    !form.endTime ||
                    form.startTime === form.endTime ||
                    !defaultSiteId
                  }
                >
                  Create shift
                </Button>
              </Box>
              {!defaultSiteId ? (
                <Text size="2" color="gray">
                  Create a site before scheduling shifts.
                </Text>
              ) : null}
            </Flex>
          </form>
        </Panel>
      ) : null}

      {shifts.isError ? (
        <ErrorCallout>
          {shifts.error instanceof ApiError
            ? shifts.error.message
            : "Could not load shifts."}
        </ErrorCallout>
      ) : null}

      {shifts.isLoading ? (
        <LoadingBlock label="Loading shifts…" />
      ) : (
        <Panel title="Scheduled shifts">
          {(shifts.data ?? []).length === 0 ? (
            <EmptyState
              title="No shifts yet."
              description={
                canManage
                  ? "Schedule your first recurring shift using the form above."
                  : "No shifts have been scheduled for your organization yet."
              }
            />
          ) : (
            <Table.Root variant="surface" size="2">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Site</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Window</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Supervisor / Staff</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(shifts.data ?? []).map((shift) => (
                  <Table.Row key={shift.id}>
                    <Table.Cell>
                      <Text size="2" weight="medium">
                        {shift.name}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2">{shift.site.name}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2" color="gray">
                        {formatShiftWindow(
                          shift.daysOfWeek ?? [],
                          shift.startTime,
                          shift.endTime,
                        )}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2" color="gray">
                        {shift.supervisor?.name ?? "No supervisor"}
                        {shift.assignments.length
                          ? ` · ${shift.assignments.map((item) => item.user.name).join(", ")}`
                          : ""}
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Panel>
      )}

      {handovers.isError ? (
        <ErrorCallout>
          {handovers.error instanceof ApiError
            ? handovers.error.message
            : "Could not load handovers."}
        </ErrorCallout>
      ) : null}

      {handovers.isLoading ? (
        <LoadingBlock label="Loading handovers…" />
      ) : (
        <Panel title="Handovers" actions={draftButton}>
          {(handovers.data ?? []).length === 0 ? (
            <EmptyState
              title={
                canManage
                  ? "No handovers drafted yet."
                  : "No published handovers yet."
              }
              description={
                canManage
                  ? 'Use "Draft handover" to generate a shift summary, then Publish when ready for the next crew.'
                  : "When a supervisor publishes a handover, it will appear here."
              }
            />
          ) : (
            <Flex direction="column" gap="4">
              {(handovers.data ?? []).map((item) => (
                <Box key={item.id}>
                  <Flex align="center" justify="between" gap="3" mb="2" wrap="wrap">
                    <Flex align="center" gap="2" wrap="wrap">
                      <Badge
                        color={handoverStatusColor(item.status)}
                        variant="soft"
                        size="1"
                      >
                        {item.status}
                      </Badge>
                      <Text size="2" color="gray">
                        {new Date(item.createdAt).toLocaleString()}
                      </Text>
                      {item.shift ? (
                        <Text size="2" color="gray">
                          · {item.shift.name} (
                          {formatShiftWindow(
                            item.shift.daysOfWeek,
                            item.shift.startTime,
                            item.shift.endTime,
                          )}
                          )
                        </Text>
                      ) : null}
                    </Flex>
                    {canPublishHandover && item.status === "DRAFT" ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => publish.mutate(item.id)}
                      >
                        Publish
                      </Button>
                    ) : null}
                  </Flex>
                  <Text size="2" as="p">
                    {item.report?.narrative ?? "No summary yet."}
                  </Text>
                  {item.report?.criticalIssues?.length ? (
                    <Text size="2" color="gray" as="p" mt="1">
                      Critical: {item.report.criticalIssues.join("; ")}
                    </Text>
                  ) : null}
                  {item.report?.priorities?.length ? (
                    <Text size="2" color="gray" as="p" mt="1">
                      Priorities: {item.report.priorities.join("; ")}
                    </Text>
                  ) : null}
                </Box>
              ))}
            </Flex>
          )}
        </Panel>
      )}
    </PageStack>
  );
}
