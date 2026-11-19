"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button, Flex, Text } from "@radix-ui/themes";
import { ApiError } from "@/lib/api";
import { useSession } from "@/components/providers";
import { ErrorCallout } from "@/components/ui";

export default function HomePage() {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.data) {
      router.replace(session.data.memberships.length > 0 ? "/app" : "/onboarding");
    } else if (session.isSuccess && session.data === null) {
      router.replace("/sign-in");
    }
  }, [session.data, session.isSuccess, router]);

  if (session.isError) {
    return (
      <Flex align="center" justify="center" minHeight="100vh" direction="column" gap="4" p="6">
        <ErrorCallout>
          {session.error instanceof ApiError ? session.error.message : "Could not load your session."}
        </ErrorCallout>
        <Button variant="soft" onClick={() => void session.refetch()}>
          Retry
        </Button>
      </Flex>
    );
  }

  return (
    <Flex align="center" justify="center" minHeight="100vh">
      <Text size="2" color="gray">
        Loading Opsbridge…
      </Text>
    </Flex>
  );
}
