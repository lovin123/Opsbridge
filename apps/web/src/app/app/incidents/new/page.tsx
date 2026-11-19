"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Box, Flex, Grid, Select, Text, TextArea } from "@radix-ui/themes";
import { incidentCategories, incidentPriorities } from "@fieldops/shared";
import { useSession } from "@/components/providers";
import { useCurrentOrganization } from "@/components/app-shell";
import { Button, ErrorCallout, InfoCallout, Input, Label } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { LoadingBlock, PageHeader, PageStack, Panel } from "@/components/page";

interface SiteRow {
  id: string;
  name: string;
}

export default function NewIncidentPage() {
  const router = useRouter();
  const session = useSession();
  const current = useCurrentOrganization(session.data);
  const orgId = current?.organization.id;
  const sites = useQuery({
    queryKey: ["sites", orgId],
    enabled: Boolean(orgId),
    queryFn: () => api<SiteRow[]>("/sites", { orgId }),
  });
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "ELECTRICAL",
    priority: "HIGH",
    siteId: "",
    location: "",
    equipment: "",
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/incidents", {
        method: "POST",
        orgId,
        body: { ...form, siteId: form.siteId },
      }),
    onSuccess: (incident) => router.push(`/app/incidents/${incident.id}`),
    onError: (cause: unknown) =>
      setError(
        cause instanceof ApiError ? cause.message : "Could not create the incident",
      ),
  });

  const classify = useMutation({
    mutationFn: () =>
      api<{ category: string; priority: string; rationale: string }>("/ai/classify", {
        method: "POST",
        orgId,
        body: { description: `${form.title}\n${form.description}` },
      }),
    onSuccess: (result) => {
      setSuggestion(result.rationale);
      setForm((currentForm) => ({
        ...currentForm,
        category: result.category || currentForm.category,
        priority: result.priority || currentForm.priority,
      }));
      setError(null);
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Classification suggestion unavailable",
      ),
  });

  return (
    <PageStack>
      <PageHeader title="Create incident" />
      <Box style={{ maxWidth: 600 }}>
        <Panel>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <Flex direction="column" gap="4">
              {error ? <ErrorCallout>{error}</ErrorCallout> : null}
              {sites.isError ? (
                <ErrorCallout>
                  {sites.error instanceof ApiError
                    ? sites.error.message
                    : "Could not load sites."}
                </ErrorCallout>
              ) : null}
              {sites.isLoading ? <LoadingBlock label="Loading sites…" /> : null}
              {!sites.isLoading && !sites.isError && (sites.data ?? []).length === 0 ? (
                <ErrorCallout>
                  Add a site before creating an incident.
                </ErrorCallout>
              ) : null}
              {suggestion ? (
                <InfoCallout>{suggestion}</InfoCallout>
              ) : null}

              <Box>
                <Label htmlFor="title">Title</Label>
                <Box mt="1">
                  <Input
                    id="title"
                    value={form.title}
                    onChange={(event) =>
                      setForm({ ...form, title: event.target.value })
                    }
                  />
                </Box>
              </Box>

              <Box>
                <Label htmlFor="description">Description</Label>
                <Box mt="1">
                  <TextArea
                    id="description"
                    size="3"
                    value={form.description}
                    onChange={(event) =>
                      setForm({ ...form, description: event.target.value })
                    }
                    style={{ minHeight: 112 }}
                  />
                </Box>
              </Box>

              <Box>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    classify.isPending ||
                    `${form.title}\n${form.description}`.trim().length < 3
                  }
                  onClick={() => classify.mutate()}
                >
                  Suggest category
                </Button>
              </Box>

              <Grid columns="2" gap="4">
                <Box>
                  <Text as="p" size="2" weight="medium" mb="1">
                    Category
                  </Text>
                  <Select.Root
                    value={form.category}
                    onValueChange={(v) => setForm({ ...form, category: v })}
                  >
                    <Select.Trigger style={{ width: "100%" }} />
                    <Select.Content>
                      {incidentCategories.map((category) => (
                        <Select.Item key={category} value={category}>
                          {category}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Box>
                <Box>
                  <Text as="p" size="2" weight="medium" mb="1">
                    Priority
                  </Text>
                  <Select.Root
                    value={form.priority}
                    onValueChange={(v) => setForm({ ...form, priority: v })}
                  >
                    <Select.Trigger style={{ width: "100%" }} />
                    <Select.Content>
                      {incidentPriorities.map((priority) => (
                        <Select.Item key={priority} value={priority}>
                          {priority}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Box>
              </Grid>

              <Box>
                <Text as="p" size="2" weight="medium" mb="1">
                  Site
                </Text>
                <Select.Root
                  value={form.siteId || undefined}
                  onValueChange={(v) => setForm({ ...form, siteId: v })}
                >
                  <Select.Trigger placeholder="Select a site" style={{ width: "100%" }} />
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
                <Label htmlFor="equipment">Equipment</Label>
                <Box mt="1">
                  <Input
                    id="equipment"
                    value={form.equipment}
                    onChange={(event) =>
                      setForm({ ...form, equipment: event.target.value })
                    }
                  />
                </Box>
              </Box>

              <Box>
                <Label htmlFor="location">Location</Label>
                <Box mt="1">
                  <Input
                    id="location"
                    value={form.location}
                    onChange={(event) =>
                      setForm({ ...form, location: event.target.value })
                    }
                  />
                </Box>
              </Box>

              <Box>
                <Button
                  type="submit"
                  disabled={
                    create.isPending ||
                    !form.siteId ||
                    sites.isLoading ||
                    sites.isError
                  }
                >
                  Open incident
                </Button>
              </Box>
            </Flex>
          </form>
        </Panel>
      </Box>
    </PageStack>
  );
}
