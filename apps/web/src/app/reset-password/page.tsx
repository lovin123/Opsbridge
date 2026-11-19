"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex, Text } from "@radix-ui/themes";
import { z } from "zod";
import { passwordSchema } from "@fieldops/shared";
import { AuthFrame } from "@/components/auth-frame";
import { Button, ErrorCallout, FieldError, Input, Label } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

const formSchema = z.object({ password: passwordSchema });

export default function ResetPasswordPage() {
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
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [error, setError] = useState<string | null>(null);

  const form = useForm<{ password: string }>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "" },
  });

  const submit = useMutation({
    mutationFn: (password: string) =>
      api<{ message: string }>("/auth/reset-password", {
        method: "POST",
        body: { token, password },
      }),
    onSuccess: () => router.replace("/sign-in"),
    onError: (cause: unknown) => {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not reset the password",
      );
    },
  });

  return (
    <AuthFrame
      title="Choose a new password"
      subtitle="This signs you out of other sessions."
    >
      <form
        onSubmit={form.handleSubmit((values) =>
          submit.mutate(values.password),
        )}
      >
        <Flex direction="column" gap="4">
          {error ? <ErrorCallout>{error}</ErrorCallout> : null}
          {!token ? (
            <ErrorCallout>This reset link is missing a token.</ErrorCallout>
          ) : null}
          <Box>
            <Label htmlFor="password">New password</Label>
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
            disabled={submit.isPending || !token}
          >
            Update password
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
