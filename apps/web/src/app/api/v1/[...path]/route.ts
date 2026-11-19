import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const droppedRequestHeaders = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
]);

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const api = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
  const target = `${api}/api/v1/${path.join("/")}${request.nextUrl.search}`;
  const headers = new Headers();

  request.headers.forEach((value, key) => {
    if (!droppedRequestHeaders.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
  });

  const outbound = new Headers();
  response.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (name === "set-cookie" || name === "content-encoding" || name === "content-length") {
      return;
    }
    outbound.set(key, value);
  });

  for (const cookie of response.headers.getSetCookie()) {
    outbound.append("set-cookie", cookie);
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: outbound,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
