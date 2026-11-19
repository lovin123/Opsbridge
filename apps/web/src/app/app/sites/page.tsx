"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Box, Flex, Table, Text } from "@radix-ui/themes";
import { useSession } from "@/components/providers";
import { useCurrentOrganization } from "@/components/app-shell";
import { Button, ErrorCallout, Input } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { EmptyState, LoadingBlock, PageHeader, PageStack, Panel } from "@/components/page";

export default function SitesPage() {
  const session = useSession();
  const current = useCurrentOrganization(session.data);
  const orgId = current?.organization.id;
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sites = useQuery({
    queryKey: ["sites", orgId],
    enabled: Boolean(orgId),
    queryFn: () =>
      api<Array<{ id: string; name: string; address: string | null }>>(
        "/sites",
        { orgId },
      ),
  });

  const create = useMutation({
    mutationFn: () =>
      api("/sites", { method: "POST", orgId, body: { name, address } }),
    onSuccess: async () => {
      setName("");
      setAddress("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["sites", orgId] });
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof ApiError ? cause.message : "Could not create site",
      ),
  });

  const canManage = current?.permissions?.includes("sites.manage") ?? false;

  return (
    <PageStack>
      <PageHeader title="Sites" description="Physical locations your team operates from." />

      {error ? <ErrorCallout>{error}</ErrorCallout> : null}

      {canManage ? (
        <Panel title="Add site">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <Flex gap="3" wrap="wrap" align="end">
              <Box style={{ minWidth: 180, flex: 1 }}>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Site name"
                />
              </Box>
              <Box style={{ minWidth: 220, flex: 2 }}>
                <Input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="Address"
                />
              </Box>
              <Button
                type="submit"
                disabled={create.isPending || name.trim().length < 2}
              >
                Add site
              </Button>
            </Flex>
          </form>
        </Panel>
      ) : null}

      {sites.isError ? (
        <ErrorCallout>
          {sites.error instanceof ApiError
            ? sites.error.message
            : "Could not load sites."}
        </ErrorCallout>
      ) : null}

      {sites.isLoading ? (
        <LoadingBlock label="Loading sites…" />
      ) : (
        <Panel title="All sites">
          {(sites.data ?? []).length === 0 ? (
            <EmptyState
              title="No sites yet."
              description="Add your first site to start scheduling shifts and incidents."
            />
          ) : (
            <Table.Root variant="surface" size="2">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Address</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(sites.data ?? []).map((site) => (
                  <Table.Row key={site.id}>
                    <Table.Cell>
                      <Text size="2" weight="medium" highContrast>
                        {site.name}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="2" color="gray">
                        {site.address ?? "—"}
                      </Text>
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
