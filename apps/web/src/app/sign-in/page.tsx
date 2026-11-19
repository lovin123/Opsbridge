"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex, Text } from "@radix-ui/themes";
import { signinSchema, type SessionResponse, type SigninInput } from "@fieldops/shared";
import { AuthFrame } from "@/components/auth-frame";
import { Button, ErrorCallout, FieldError, Input, Label } from "@/components/ui";
import { ApiError, api, safeNext } from "@/lib/api";

export default function SignInPage() {
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
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SigninInput>({
    resolver: zodResolver(signinSchema),
    defaultValues: { email: "", password: "" },
  });

  const signin = useMutation({
    mutationFn: (body: SigninInput) =>
      api<SessionResponse>("/auth/signin", { method: "POST", body }),
    onSuccess: (session) => {
      queryClient.setQueryData(["session"], session);
      const next = safeNext(params.get("next"));
      router.replace(
        session.memberships.length === 0 && next === "/app"
          ? "/onboarding"
          : next,
      );
    },
    onError: (cause: unknown) => {
      setError(cause instanceof ApiError ? cause.message : "Could not sign in");
    },
  });

  return (
    <AuthFrame
      title="Sign in"
      subtitle="Use your Opsbridge account to open the workspace."
    >
      <form onSubmit={form.handleSubmit((values) => signin.mutate(values))}>
        <Flex direction="column" gap="4">
          {error ? <ErrorCallout>{error}</ErrorCallout> : null}
          <Box>
            <Label htmlFor="email">Email</Label>
            <Box mt="1">
              <Input
                id="email"
                type="email"
                autoComplete="email"
                {...form.register("email")}
              />
            </Box>
            <FieldError message={form.formState.errors.email?.message} />
          </Box>
          <Box>
            <Label htmlFor="password">Password</Label>
            <Box mt="1">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...form.register("password")}
              />
            </Box>
            <FieldError message={form.formState.errors.password?.message} />
          </Box>
          <Button
            type="submit"
            style={{ width: "100%" }}
            disabled={signin.isPending}
          >
            Sign in
          </Button>
        </Flex>
      </form>
      <Flex direction="column" gap="2" mt="4">
        <Text size="2" color="gray">
          <Text asChild color="teal">
            <Link href="/forgot-password">Forgot password</Link>
          </Text>
        </Text>
        <Text size="2" color="gray">
          New here?{" "}
          <Text asChild color="teal">
            <Link
              href={
                params.get("next")
                  ? `/sign-up?next=${encodeURIComponent(params.get("next")!)}`
                  : "/sign-up"
              }
            >
              Create an account
            </Link>
          </Text>
        </Text>
      </Flex>
    </AuthFrame>
  );
}
