import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "Opsbridge-Nexconn-Writeup.pdf");

const appKey = "e5t4ouvpenwva";

const sections = [
  {
    heading: "Why we built it, and the problem it solves",
    body: [
      "Field and facilities teams still coordinate incidents over scattered WhatsApp threads, phone trees, and spreadsheets. Context gets lost, the wrong people get pulled in, and there is no clear link between the work order and the conversation.",
      "Opsbridge is a multi-tenant workforce operations platform for organization admins, operations managers, supervisors, and technicians. It brings sites, crews, shifts, handovers, and incidents into one app - and puts real-time messaging and calling next to the work, so when something breaks in the field the right people share the same channel and history.",
    ],
  },
  {
    heading: "Features that use the Nexconn SDK",
    body: [
      "* Group channels - incident channels and site/team channels in Communications and on the incident workspace (ChatUI openChannel with GroupChannelIdentifier).",
      "* Direct (1:1) channels - People tab in Communications for DMs between organization members.",
      "* Message history and live chat - ChatUI channel detail loads and syncs conversation history after connect; text send via ChatUI / app.sendMessage.",
      "* Voice / HD voice notes - mic control in the chat toolbar; voice upload through Nexconn media helpers.",
      "* Speech-to-text (STT) - ChatUI message menu Transcribe when the Nexconn console STT service is enabled.",
      "* Audio and video calls - @nexconn/call from the chat header for 1:1 and group calls; group callees resolved from channel members.",
      "* Connection and profiles - NCEngine connect with server-issued tokens; connection status in the UI; ServiceHooks for user/group profiles and member counts.",
    ],
  },
  {
    heading: "Nexconn App Key",
    body: [
      `App Key: ${appKey}`,
      "Area: SG",
      "(App Secret is kept server-side only and is not included in this document.)",
    ],
  },
];

function pdfEscape(text) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const ops = [];
let y = 760;
const left = 50;
const maxChars = 92;

function addText(fontSize, text) {
  ops.push("BT");
  ops.push(`/F1 ${fontSize} Tf`);
  ops.push(`${left} ${y} Td`);
  ops.push(`(${pdfEscape(text)}) Tj`);
  ops.push("ET");
  y -= fontSize + 4;
}

addText(16, "Opsbridge - Nexconn Hackathon Write-up");
y -= 12;

for (const section of sections) {
  if (y < 100) break;
  addText(12, section.heading);
  y -= 4;
  for (const para of section.body) {
    for (const line of wrap(para, maxChars)) {
      if (y < 60) break;
      addText(10, line);
    }
    y -= 6;
  }
  y -= 8;
}

const stream = ops.join("\n");
const streamLength = Buffer.byteLength(stream, "utf8");

const objects = [
  "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
  "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
  "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
  `4 0 obj<< /Length ${streamLength} >>stream\n${stream}\nendstream\nendobj\n`,
  "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
];

let pdf = "%PDF-1.4\n";
const offsets = [0];
for (const obj of objects) {
  offsets.push(Buffer.byteLength(pdf, "utf8"));
  pdf += obj;
}
const xrefStart = Buffer.byteLength(pdf, "utf8");
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += "0000000000 65535 f \n";
for (let i = 1; i < offsets.length; i += 1) {
  pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
pdf += `startxref\n${xrefStart}\n%%EOF\n`;

fs.writeFileSync(outPath, pdf);
console.log(outPath);
