/* SupportDesk frontend — vanilla JS, no build step, Cloudflare-safe. */
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const I18N = {
  en: {
    appName: "SupportDesk", company: "by Acme Support",
    navDashboard: "Dashboard", navTickets: "Tickets", navInvoices: "Invoices",
    logout: "Log out", heroTitle: "Customer support, without the waiting game.",
    heroSub: "Open a ticket in a minute, follow progress in real time, and download your invoice as soon as billing is done. Built for Acme Support customers.",
    tick1: "Real ticket tracking with categories & priorities",
    tick2: "Automatic PDF invoices per ticket", tick3: "English + Arabic interface",
    planNote: "per ticket, by priority", planDue: "payment terms", planResp: "first response",
    login: "Log in", register: "Create account", email: "Email", password: "Password",
    name: "Full name", loginBtn: "Log in", registerBtn: "Create account",
    registerHint: "Use a real email — this is your billing identity.",
    recentTickets: "Recent tickets", recentInvoices: "Recent invoices", viewAll: "View all",
    ticketsTitle: "Support tickets", subject: "Subject", priority: "Priority",
    category: "Category", description: "Description", createTicket: "Open ticket & generate invoice",
    invoicesTitle: "Invoices", invoicesHint: "Each support ticket generates a billable invoice. Click Download to get the official PDF.",
    footerNote: "Secure customer portal · billing@acme-support.example",
    howTitle: "How it works",
    step1t: "Open a ticket", step1d: "Describe the issue, pick a category and priority.",
    step2t: "We resolve & bill", step2d: "An agent picks it up and an invoice is generated.",
    step3t: "Download the invoice", step3d: "Get the official PDF from your dashboard.",
    sampleBadge: "Sample", sampleMeta: "ticket #1042 · high priority",
    sampleNote: "Track progress in real time, then download the invoice.",
    vName: "Enter your full name (2+ characters).",
    vEmail: "Enter a valid email address.",
    vPassRequired: "Enter your password.",
    vPassword: "Password must be at least 8 characters.",
  },
  ar: {
    appName: "مكتب الدعم", company: "بواسطة Acme Support",
    navDashboard: "لوحة التحكم", navTickets: "التذاكر", navInvoices: "الفواتير",
    logout: "تسجيل الخروج", heroTitle: "دعم العملاء بدون انتظار.",
    heroSub: "افتح تذكرة في دقيقة، وتابع التقدم لحظة بلحظة، وحمّل فاتورتك فور صدورها. مصمم لعملاء Acme Support.",
    tick1: "تتبع حقيقي للتذاكر مع فئات وأولويات",
    tick2: "فواتير PDF تلقائية لكل تذكرة", tick3: "واجهة بالعربية والإنجليزية",
    planNote: "لكل تذكرة حسب الأولوية", planDue: "شروط الدفع", planResp: "أول رد",
    login: "تسجيل الدخول", register: "إنشاء حساب", email: "البريد الإلكتروني", password: "كلمة المرور",
    name: "الاسم الكامل", loginBtn: "دخول", registerBtn: "إنشاء الحساب",
    registerHint: "استخدم بريدًا حقيقيًا — هذه هويتك للفوترة.",
    recentTickets: "أحدث التذاكر", recentInvoices: "أحدث الفواتير", viewAll: "عرض الكل",
    ticketsTitle: "تذاكر الدعم", subject: "الموضوع", priority: "الأولوية",
    category: "الفئة", description: "الوصف", createTicket: "فتح تذكرة وإصدار فاتورة",
    invoicesTitle: "الفواتير", invoicesHint: "كل تذكرة دعم تُنشئ فاتورة مستحقة. اضغط تنزيل للحصول على PDF الرسمي.",
    footerNote: "بوابة عملاء آمنة · billing@acme-support.example",
    howTitle: "كيف يعمل",
    step1t: "افتح تذكرة", step1d: "صِف المشكلة واختر الفئة والأولوية.",
    step2t: "نحلّ ونُصدِر فاتورة", step2d: "يستلمها موظف الدعم وتُنشأ الفاتورة.",
    step3t: "حمّل الفاتورة", step3d: "احصل على PDF الرسمي من لوحة التحكم.",
    sampleBadge: "مثال", sampleMeta: "تذكرة #1042 · أولوية عالية",
    sampleNote: "تابع التقدم لحظة بلحظة، ثم حمّل الفاتورة.",
    vName: "أدخل الاسم الكامل (حرفان على الأقل).",
    vEmail: "أدخل بريدًا إلكترونيًا صالحًا.",
    vPassRequired: "أدخل كلمة المرور.",
    vPassword: "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.",
  },
};

let lang = localStorage.getItem("sd-lang") || "en";
let currentUser = null;
let currentView = "dashboard";

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function applyLang() {
  const dict = I18N[lang] || I18N.en;
  document.documentElement.lang = lang === "ar" ? "ar" : "en";
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  $$("[data-i18n]").forEach((el) => {
    const k = el.getAttribute("data-i18n");
    if (k && dict[k]) el.textContent = dict[k];
  });
  $("#langToggle").textContent = lang === "ar" ? "EN" : "عربي";
  localStorage.setItem("sd-lang", lang);
}

function showAlert(msg, ok = false) {
  const a = $("#alert");
  a.hidden = false;
  a.textContent = msg;
  a.classList.toggle("ok", ok);
  clearTimeout(showAlert._t);
  showAlert._t = setTimeout(() => { a.hidden = true; }, 6000);
}

function money(cents, cur) {
  return `${(cur || "USD").toUpperCase()} ${(cents / 100).toFixed(2)}`;
}

function setAuthed(user) {
  currentUser = user;
  const logged = !!user;
  $("#view-auth").hidden = logged;
  $("#mainNav").hidden = !logged;
  $("#logoutBtn").hidden = !logged;
  $("#userChip").hidden = !logged;
  if (logged) $("#userChip").textContent = user.name || user.email;
  if (logged) showView(currentView);
}

function showView(name) {
  currentView = name;
  for (const v of ["dashboard", "tickets", "invoices"]) {
    $("#view-" + v).hidden = v !== name;
  }
  $$("#mainNav .nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $$('[data-view]').forEach((b) => {
    if (b.classList.contains("nav-btn")) return;
    b.onclick = () => showView(b.dataset.view);
  });
  if (currentUser) refresh();
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function ticketCard(t) {
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML =
    `<div class="item-top"><h3></h3><span class="pill open"></span></div>` +
    `<div class="meta"></div>` +
    `<div class="item-actions"></div>`;
  div.querySelector("h3").textContent = `#${t.id} — ${t.subject}`;
  const pill = div.querySelector(".pill");
  pill.textContent = `${t.status} · ${t.priority}`;
  div.querySelector(".meta").textContent =
    `${t.category} · ${new Date(t.created_at).toLocaleString()}` +
    (t.invoice_number ? ` · ${t.invoice_number}` : "");
  const actions = div.querySelector(".item-actions");
  if (t.invoice_id) {
    const a = document.createElement("a");
    a.className = "link";
    a.href = `/api/invoices/${t.invoice_id}/download`;
    a.textContent = lang === "ar" ? "تنزيل الفاتورة (PDF)" : "Download invoice (PDF)";
    actions.appendChild(a);
  }
  return div;
}

function invoiceCard(inv) {
  const div = document.createElement("div");
  div.className = "item";
  const top = document.createElement("div");
  top.className = "item-top";
  const h = document.createElement("h3");
  h.textContent = `${inv.invoice_number} — ${money(inv.amount_cents, inv.currency)}`;
  const pill = document.createElement("span");
  pill.className = "pill paid";
  pill.textContent = inv.status;
  top.append(h, pill);
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `#${inv.id} · ${inv.ticket_subject || ("ticket #" + inv.ticket_id)} · ${new Date(inv.issued_at).toLocaleDateString()}`;
  const actions = document.createElement("div");
  actions.className = "item-actions";
  const a = document.createElement("a");
  a.className = "link";
  // The download URL carries the invoice ID — this is the normal business flow.
  a.href = `/api/invoices/${inv.id}/download`;
  a.textContent = lang === "ar" ? "تنزيل PDF" : "Download PDF";
  actions.appendChild(a);
  div.append(top, meta, actions);
  return div;
}

async function refresh() {
  try {
    const [{ tickets }, { invoices }] = await Promise.all([
      api("/api/tickets"),
      api("/api/invoices"),
    ]);
    const tl = $("#ticketList"); tl.innerHTML = "";
    const il = $("#invoiceList"); il.innerHTML = "";
    const dt = $("#dashTickets"); dt.innerHTML = "";
    const di = $("#dashInvoices"); di.innerHTML = "";
    if (!tickets.length) tl.innerHTML = `<p class="muted">${esc(lang === "ar" ? "لا تذاكر بعد." : "No tickets yet.")}</p>`;
    if (!invoices.length) il.innerHTML = `<p class="muted">${esc(lang === "ar" ? "لا فواتير بعد." : "No invoices yet.")}</p>`;
    tickets.forEach((t) => tl.appendChild(ticketCard(t)));
    invoices.forEach((i) => il.appendChild(invoiceCard(i)));
    tickets.slice(0, 3).forEach((t) => dt.appendChild(ticketCard(t)));
    invoices.slice(0, 3).forEach((i) => di.appendChild(invoiceCard(i)));

    const total = invoices.reduce((a, i) => a + (i.amount_cents || 0), 0);
    const stats = $("#stats");
    stats.innerHTML = "";
    const cards = [
      [String(tickets.length), lang === "ar" ? "تذكرة" : "tickets"],
      [String(invoices.length), lang === "ar" ? "فاتورة" : "invoices"],
      [money(total, "USD"), lang === "ar" ? "إجمالي الفوترة" : "total billed"],
    ];
    for (const [b, s] of cards) {
      const d = document.createElement("div");
      d.className = "stat";
      const bb = document.createElement("b"); bb.textContent = b;
      const ss = document.createElement("span"); ss.textContent = s;
      d.append(bb, ss);
      stats.appendChild(d);
    }
  } catch (e) {
    if (String(e.message || "").includes("authenticated")) {
      setAuthed(null);
    } else {
      showAlert(e.message);
    }
  }
}

function selectAuthTab(which) {
  const login = which !== "register";
  $("#tabLogin").classList.toggle("active", login);
  $("#tabRegister").classList.toggle("active", !login);
  $("#tabLogin").setAttribute("aria-selected", String(login));
  $("#tabRegister").setAttribute("aria-selected", String(!login));
  // Exactly one form visible at a time.
  $("#loginForm").hidden = !login;
  $("#registerForm").hidden = login;
  clearFormErrors(login ? $("#loginForm") : $("#registerForm"));
}

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim());
}

function setFieldError(input, msg) {
  const form = input.closest("form");
  const holder = form ? form.querySelector(`.field-error[data-for="${input.name}"]`) : null;
  if (holder) holder.textContent = msg || "";
  if (msg) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

/** Sets errors for [name, msg] pairs; returns the first invalid input (or null). */
function setFormErrors(form, pairs) {
  let firstBad = null;
  for (const [name, msg] of pairs) {
    const input = form.querySelector(`[name="${name}"]`);
    if (!input) continue;
    setFieldError(input, msg);
    if (msg && !firstBad) firstBad = input;
  }
  return firstBad;
}

function clearFormErrors(form) {
  if (!form) return;
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  form.querySelectorAll(".field-error").forEach((el) => { el.textContent = ""; });
}

function wire() {
  $("#year").textContent = String(new Date().getFullYear());
  $("#langToggle").onclick = () => { lang = lang === "ar" ? "en" : "ar"; applyLang(); if (currentUser) refresh(); };
  $("#brandLink").onclick = (e) => { e.preventDefault(); if (currentUser) showView("dashboard"); };
  $$("#mainNav .nav-btn").forEach((b) => { b.onclick = () => showView(b.dataset.view); });

  $("#tabLogin").onclick = () => selectAuthTab("login");
  $("#tabRegister").onclick = () => selectAuthTab("register");

  // Clear a field's inline error as soon as the user edits it (auth forms only).
  for (const form of [$("#loginForm"), $("#registerForm")]) {
    form.addEventListener("input", (e) => {
      const t = e.target;
      if (t && t.name) setFieldError(t, "");
    });
  }

  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    let firstBad = null;
    const emailMsg = validEmail(email) ? "" : I18N[lang].vEmail;
    const passMsg = password ? "" : I18N[lang].vPassRequired;
    firstBad = setFormErrors(form, [["email", emailMsg], ["password", passMsg]]);
    if (emailMsg || passMsg) { if (firstBad) firstBad.focus(); return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const { user } = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setAuthed(user);
      showAlert(lang === "ar" ? "مرحبًا بعودتك!" : "Welcome back!", true);
    } catch (err) { showAlert(err.message); }
    finally { btn.disabled = false; }
  };

  $("#registerForm").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const name = String(fd.get("name") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const nameMsg = name.length >= 2 ? "" : I18N[lang].vName;
    const emailMsg = validEmail(email) ? "" : I18N[lang].vEmail;
    const passMsg = password.length >= 8 ? "" : I18N[lang].vPassword;
    const firstBad = setFormErrors(form, [["name", nameMsg], ["email", emailMsg], ["password", passMsg]]);
    if (nameMsg || emailMsg || passMsg) { if (firstBad) firstBad.focus(); return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const { user } = await api("/api/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      setAuthed(user);
      showAlert(lang === "ar" ? "تم إنشاء الحساب!" : "Account created!", true);
    } catch (err) { showAlert(err.message); }
    finally { btn.disabled = false; }
  };

  $("#logoutBtn").onclick = async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    setAuthed(null);
  };

  $("#ticketForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await api("/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          subject: fd.get("subject"),
          description: fd.get("description"),
          category: fd.get("category"),
          priority: fd.get("priority"),
        }),
      });
      e.target.reset();
      showView("invoices");
      showAlert(lang === "ar" ? "تم فتح التذكرة وإصدار الفاتورة." : "Ticket opened and invoice issued.", true);
    } catch (err) { showAlert(err.message); }
    finally { btn.disabled = false; }
  };
}

(async function init() {
  applyLang();
  wire();
  try {
    const { user } = await api("/api/me");
    setAuthed(user);
  } catch {
    setAuthed(null);
  }
})();
