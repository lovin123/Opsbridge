"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { AuthFrame } from "@/components/auth-frame";
import { useSession } from "@/components/providers";
import { Button, ErrorCallout } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useUiStore } from "@/store/ui-store";

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <Flex align="center" justify="center" minHeight="100vh">
          <Text size="2" color="gray">
            Loading…
          </Text>
        </Flex>
      }
    >
      <AcceptInvite />
    </Suspense>
  );
}

function AcceptInvite() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const router = useRouter();
  const session = useSession();
  const queryClient = useQueryClient();
  const setOrganizationId = useUiStore((state) => state.setOrganizationId);
  const [error, setError] = useState<string | null>(null);

  const nextQuery = useMemo(
    () =>
      encodeURIComponent(
        token ? `/invite/accept?token=${token}` : "/invite/accept",
      ),
    [token],
  );

  useEffect(() => {
    if (!token) {
      setError("This invitation link is missing a token.");
      return;
    }
    if (session.isLoading) {
      return;
    }
    if (session.data === null) {
      router.replace(`/sign-in?next=${nextQuery}`);
    }
  }, [session.isLoading, session.data, router, token, nextQuery]);

  const accept = useMutation({
    mutationFn: () =>
      api<{ organizationId: string }>("/invitations/accept", {
        method: "POST",
        body: { token },
      }),
    onSuccess: async (result) => {
      setOrganizationId(result.organizationId);
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      router.replace("/app");
    },
    onError: (cause: unknown) => {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not accept the invitation",
      );
    },
  });

  if (!token) {
    return (
      <AuthFrame title="Invitation unavailable" subtitle="This link is incomplete.">
        <ErrorCallout>
          {error ?? "This invitation link is missing a token."}
        </ErrorCallout>
        <Flex mt="3">
          <Text asChild size="2" color="teal">
            <Link href="/sign-in">Go to sign in</Link>
          </Text>
        </Flex>
      </AuthFrame>
    );
  }

  if (session.isError) {
    return (
      <AuthFrame
        title="Join the organization"
        subtitle="Could not verify your session."
      >
        <ErrorCallout>
          {session.error instanceof ApiError
            ? session.error.message
            : "Could not load your session."}
        </ErrorCallout>
        <Flex mt="3">
          <Button type="button" onClick={() => void session.refetch()}>
            Retry
          </Button>
        </Flex>
      </AuthFrame>
    );
  }

  if (session.isLoading || !session.data) {
    return (
      <AuthFrame
        title="Join the organization"
        subtitle="Sign in with the invited email to continue."
      >
        <Text size="2" color="gray" as="p">
          Redirecting you to sign in…
        </Text>
        <Text size="2" color="gray" as="p" mt="2">
          New here?{" "}
          <Text asChild color="teal">
            <Link href={`/sign-up?next=${nextQuery}`}>Create an account</Link>
          </Text>{" "}
          with the invited email first.
        </Text>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Join the organization"
      subtitle={`Signed in as ${session.data.user.email}. Accept only if this is the invited address.`}
    >
      {error ? (
        <Flex mb="3">
          <ErrorCallout>{error}</ErrorCallout>
        </Flex>
      ) : null}
      <Button
        type="button"
        disabled={accept.isPending}
        onClick={() => accept.mutate()}
      >
        Accept invitation
      </Button>
    </AuthFrame>
  );
}
