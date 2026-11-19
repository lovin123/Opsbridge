import { createHash, randomBytes } from 'crypto';

const API = process.env.API_URL || 'http://localhost:4000/api/v1';
const ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:3000';
const email = process.env.DEMO_EMAIL || 'admin@abc-facilities.example';
const password = process.env.DEMO_PASSWORD || 'FieldOps-demo-2026';

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

const results = [];

async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

await step('health', async () => {
  const res = await fetch(`${API}/health`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await json(res);
});

let cookie = '';
let orgId = '';

await step('signin', async () => {
  const res = await fetch(`${API}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  const body = await json(res);
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  cookie = cookieFrom(res);
  if (!cookie) throw new Error('No session cookie');
  orgId = body.memberships?.[0]?.organization?.id || '';
  if (!orgId) throw new Error('No organization membership');
  return { user: body.user?.email, org: Boolean(orgId) };
});

await step('nexconn-token', async () => {
  const res = await fetch(`${API}/nexconn/token`, {
    method: 'POST',
    headers: { Origin: ORIGIN, Cookie: cookie, 'X-FieldOps-Organization': orgId },
  });
  const body = await json(res);
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return {
    hasToken: Boolean(body.token),
    hasAppKey: Boolean(body.appKey),
    userIdPrefix: String(body.userId || '').slice(0, 2),
  };
});

await step('media-sign', async () => {
  const res = await fetch(`${API}/media/sign`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-FieldOps-Organization': orgId,
    },
    body: JSON.stringify({
      purpose: 'DOCUMENT',
      filename: 'probe.txt',
      mimeType: 'application/pdf',
      bytes: 1234,
    }),
  });
  const body = await json(res);
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return {
    hasSignature: Boolean(body.signature),
    hasFolder: Boolean(body.folder),
    publicIdIsLeaf: Boolean(body.publicId) && !String(body.publicId).includes('/'),
  };
});

await step('groq-classify', async () => {
  const res = await fetch(`${API}/ai/classify`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-FieldOps-Organization': orgId,
    },
    body: JSON.stringify({
      description: 'Elevator stuck between floors with passengers inside at Tower B.',
    }),
  });
  const body = await json(res);
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return {
    category: body.category,
    priority: body.priority,
    hasRationale: Boolean(body.rationale),
  };
});

await step('dashboard', async () => {
  const res = await fetch(`${API}/dashboard`, {
    headers: { Cookie: cookie, 'X-FieldOps-Organization': orgId },
  });
  const body = await json(res);
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return { active: body.active, feed: Array.isArray(body.feed) ? body.feed.length : 0 };
});

await step('context-access-denied-for-random-id', async () => {
  const fakeId = '00000000-0000-4000-8000-000000000099';
  const res = await fetch(`${API}/incidents/${fakeId}/context`, {
    headers: { Cookie: cookie, 'X-FieldOps-Organization': orgId },
  });
  if (res.status === 200) throw new Error('Context leaked for unknown incident');
  return { status: res.status };
});

for (const row of results) {
  console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}: ${JSON.stringify(row.detail)}`);
}
process.exit(results.every((row) => row.ok) ? 0 : 1);
