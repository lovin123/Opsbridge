const API = process.env.API_URL || 'http://localhost:4000/api/v1';
const ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:3000';
const email = process.env.DEMO_EMAIL || 'admin@abc-facilities.example';
const password = process.env.DEMO_PASSWORD || 'FieldOps-demo-2026';

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function json(res) {
  return JSON.parse(await res.text());
}

const signin = await fetch(`${API}/auth/signin`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  body: JSON.stringify({ email, password }),
});
const session = await json(signin);
const cookie = cookieFrom(signin);
const orgId = session.memberships[0].organization.id;
const headers = {
  Origin: ORIGIN,
  Cookie: cookie,
  'X-FieldOps-Organization': orgId,
  'Content-Type': 'application/json',
};

const incidents = await json(await fetch(`${API}/incidents`, { headers }));
const incident = incidents[0];
if (!incident) {
  console.log('FAIL no-incident');
  process.exit(1);
}

const channel = await fetch(`${API}/incidents/${incident.id}/channel`, {
  method: 'POST',
  headers,
});
const channelBody = await json(channel);
console.log(
  `${channel.ok ? 'PASS' : 'FAIL'} channel-retry: ${JSON.stringify({
    status: channel.status,
    setup: channelBody.channelSetup,
    error: channelBody.channelError,
    channelId: channelBody.channelId,
  })}`,
);

const pdf = Buffer.from(
  '%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
);
const signedRes = await fetch(`${API}/media/sign`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    purpose: 'DOCUMENT',
    filename: 'probe.pdf',
    mimeType: 'application/pdf',
    bytes: pdf.length,
    incidentId: incident.id,
  }),
});
const signed = await json(signedRes);
if (!signedRes.ok) {
  console.log(`FAIL media-sign-incident: ${signed.message || signedRes.status}`);
  process.exit(1);
}

const form = new FormData();
form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'probe.pdf');
form.append('api_key', signed.apiKey);
form.append('timestamp', String(signed.timestamp));
form.append('signature', signed.signature);
form.append('folder', signed.folder);
form.append('public_id', signed.publicId);
form.append('type', signed.type);

const upload = await fetch(`https://api.cloudinary.com/v1_1/${signed.cloudName}/raw/upload`, {
  method: 'POST',
  body: form,
});
const uploaded = await upload.json();
if (!upload.ok || !uploaded.public_id) {
  console.log(`FAIL cloudinary-upload: ${uploaded.error?.message || upload.status}`);
  process.exit(1);
}

const confirmRes = await fetch(`${API}/media/confirm`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    grantId: signed.grantId,
    publicId: uploaded.public_id,
    resourceType: 'raw',
    mimeType: 'application/pdf',
    bytes: uploaded.bytes || pdf.length,
    format: uploaded.format,
  }),
});
const confirmed = await json(confirmRes);
console.log(
  `${confirmRes.ok ? 'PASS' : 'FAIL'} media-confirm: ${JSON.stringify({
    status: confirmRes.status,
    message: confirmed.message,
    id: confirmed.id,
    publicIdMatch: confirmed.publicId === uploaded.public_id,
    uploadedType: uploaded.type,
    uploadedPublicId: uploaded.public_id,
  })}`,
);

if (!confirmRes.ok || !confirmed.id) {
  process.exit(1);
}

const urlRes = await fetch(`${API}/media/${confirmed.id}/url`, {
  headers: { Cookie: cookie, 'X-FieldOps-Organization': orgId },
});
const urlBody = await json(urlRes);
console.log(
  `${urlRes.ok && urlBody?.url ? 'PASS' : 'FAIL'} media-url: ${JSON.stringify({
    status: urlRes.status,
    hasUrl: Boolean(urlBody?.url),
  })}`,
);
