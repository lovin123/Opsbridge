"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  forgotPasswordSchema,
  type ForgotPasswordInput,
  type ForgotPasswordResponse,
} from "@fieldops/shared";
import { AuthFrame } from "@/components/auth-frame";
import { Button, ErrorCallout, FieldError, InfoCallout, Input, Label } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [result, setResult] = useState<ForgotPasswordResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const submit = useMutation({
    mutationFn: (body: ForgotPasswordInput) =>
      api<ForgotPasswordResponse>("/auth/forgot-password", {
        method: "POST",
        body,
      }),
    onSuccess: (response) => {
      setError(null);
      setResult(response);
    },
    onError: (cause: unknown) => {
      setError(
        cause instanceof ApiError ? cause.message : "Could not start a reset",
      );
    },
  });

  return (
    <AuthFrame
      title="Reset your password"
      subtitle="If the email matches an account, a reset link is issued. In development the link is shown here."
    >
      <form onSubmit={form.handleSubmit((values) => submit.mutate(values))}>
        <Flex direction="column" gap="4">
          {error ? <ErrorCallout>{error}</ErrorCallout> : null}
          {result ? <InfoCallout>{result.message}</InfoCallout> : null}
          {result?.devResetUrl ? (
            <Text size="2" style={{ wordBreak: "break-all" }}>
              <Text asChild color="teal">
                <a href={result.devResetUrl}>{result.devResetUrl}</a>
              </Text>
            </Text>
          ) : null}
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
          <Button
            type="submit"
            style={{ width: "100%" }}
            disabled={submit.isPending}
          >
            Send reset link
          </Button>
        </Flex>
      </form>
      <Flex mt="4">
        <Text size="2" color="gray">
          <Text asChild color="teal">
            <Link href="/sign-in">Back to sign in</Link>
          </Text>
        </Text>
      </Flex>
    </AuthFrame>
  );
}
