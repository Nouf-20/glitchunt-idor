# SupportDesk — Customer Support Portal (Acme Support)

A realistic, small SaaS customer-support portal running on **Cloudflare Workers + D1**.
Customers register, log in, open support tickets, get an invoice generated per ticket,
and download the official invoice as a **real PDF**.

- Bilingual UI: **English + Arabic** (RTL toggle in the header)
- Real auth: PBKDF2-SHA-256 password hashing, opaque sessions in D1, `HttpOnly` cookies
- Real data: relational D1 schema with migrations, deterministic seed
- Real PDFs: dependency-free PDF generator (valid `%PDF-1.4` documents)
- Workshop-friendly: one intentional vulnerability (IDOR on invoice download)

> The hidden token uses the format `SDC{...}` and lives **only inside the PDF bytes
> of invoice `1`**. It appears nowhere in source code, seeds, JSON APIs, or the UI.
> (This file documents the format only — not the value.)

## Workflow

```
Register → Login → Create Ticket → Generate Invoice → Download Invoice
```

1. **Register** (`POST /api/register`) — name, email, password (min 8 chars).
2. **Login** (`POST /api/login`) — sets an `HttpOnly` session cookie.
3. **Create ticket** (`POST /api/tickets`) — subject, description, category, priority.
   An invoice is generated automatically (billable support: $29–$149 by priority).
4. **Download invoice** (`GET /api/invoices/:id/download`) — returns `application/pdf`.

## Quick start (local)

Prerequisites: Node 18+, npm.

```bash
npm install
npm run db:migrate   # apply D1 migrations to the local database
npm run db:seed      # seed victim user + ticket + invoice id=1 (local)
npm run dev          # wrangler dev on http://127.0.0.1:8787
```

Then open http://127.0.0.1:8787, register a new account, open a ticket,
and download its invoice.

Verify everything end-to-end (needs `npm run dev` running):

```bash
npm run test:workflow
```

This registers a fresh user, exercises the whole workflow, performs the IDOR
exploit against invoice `1`, and asserts the token is absent from all JSON APIs
and source files.

## Deploy (remote)

```bash
npm run db:create            # first time only: creates supportdesk-db
# copy the printed database_id into wrangler.jsonc
npm run db:migrate:remote
npm run db:seed:remote
npm run deploy
```

## Project structure

```
src/index.ts          Worker entry: routing, sessions, tickets, invoices, PDF download
src/auth.ts           PBKDF2 hashing (WebCrypto), session tokens
src/pdf.ts            Dependency-free invoice PDF builder
public/index.html     App shell (EN/AR, RTL)
public/app.js         Frontend logic (fetch API, no build step)
public/styles.css     Styling
migrations/0001_schema.sql   users, sessions, tickets, invoices
scripts/seed.mjs      Deterministic seed: invoice id=1 belongs to the victim
scripts/test-workflow.mjs    Full workflow + exploit verification
wrangler.jsonc        Workers + D1 + assets configuration
```

## API reference

| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | no | liveness |
| POST | `/api/register` | no | `{name, email, password}` → sets session cookie |
| POST | `/api/login` | no | `{email, password}` → sets session cookie |
| POST | `/api/logout` | no | clears session + cookie |
| GET | `/api/me` | yes | current user |
| GET | `/api/tickets` | yes | own tickets only |
| POST | `/api/tickets` | yes | creates ticket **and** its invoice |
| GET | `/api/tickets/:id` | yes | ownership enforced |
| GET | `/api/invoices` | yes | own invoices only (metadata, no internals) |
| GET | `/api/invoices/:id` | yes | ⚠ no ownership check (same IDOR) |
| GET | `/api/invoices/:id/download` | yes | ⚠ no ownership check → **the vulnerability** |

All D1 access uses bound parameters (no string-concatenated SQL).
JSON invoice responses never include the internal support reference —
it is rendered only into the PDF.

## The intentional vulnerability (IDOR / Broken Access Control)

**Where.** `GET /api/invoices/:id/download` in `src/index.ts`
(and the metadata twin `GET /api/invoices/:id` — same root cause).
The handler authenticates the request (401 when logged out) and loads the
invoice by its `id`, but the SQL query has **no `AND user_id = ?` ownership
condition**.

**Why it is vulnerable.** Authentication answers *"who are you?"* but the
endpoint never answers *"is this yours?"*. Invoice IDs are sequential
integers, so any logged-in user can change the ID in the download URL —
e.g. from their own `/api/invoices/3/download` to `/api/invoices/1/download` —
and receive another customer's PDF, which contains that customer's internal
support reference token.

**The fix.** Enforce ownership server-side on every direct-object access:

```sql
-- vulnerable
SELECT ... FROM invoices i ... WHERE i.id = ?
-- fixed: scope the row to the session user
SELECT ... FROM invoices i ... WHERE i.id = ? AND i.user_id = ?
```

Return `404` (not `403`) when the scoped query finds nothing, so IDs cannot be
enumerated. Apply the same check to the JSON detail endpoint, keep the list
endpoint filtered by the session user (already the case), and add a regression
test: user B must not be able to download user A's invoice.

## Security notes (what was *not* weakened)

- Passwords: PBKDF2-SHA-256, 120k iterations, 16-byte random salt, constant-time compare.
- Sessions: 32-byte random tokens, expiry enforced, `HttpOnly; SameSite=Lax`
  cookies (`Secure` on HTTPS).
- SQL injection: every query uses `.bind(...)` parameters.
- XSS: the frontend inserts user data via `textContent`, never raw HTML.
- The seeded victim account uses a random, undisclosed password, so the token
  is reachable **only** through the IDOR — not by logging in as the victim.
- No `/flag` endpoint, no secrets in the repo, no external services.

## npm scripts

| Script | Purpose |
|---|---|
| `npm run dev` | local Worker + D1 + assets |
| `npm run check` | TypeScript typecheck |
| `npm run db:migrate` / `:remote` | apply migrations (local/remote) |
| `npm run db:seed` / `:remote` | deterministic seed (local/remote) |
| `npm run db:reset` | wipe local rows (workshop reset) |
| `npm run setup` | install + migrate + seed (local) |
| `npm run test:workflow` | verify workflow + exploit + hygiene |
| `npm run deploy` | deploy to Cloudflare |
