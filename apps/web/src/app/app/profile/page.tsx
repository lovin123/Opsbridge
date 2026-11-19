"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Avatar, Box, Flex, Select, Text } from "@radix-ui/themes";
import {
  availabilityValues,
  updateProfileSchema,
  type UpdateProfileInput,
  type UserProfile,
} from "@fieldops/shared";
import { useSession } from "@/components/providers";
import { useCurrentOrganization } from "@/components/app-shell";
import { Button, ErrorCallout, FieldError, InfoCallout, Input, Label } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { LoadingBlock, PageHeader, PageStack, Panel } from "@/components/page";

const availabilityOptions = availabilityValues;

function availabilityColor(
  value: string,
): "teal" | "amber" | "gray" | "red" {
  if (value === "AVAILABLE") return "teal";
  if (value === "ON_BREAK") return "amber";
  if (value === "OFF_DUTY") return "gray";
  if (value === "UNAVAILABLE") return "red";
  return "gray";
}

export default function ProfilePage() {
  const session = useSession();
  const current = useCurrentOrganization(session.data);
  const orgId = current?.organization.id;
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [availability, setAvailability] = useState("AVAILABLE");
  const user = session.data?.user;

  const workforce = useQuery({
    queryKey: ["workforce-me", orgId],
    enabled: Boolean(orgId),
    queryFn: () => api<{ availability: string } | null>("/workforce/me", { orgId }),
  });

  useEffect(() => {
    if (workforce.data?.availability) {
      setAvailability(workforce.data.availability);
    }
  }, [workforce.data?.availability]);

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    values: user
      ? { name: user.name, phone: user.phone ?? "", jobTitle: user.jobTitle ?? "" }
      : undefined,
  });

  const save = useMutation({
    mutationFn: (body: UpdateProfileInput) =>
      api<UserProfile>("/users/me", { method: "PATCH", body }),
    onSuccess: async () => {
      setMessage("Profile updated.");
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (error: unknown) => {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Could not update your profile",
      );
    },
  });

  const saveAvailability = useMutation({
    mutationFn: () =>
      api("/workforce/me", {
        method: "PATCH",
        orgId,
        body: { availability },
      }),
    onSuccess: async () => {
      setMessage("Availability updated.");
      await queryClient.invalidateQueries({
        queryKey: ["workforce-me", orgId],
      });
    },
    onError: (error: unknown) => {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Could not update availability",
      );
    },
  });

  if (!user) {
    return <LoadingBlock label="Loading profile…" />;
  }

  return (
    <PageStack>
      <PageHeader title="Profile" />

      <Box style={{ maxWidth: 560 }}>
        <PageStack>
          {message ? <InfoCallout>{message}</InfoCallout> : null}

          {/* Avatar + identity */}
          <Flex align="center" gap="4">
            <Avatar
              size="5"
              radius="full"
              fallback={user.name.slice(0, 2).toUpperCase()}
              color="teal"
            />
            <Box>
              <Text size="4" weight="bold" highContrast as="p">
                {user.name}
              </Text>
              <Text size="2" color="gray" as="p">
                {user.email}
              </Text>
            </Box>
          </Flex>

          <Panel title="Personal details">
            <form
              onSubmit={form.handleSubmit((values) => save.mutate(values))}
            >
              <Box mb="4">
                <Label htmlFor="profile-name">Name</Label>
                <Box mt="1">
                  <Input id="profile-name" {...form.register("name")} />
                </Box>
                <FieldError message={form.formState.errors.name?.message} />
              </Box>
              <Box mb="4">
                <Label htmlFor="profile-title">Job title</Label>
                <Box mt="1">
                  <Input id="profile-title" {...form.register("jobTitle")} />
                </Box>
              </Box>
              <Box mb="4">
                <Label htmlFor="profile-phone">Phone</Label>
                <Box mt="1">
                  <Input id="profile-phone" {...form.register("phone")} />
                </Box>
              </Box>
              <Button type="submit" disabled={save.isPending}>
                Save profile
              </Button>
            </form>
          </Panel>

          <Panel title="Field availability">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveAvailability.mutate();
              }}
            >
              <Text size="2" color="gray" as="p" mb="3">
                Separate from Nexconn online presence.
              </Text>
              <Box mb="4">
                <Text as="p" size="2" weight="medium" mb="1">
                  Status
                </Text>
                <Select.Root
                  value={availability}
                  onValueChange={setAvailability}
                >
                  <Select.Trigger style={{ width: "100%" }} />
                  <Select.Content>
                    {availabilityOptions.map((option) => (
                      <Select.Item key={option} value={option}>
                        {option}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Box>
              {workforce.isError ? (
                <Box mb="4">
                  <ErrorCallout>
                    {workforce.error instanceof ApiError
                      ? workforce.error.message
                      : "Could not load availability."}
                  </ErrorCallout>
                </Box>
              ) : null}
              <Button
                type="submit"
                variant="outline"
                disabled={
                  saveAvailability.isPending ||
                  !orgId ||
                  workforce.isLoading ||
                  workforce.isError
                }
              >
                Save availability
              </Button>
            </form>
          </Panel>
        </PageStack>
      </Box>
    </PageStack>
  );
}
