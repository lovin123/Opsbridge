"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import {
  createOrganizationSchema,
  type CreateOrganizationInput,
  type MembershipSummary,
} from "@fieldops/shared";
import { AuthFrame } from "@/components/auth-frame";
import { useSession } from "@/components/providers";
import { Button, ErrorCallout, FieldError, Input, Label } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useUiStore } from "@/store/ui-store";

export default function OnboardingPage() {
  const session = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const setOrganizationId = useUiStore((state) => state.setOrganizationId);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: "", industry: "", timezone: "Asia/Kolkata" },
  });

  useEffect(() => {
    if (session.isSuccess && session.data === null) {
      router.replace("/sign-in");
    }
    if ((session.data?.memberships.length ?? 0) > 0) {
      router.replace("/app");
    }
  }, [session.data, session.isSuccess, router]);

  const create = useMutation({
    mutationFn: (body: CreateOrganizationInput) =>
      api<MembershipSummary>("/organizations", { method: "POST", body }),
    onSuccess: async (membership) => {
      setOrganizationId(membership.organization.id);
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      router.replace("/app");
    },
    onError: (cause: unknown) => {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not create the organization",
      );
    },
  });

  return (
    <AuthFrame
      title="Create your organization"
      subtitle="You become the organization admin and can invite the rest of the team."
    >
      <form onSubmit={form.handleSubmit((values) => create.mutate(values))}>
        <Flex direction="column" gap="4">
          {error ? <ErrorCallout>{error}</ErrorCallout> : null}
          <Box>
            <Label htmlFor="name">Organization name</Label>
            <Box mt="1">
              <Input id="name" {...form.register("name")} />
            </Box>
            <FieldError message={form.formState.errors.name?.message} />
          </Box>
          <Box>
            <Label htmlFor="industry">Industry</Label>
            <Box mt="1">
              <Input id="industry" {...form.register("industry")} />
            </Box>
          </Box>
          <Box>
            <Label htmlFor="timezone">Timezone</Label>
            <Box mt="1">
              <Input id="timezone" {...form.register("timezone")} />
            </Box>
          </Box>
          <Button
            type="submit"
            style={{ width: "100%" }}
            disabled={create.isPending}
          >
            Create organization
          </Button>
        </Flex>
      </form>
    </AuthFrame>
  );
}
