"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Badge, Box, Card, Flex, Tabs, Text } from "@radix-ui/themes";
import { NexconnChat } from "@/components/nexconn-chat";
import { useSession } from "@/components/providers";
import { useCurrentOrganization } from "@/components/app-shell";
import { ApiError, api } from "@/lib/api";
import { EmptyState, LoadingBlock, PageHeader, PageStack } from "@/components/page";
import { ErrorCallout } from "@/components/ui";

interface ChannelRow {
  channelId: string;
  name: string;
  kind: string;
  setupStatus: string;
}

interface PersonRow {
  userId: string;
  name: string;
  nexconnUserId: string;
  presence: string;
}

function channelStatusColor(status: string): "indigo" | "amber" | "red" | "gray" {
  if (status === "READY") return "indigo";
  if (status === "PENDING" || status === "PROVISIONING") return "amber";
  if (status === "FAILED") return "red";
  return "gray";
}

function presenceColor(presence: string): "indigo" | "gray" | "amber" {
  if (presence === "ONLINE") return "indigo";
  if (presence === "AWAY") return "amber";
  return "gray";
}

export default function CommunicationsPage() {
  const session = useSession();
  const current = useCurrentOrganization(session.data);
  const orgId = current?.organization.id;
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"group" | "direct">("group");

  useEffect(() => {
    setSelected(null);
  }, [orgId]);

  const channels = useQuery({
    queryKey: ["channels", orgId],
    enabled: Boolean(orgId),
    queryFn: () => api<ChannelRow[]>("/nexconn/channels", { orgId }),
  });

  const people = useQuery({
    queryKey: ["nexconn-people", orgId],
    enabled: Boolean(orgId),
    queryFn: () => api<PersonRow[]>("/nexconn/people", { orgId }),
  });

  const others = (people.data ?? []).filter((person) => person.userId !== session.data?.user.id);
  const readyChannels = (channels.data ?? []).filter((channel) => channel.setupStatus === "READY");
  const selectedValid =
    mode === "group"
      ? readyChannels.some((channel) => channel.channelId === selected)
      : others.some((person) => person.nexconnUserId === selected);
  const active =
    (selected && selectedValid ? selected : null) ??
    (mode === "group" ? (readyChannels[0]?.channelId ?? null) : (others[0]?.nexconnUserId ?? null));
  const activeTitle =
    mode === "group"
      ? (channels.data ?? []).find((channel) => channel.channelId === active)?.name
      : others.find((person) => person.nexconnUserId === active)?.name;

  return (
    <PageStack>
      <PageHeader
        title="Communications"
        description="Channels you’re in and people in your organization."
      />

      {channels.isError || people.isError ? (
        <ErrorCallout>
          {(channels.error instanceof ApiError && channels.error.message) ||
            (people.error instanceof ApiError && people.error.message) ||
            "Could not load conversations."}
        </ErrorCallout>
      ) : null}

      <Flex gap="4" align="start" direction={{ initial: "column", lg: "row" }}>
        <Card size="2" variant="surface" style={{ width: "100%", maxWidth: 300, flexShrink: 0 }}>
          <Tabs.Root
            value={mode}
            onValueChange={(value) => {
              setMode(value as "group" | "direct");
              setSelected(null);
            }}
          >
            <Tabs.List mb="3">
              <Tabs.Trigger value="group">Channels</Tabs.Trigger>
              <Tabs.Trigger value="direct">People</Tabs.Trigger>
            </Tabs.List>

            {channels.isLoading || people.isLoading ? <LoadingBlock label="Loading…" /> : null}

            <Tabs.Content value="group">
              {!channels.isLoading && readyChannels.length === 0 && (channels.data ?? []).length === 0 ? (
                <EmptyState
                  title="No channels yet"
                  description="Join or create a team to get a channel here."
                />
              ) : (
                <Flex direction="column" gap="1">
                  {(channels.data ?? []).map((channel) => {
                    const ready = channel.setupStatus === "READY";
                    const isActive = active === channel.channelId && mode === "group";
                    return (
                      <Box
                        key={channel.channelId}
                        p="2"
                        style={{
                          borderRadius: "var(--radius-2)",
                          cursor: ready ? "pointer" : "not-allowed",
                          opacity: ready ? 1 : 0.55,
                          background: isActive ? "var(--accent-a3)" : undefined,
                        }}
                        onClick={() => {
                          if (ready) setSelected(channel.channelId);
                        }}
                      >
                        <Text size="2" weight="medium" highContrast as="p">
                          {channel.name}
                        </Text>
                        <Flex gap="1" align="center" mt="1">
                          <Text size="1" color="gray">
                            {channel.kind}
                          </Text>
                          <Badge color={channelStatusColor(channel.setupStatus)} size="1" variant="soft">
                            {channel.setupStatus}
                          </Badge>
                        </Flex>
                      </Box>
                    );
                  })}
                </Flex>
              )}
            </Tabs.Content>

            <Tabs.Content value="direct">
              {!people.isLoading && others.length === 0 ? (
                <EmptyState title="No people yet" description="Invite teammates to message them here." />
              ) : (
                <Flex direction="column" gap="1">
                  {others.map((person) => {
                    const isActive = active === person.nexconnUserId && mode === "direct";
                    return (
                      <Box
                        key={person.nexconnUserId}
                        p="2"
                        style={{
                          borderRadius: "var(--radius-2)",
                          cursor: "pointer",
                          background: isActive ? "var(--accent-a3)" : undefined,
                        }}
                        onClick={() => setSelected(person.nexconnUserId)}
                      >
                        <Text size="2" weight="medium" highContrast as="p">
                          {person.name}
                        </Text>
                        <Badge color={presenceColor(person.presence)} size="1" variant="soft" mt="1">
                          {person.presence}
                        </Badge>
                      </Box>
                    );
                  })}
                </Flex>
              )}
            </Tabs.Content>
          </Tabs.Root>
        </Card>

        <Box style={{ flex: 1, minWidth: 0, height: "min(72vh, 780px)", minHeight: 520 }}>
          {active ? (
            <NexconnChat
              layout="channel"
              channelId={active}
              mode={mode}
              title={activeTitle ?? undefined}
            />
          ) : (
            <Card size="2" variant="surface" style={{ height: "100%" }}>
              <EmptyState
                title="No conversation selected"
                description="Pick a channel or person from the list."
              />
            </Card>
          )}
        </Box>
      </Flex>
    </PageStack>
  );
}
