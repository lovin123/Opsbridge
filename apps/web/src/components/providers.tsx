"use client";

import { Theme } from "@radix-ui/themes";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { SessionResponse } from "@fieldops/shared";
import { ApiError, api } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <Theme
        accentColor="indigo"
        grayColor="slate"
        radius="medium"
        scaling="100%"
        panelBackground="solid"
        appearance="light"
        style={{ minHeight: "100%" }}
      >
        {children}
      </Theme>
    </QueryClientProvider>
  );
}

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<SessionResponse | null> => {
      try {
        return await api<SessionResponse>("/auth/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }
    },
  });
}
