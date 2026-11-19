"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Flex, Table, Text } from "@radix-ui/themes";
import { useSession } from "@/components/providers";
import { useCurrentOrganization } from "@/components/app-shell";
import { Button, ErrorCallout } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { EmptyState, LoadingBlock, PageHeader, PageStack, Panel } from "@/components/page";

interface Note {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const session = useSession();
  const current = useCurrentOrganization(session.data);
  const orgId = current?.organization.id;
  const queryClient = useQueryClient();

  const notes = useQuery({
    queryKey: ["notifications", orgId],
    enabled: Boolean(orgId),
    queryFn: () => api<Note[]>("/notifications", { orgId }),
  });

  const read = useMutation({
    mutationFn: (id: string) =>
      api(`/notifications/${id}/read`, { method: "POST", orgId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["notifications", orgId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["notifications-unread", orgId],
      });
    },
  });

  const readAll = useMutation({
    mutationFn: () =>
      api("/notifications/read-all", { method: "POST", orgId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["notifications", orgId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["notifications-unread", orgId],
      });
    },
  });

  const unread = (notes.data ?? []).filter((note) => !note.readAt).length;

  return (
    <PageStack>
      <PageHeader
        title="Notifications"
        actions={
          unread > 0 ? (
            <Button
              type="button"
              variant="outline"
              disabled={readAll.isPending}
              onClick={() => readAll.mutate()}
            >
              Mark all read ({unread})
            </Button>
          ) : undefined
        }
      />

      {notes.isError ? (
        <ErrorCallout>
          {notes.error instanceof ApiError
            ? notes.error.message
            : "Could not load notifications."}
        </ErrorCallout>
      ) : null}

      {notes.isLoading ? (
        <LoadingBlock label="Loading notifications…" />
      ) : (
        <Panel>
          {(notes.data ?? []).length === 0 ? (
            <EmptyState
              title="No notifications."
              description="You're all caught up."
            />
          ) : (
            <Table.Root variant="surface" size="2">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Notification</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Time</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(notes.data ?? []).map((note) => (
                  <Table.Row key={note.id}>
                    <Table.Cell>
                      <Text size="2" weight="medium" highContrast as="p">
                        {note.title}
                      </Text>
                      <Text size="2" color="gray" as="p">
                        {note.body}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2" color="gray">
                        {new Date(note.createdAt).toLocaleString()}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {note.readAt ? (
                        <Badge color="gray" size="1" variant="soft">
                          Read
                        </Badge>
                      ) : (
                        <Badge color="teal" size="1">
                          Unread
                        </Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {!note.readAt ? (
                        <Flex justify="end">
                          <Button
                            type="button"
                            variant="outline"
                            disabled={read.isPending}
                            onClick={() => read.mutate(note.id)}
                          >
                            Mark read
                          </Button>
                        </Flex>
                      ) : null}
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
