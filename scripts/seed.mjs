/**
 * Deterministic seed for SupportDesk.
 *
 * Guarantees: invoice with id = 1 exists and belongs to a victim user
 * (not the attacker). The invoice PDF (and only the PDF) carries the
 * support reference token.
 *
 * Flag hygiene: the token is assembled at runtime so the literal marker
 * never appears in this file, in migrations, or in frontend sources.
 * Only the generated PDF bytes contain it.
 *
 * Usage:
 *   npm run db:migrate        # apply migrations (local)
 *   npm run db:seed           # seed local D1 (uses wrangler --local)
 *   npm run db:seed:remote    # seed remote D1
 */
import { execSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";

const REMOTE = process.argv.includes("--remote");
const DB = "supportdesk-db";
const MODE = REMOTE ? "--remote" : "--local";

// --- token assembly (avoids a static literal in the repo) ---
const open = String.fromCharCode(83, 68, 67, 123);
const close = String.fromCharCode(125);
const partA = "inv01ce" + "_" + "id0r";
const partB = "supp0rt" + "_" + "desk";
const partC = "7f3a" + "9c4e";
const TOKEN = open + partA + "_" + partB + "_" + partC + close;
const INTERNAL_NOTE = `Support verification token ${TOKEN} - keep with invoice records.`;

// --- victim identity (deterministic record, random undisclosed password) ---
const VICTIM = {
  name: "Layla Haddad",
  email: "layla.haddad@example.com",
  password: randomBytes(24).toString("hex"), // never printed, never committed
};
const TICKET = {
  subject: "Email sync fails on the mobile app",
  description:
    "Since last week the Android app stops syncing the support mailbox after ~1 hour. " +
    "Restarting the app fixes it temporarily. Two agents affected, both on the same account. " +
    "Please investigate and advise. Priority: business hours impact.",
  category: "technical",
  priority: "high",
  status: "open",
};
const INVOICE = {
  number: "INV-2026-0001-4821",
  amountCents: 11900,
  currency: "USD",
  status: "paid",
  issuedAt: "2026-09-18T09:30:00.000Z",
  dueAt: "2026-10-02T09:30:00.000Z",
};

function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  // Must match ITERATIONS in src/auth.ts (Workers cap PBKDF2 at 100k).
  return pbkdf2Sync(password, salt, 100_000, 32, "sha256").toString("hex");
}

function sqlQuote(s) {
  return `'${String(s).replaceAll("'", "''")}'`;
}

function d1(command) {
  const cmd = `npx wrangler d1 execute ${DB} ${MODE} --json --command ${JSON.stringify(command)}`;
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function d1Json(command) {
  const out = d1(command);
  const parsed = JSON.parse(out);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first?.results ?? [];
}

// 1) Idempotency: invoice id=1 already seeded?
const existing = d1Json("SELECT id, invoice_number FROM invoices WHERE id = 1");
if (existing.length > 0) {
  console.log(`Seed: invoice id=1 already exists (${existing[0].invoice_number}). Nothing to do.`);
  process.exit(0);
}

// 2) Create victim user (PBKDF2-SHA256, 100k iterations — same params as Worker).
// Reuse the existing victim row if a previous run was interrupted.
let victimRows = d1Json(`SELECT id FROM users WHERE email = ${sqlQuote(VICTIM.email.toLowerCase())}`);
let victimId = victimRows[0]?.id;
if (!victimId) {
  const salt = randomBytes(16).toString("hex");
  const hash = hashPassword(VICTIM.password, salt);
  const now = new Date().toISOString();
  d1(
    `INSERT INTO users (name, email, password_hash, password_salt, created_at) VALUES (` +
      `${sqlQuote(VICTIM.name)}, ${sqlQuote(VICTIM.email.toLowerCase())}, ` +
      `${sqlQuote(hash)}, ${sqlQuote(salt)}, ${sqlQuote(now)})`
  );
  victimRows = d1Json(`SELECT id FROM users WHERE email = ${sqlQuote(VICTIM.email.toLowerCase())}`);
  victimId = victimRows[0]?.id;
}
if (!victimId) throw new Error("Seed failed: victim user not created.");
console.log(`Seed: victim user id=${victimId}`);

// 3) Victim ticket (will be id=1 on a fresh DB; reused if already seeded).
let tickets = d1Json(`SELECT id FROM tickets WHERE user_id = ${victimId} ORDER BY id ASC`);
let ticketId = tickets[0]?.id;
if (!ticketId) {
  d1(
    `INSERT INTO tickets (user_id, subject, description, category, priority, status, created_at) VALUES (` +
      `${victimId}, ${sqlQuote(TICKET.subject)}, ${sqlQuote(TICKET.description)}, ` +
      `${sqlQuote(TICKET.category)}, ${sqlQuote(TICKET.priority)}, ${sqlQuote(TICKET.status)}, ` +
      `${sqlQuote("2026-09-18T09:12:00.000Z")})`
  );
  tickets = d1Json(`SELECT id FROM tickets WHERE user_id = ${victimId} ORDER BY id ASC`);
  ticketId = tickets[0]?.id;
}
if (!ticketId) throw new Error("Seed failed: victim ticket not created.");
console.log(`Seed: victim ticket id=${ticketId}`);

// 4) Victim invoice — must land on id=1 on a fresh DB.
d1(
  `INSERT INTO invoices (user_id, ticket_id, invoice_number, amount_cents, currency, status, issued_at, due_at, internal_note) VALUES (` +
    `${victimId}, ${ticketId}, ${sqlQuote(INVOICE.number)}, ${INVOICE.amountCents}, ` +
    `${sqlQuote(INVOICE.currency)}, ${sqlQuote(INVOICE.status)}, ` +
    `${sqlQuote(INVOICE.issuedAt)}, ${sqlQuote(INVOICE.dueAt)}, ${sqlQuote(INTERNAL_NOTE)})`
);
const invoices = d1Json("SELECT id, invoice_number FROM invoices ORDER BY id ASC");
console.log("Seed: invoices =", JSON.stringify(invoices));
const first = invoices[0];
if (Number(first?.id) !== 1) {
  console.warn(
    `WARNING: first invoice id is ${first?.id}, expected 1. ` +
      `For the workshop, reset the DB (npm run db:reset) then migrate + seed on a fresh database.`
  );
  process.exit(2);
}
console.log("Seed OK: invoice id=1 exists and belongs to the victim user.");
console.log("Seed OK: token lives only in the invoice PDF (internal_note column).");
