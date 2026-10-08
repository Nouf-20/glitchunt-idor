import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  sessionExpiryIso,
} from "./auth";
import { buildInvoicePdf } from "./pdf";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
}

const COMPANY_NAME = "Acme Support";
const SESSION_COOKIE = "session";
const SESSION_DAYS = 7;

// ---------- helpers ----------

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === name) {
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return null;
}

function buildSessionCookie(requestUrl: string, token: string, maxAgeSec: number): string {
  const url = new URL(requestUrl);
  let cookie =
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
  if (url.protocol === "https:") cookie += "; Secure";
  return cookie;
}

function clearSessionCookie(requestUrl: string): string {
  const url = new URL(requestUrl);
  let cookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  if (url.protocol === "https:") cookie += "; Secure";
  return cookie;
}

async function getSessionUser(
  request: Request,
  env: Env
): Promise<{ user: Omit<UserRow, "password_hash" | "password_salt">; token: string } | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{4,128}$/i.test(token)) return null;
  const sess = await env.DB.prepare(
    "SELECT token, user_id, expires_at FROM sessions WHERE token = ?"
  )
    .bind(token)
    .first<{ token: string; user_id: number; expires_at: string }>();
  if (!sess) return null;
  if (new Date(sess.expires_at).getTime() < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  const user = await env.DB.prepare(
    "SELECT id, name, email, created_at FROM users WHERE id = ?"
  )
    .bind(sess.user_id)
    .first<{ id: number; name: string; email: string; created_at: string }>();
  if (!user) return null;
  return { user, token };
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return {};
  try {
    const v = (await request.json()) as Record<string, unknown>;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function priceForTicket(priority: string, category: string): number {
  const p = (priority || "normal").toLowerCase();
  let base = 4900;
  if (p === "low") base = 2900;
  else if (p === "normal") base = 4900;
  else if (p === "high") base = 9900;
  else if (p === "urgent") base = 14900;
  const c = (category || "general").toLowerCase();
  if (c === "billing") base += 1000;
  else if (c === "technical") base += 2000;
  return base;
}

function randomSuffix(): string {
  const b = new Uint8Array(2);
  crypto.getRandomValues(b);
  return ((b[0] << 8) | b[1]).toString().padStart(5, "0").slice(-4);
}

// ---------- app ----------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    try {
      // ----- health -----
      if (path === "/api/health" && method === "GET") {
        return json({ ok: true, app: "SupportDesk", company: COMPANY_NAME });
      }

      // ----- register -----
      if (path === "/api/register" && method === "POST") {
        const body = await readJsonBody(request);
        const name = String(body.name ?? "").trim();
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");

        if (name.length < 2 || name.length > 80)
          return json({ error: "Name must be 2-80 characters." }, 400);
        if (!isValidEmail(email) || email.length > 160)
          return json({ error: "Enter a valid email address." }, 400);
        if (password.length < 8 || password.length > 200)
          return json({ error: "Password must be at least 8 characters." }, 400);

        const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
          .bind(email)
          .first();
        if (existing) return json({ error: "An account with this email already exists." }, 409);

        const { hash, salt } = await hashPassword(password);
        const created = await env.DB.prepare(
          "INSERT INTO users (name, email, password_hash, password_salt) VALUES (?, ?, ?, ?) RETURNING id, name, email, created_at"
        )
          .bind(name, email, hash, salt)
          .first<{ id: number; name: string; email: string; created_at: string }>();
        if (!created) return json({ error: "Registration failed, try again." }, 500);

        const token = generateSessionToken();
        await env.DB.prepare(
          "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
        )
          .bind(token, created.id, sessionExpiryIso(SESSION_DAYS))
          .run();

        return json(
          { user: created },
          201,
          { "Set-Cookie": buildSessionCookie(request.url, token, SESSION_DAYS * 86400) }
        );
      }

      // ----- login -----
      if (path === "/api/login" && method === "POST") {
        const body = await readJsonBody(request);
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        if (!isValidEmail(email) || !password)
          return json({ error: "Email and password are required." }, 400);

        const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?")
          .bind(email)
          .first<UserRow>();
        // Generic message to avoid user enumeration timing leaks (best effort).
        if (!row) return json({ error: "Invalid email or password." }, 401);
        const ok = await verifyPassword(password, row.password_salt, row.password_hash);
        if (!ok) return json({ error: "Invalid email or password." }, 401);

        const token = generateSessionToken();
        await env.DB.prepare(
          "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
        )
          .bind(token, row.id, sessionExpiryIso(SESSION_DAYS))
          .run();

        return json(
          { user: { id: row.id, name: row.name, email: row.email, created_at: row.created_at } },
          200,
          { "Set-Cookie": buildSessionCookie(request.url, token, SESSION_DAYS * 86400) }
        );
      }

      // ----- logout -----
      if (path === "/api/logout" && method === "POST") {
        const token = getCookie(request, SESSION_COOKIE);
        if (token) {
          await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
        }
        return json({ ok: true }, 200, {
          "Set-Cookie": clearSessionCookie(request.url),
        });
      }

      // ----- me -----
      if (path === "/api/me" && method === "GET") {
        const sess = await getSessionUser(request, env);
        if (!sess) return json({ error: "Not authenticated." }, 401);
        return json({ user: sess.user });
      }

      // All routes below require authentication.
      const authed = await getSessionUser(request, env);
      if (
        path.startsWith("/api/tickets") ||
        path.startsWith("/api/invoices")
      ) {
        if (!authed) return json({ error: "Not authenticated." }, 401);
      }

      // ----- list tickets (own only — secure) -----
      if (path === "/api/tickets" && method === "GET") {
        const rows = await env.DB.prepare(
          `SELECT t.id, t.subject, t.description, t.category, t.priority, t.status, t.created_at,
                  i.id AS invoice_id, i.invoice_number
           FROM tickets t LEFT JOIN invoices i ON i.ticket_id = t.id
           WHERE t.user_id = ? ORDER BY t.id DESC`
        )
          .bind(authed!.user.id)
          .all();
        return json({ tickets: rows.results ?? [] });
      }

      // ----- create ticket (+ auto-generate invoice) -----
      if (path === "/api/tickets" && method === "POST") {
        const body = await readJsonBody(request);
        const subject = String(body.subject ?? "").trim();
        const description = String(body.description ?? "").trim();
        const category = String(body.category ?? "general").trim().toLowerCase();
        const priority = String(body.priority ?? "normal").trim().toLowerCase();

        const allowedCategories = ["general", "technical", "billing", "account"];
        const allowedPriorities = ["low", "normal", "high", "urgent"];
        if (subject.length < 4 || subject.length > 160)
          return json({ error: "Subject must be 4-160 characters." }, 400);
        if (description.length < 10 || description.length > 4000)
          return json({ error: "Description must be 10-4000 characters." }, 400);
        if (!allowedCategories.includes(category))
          return json({ error: "Invalid category." }, 400);
        if (!allowedPriorities.includes(priority))
          return json({ error: "Invalid priority." }, 400);

        const ticket = await env.DB.prepare(
          `INSERT INTO tickets (user_id, subject, description, category, priority, status)
           VALUES (?, ?, ?, ?, ?, 'open')
           RETURNING id, subject, description, category, priority, status, created_at`
        )
          .bind(authed!.user.id, subject, description, category, priority)
          .first<{
            id: number;
            subject: string;
            description: string;
            category: string;
            priority: string;
            status: string;
            created_at: string;
          }>();
        if (!ticket) return json({ error: "Could not create ticket." }, 500);

        // Real business logic: every support ticket generates a billable invoice.
        const year = new Date().getFullYear();
        const invoiceNumber = `INV-${year}-${String(ticket.id).padStart(4, "0")}-${randomSuffix()}`;
        const amount = priceForTicket(priority, category);
        const issued = new Date().toISOString();
        const due = new Date(Date.now() + 14 * 86400 * 1000).toISOString();
        const invoice = await env.DB.prepare(
          `INSERT INTO invoices (user_id, ticket_id, invoice_number, amount_cents, currency, status, issued_at, due_at, internal_note)
           VALUES (?, ?, ?, ?, 'USD', 'paid', ?, ?, '')
           RETURNING id, invoice_number, amount_cents, currency, status, issued_at, due_at, ticket_id`
        )
          .bind(authed!.user.id, ticket.id, invoiceNumber, amount, issued, due)
          .first();

        return json({ ticket, invoice }, 201);
      }

      // ----- ticket detail (SECURE: ownership enforced) -----
      {
        const m = path.match(/^\/api\/tickets\/(\d+)$/);
        if (m && method === "GET") {
          const id = Number(m[1]);
          const row = await env.DB.prepare(
            `SELECT t.id, t.subject, t.description, t.category, t.priority, t.status, t.created_at,
                    i.id AS invoice_id, i.invoice_number
             FROM tickets t LEFT JOIN invoices i ON i.ticket_id = t.id
             WHERE t.id = ? AND t.user_id = ?`
          )
            .bind(id, authed!.user.id)
            .first();
          if (!row) return json({ error: "Ticket not found." }, 404);
          return json({ ticket: row });
        }
      }

      // ----- list invoices (own only — secure list) -----
      if (path === "/api/invoices" && method === "GET") {
        // NOTE: internal_note is never selected into JSON responses.
        const rows = await env.DB.prepare(
          `SELECT i.id, i.invoice_number, i.amount_cents, i.currency, i.status,
                  i.issued_at, i.due_at, i.ticket_id, t.subject AS ticket_subject
           FROM invoices i JOIN tickets t ON t.id = i.ticket_id
           WHERE i.user_id = ? ORDER BY i.id DESC`
        )
          .bind(authed!.user.id)
          .all();
        return json({ invoices: rows.results ?? [] });
      }

      // ----- invoice PDF download (INTENTIONAL IDOR — see README) -----
      // Requires authentication, but deliberately omits the ownership check
      // (`AND user_id = ?`). Any logged-in user can download any invoice by ID.
      {
        const m = path.match(/^\/api\/invoices\/(\d+)\/download$/);
        if (m && method === "GET") {
          const id = Number(m[1]);
          if (!Number.isInteger(id) || id <= 0)
            return json({ error: "Invalid invoice id." }, 400);
          const inv = await env.DB.prepare(
            `SELECT i.id, i.invoice_number, i.amount_cents, i.currency, i.status,
                    i.issued_at, i.due_at, i.ticket_id, i.internal_note,
                    t.subject AS ticket_subject, t.category AS ticket_category,
                    u.name AS customer_name, u.email AS customer_email
             FROM invoices i
             JOIN tickets t ON t.id = i.ticket_id
             JOIN users u ON u.id = i.user_id
             WHERE i.id = ?`
          )
            .bind(id)
            .first<{
              id: number;
              invoice_number: string;
              amount_cents: number;
              currency: string;
              status: string;
              issued_at: string;
              due_at: string;
              ticket_id: number;
              internal_note: string;
              ticket_subject: string;
              ticket_category: string;
              customer_name: string;
              customer_email: string;
            }>();
          if (!inv) return json({ error: "Invoice not found." }, 404);

          const pdf = buildInvoicePdf({
            companyName: COMPANY_NAME,
            invoiceNumber: inv.invoice_number,
            issuedAt: inv.issued_at.slice(0, 10),
            dueAt: (inv.due_at || inv.issued_at).slice(0, 10),
            customerName: inv.customer_name,
            customerEmail: inv.customer_email,
            ticketId: inv.ticket_id,
            ticketSubject: inv.ticket_subject,
            ticketCategory: inv.ticket_category,
            amountCents: inv.amount_cents,
            currency: inv.currency,
            internalNote: inv.internal_note || "",
          });

          return new Response(pdf as unknown as BodyInit, {
            status: 200,
            headers: {
              "content-type": "application/pdf",
              "content-disposition": `attachment; filename="invoice-${inv.invoice_number}.pdf"`,
              "content-length": String(pdf.length),
              "cache-control": "no-store",
            },
          });
        }
      }

      // ----- invoice detail JSON (INTENTIONAL IDOR — same root cause) -----
      // Authenticated but no ownership check. Returns metadata only;
      // `internal_note` is never included here (it only appears in the PDF).
      {
        const m = path.match(/^\/api\/invoices\/(\d+)$/);
        if (m && method === "GET") {
          const id = Number(m[1]);
          if (!Number.isInteger(id) || id <= 0)
            return json({ error: "Invalid invoice id." }, 400);
          const inv = await env.DB.prepare(
            `SELECT i.id, i.invoice_number, i.amount_cents, i.currency, i.status,
                    i.issued_at, i.due_at, i.ticket_id, t.subject AS ticket_subject
             FROM invoices i JOIN tickets t ON t.id = i.ticket_id
             WHERE i.id = ?`
          )
            .bind(id)
            .first();
          if (!inv) return json({ error: "Invoice not found." }, 404);
          return json({ invoice: inv });
        }
      }

      // ----- static assets / frontend -----
      if (!path.startsWith("/api/")) {
        return env.ASSETS.fetch(request);
      }

      return json({ error: "Not found." }, 404);
    } catch (err) {
      console.error("request failed:", err);
      return json({ error: "Something went wrong, please try again." }, 500);
    }
  },
};
