"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  signupSchema,
  type SessionResponse,
  type SignupInput,
} from "@fieldops/shared";
import { AuthFrame } from "@/components/auth-frame";
import { Button, ErrorCallout, FieldError, Input, Label } from "@/components/ui";
import { ApiError, api, safeNext } from "@/lib/api";

export default function SignUpPage() {
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
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const signup = useMutation({
    mutationFn: (body: SignupInput) =>
      api<SessionResponse>("/auth/signup", { method: "POST", body }),
    onSuccess: (session) => {
      queryClient.setQueryData(["session"], session);
      const next = params.get("next");
      router.replace(next ? safeNext(next) : "/onboarding");
    },
    onError: (cause: unknown) => {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not create the account",
      );
    },
  });

  const next = params.get("next");
  const inviteFlow = Boolean(next?.includes("/invite/accept"));

  return (
    <AuthFrame
      title="Create an account"
      subtitle={
        inviteFlow
          ? "Use the same email address the invitation was sent to, then accept the invite."
          : "You will create your organization on the next step."
      }
    >
      <form onSubmit={form.handleSubmit((values) => signup.mutate(values))}>
        <Flex direction="column" gap="4">
          {error ? <ErrorCallout>{error}</ErrorCallout> : null}
          <Box>
            <Label htmlFor="name">Name</Label>
            <Box mt="1">
              <Input
                id="name"
                autoComplete="name"
                {...form.register("name")}
              />
            </Box>
            <FieldError message={form.formState.errors.name?.message} />
          </Box>
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
                autoComplete="new-password"
                {...form.register("password")}
              />
            </Box>
            <FieldError message={form.formState.errors.password?.message} />
          </Box>
          <Button
            type="submit"
            style={{ width: "100%" }}
            disabled={signup.isPending}
          >
            Create account
          </Button>
        </Flex>
      </form>
      <Flex mt="4">
        <Text size="2" color="gray">
          Already registered?{" "}
          <Text asChild color="teal">
            <Link
              href={
                next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"
              }
            >
              Sign in
            </Link>
          </Text>
        </Text>
      </Flex>
    </AuthFrame>
  );
}
