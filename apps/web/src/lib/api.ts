import { useUiStore } from "@/store/ui-store";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  orgId?: string | null;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers();
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const orgId = options.orgId !== undefined ? options.orgId : useUiStore.getState().organizationId;
  if (orgId) {
    headers.set("X-Opsbridge-Organization", orgId);
  }

  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? "GET",
    headers,
    credentials: "include",
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => null)) as {
    message?: string | string[] | { message?: string };
    errors?: Record<string, string[] | undefined>;
  } | null;

  if (!response.ok) {
    throw new ApiError(messageFrom(payload), response.status);
  }

  return payload as T;
}

function messageFrom(payload: {
  message?: string | string[] | { message?: string };
  errors?: Record<string, string[] | undefined>;
} | null): string {
  const fieldError = payload?.errors
    ? Object.values(payload.errors).flat().find((item) => typeof item === "string")
    : undefined;
  if (fieldError) {
    return fieldError;
  }
  if (typeof payload?.message === "string") {
    return payload.message;
  }
  if (Array.isArray(payload?.message)) {
    return payload.message.join(", ");
  }
  if (payload?.message && typeof payload.message === "object" && payload.message.message) {
    return payload.message.message;
  }
  return "Request failed";
}

export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/app";
  }
  return value;
}
