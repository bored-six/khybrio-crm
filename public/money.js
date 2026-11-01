// Money ledger math. Pure, no DOM, no Date.now(). All amounts in integer centavos.
// Spec: plans/money-ledger-spec.md sections 4 and 5.

export const EXPENSE_CATEGORIES = Object.freeze([
  "Software & subscriptions", "Ads & marketing", "Contractors & freelancers",
  "Salaries & wages", "Office & rent", "Utilities & internet", "Equipment",
  "Transport & travel", "Meals & client entertainment", "Bank & payment fees",
  "Taxes & government", "Client refund", "Other",
]);

const CAP = 1e13;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function realDate(s) {
  if (typeof s !== "string" || !DATE_ONLY.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function toCentavos(v) {
  let s;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    s = String(v);
  } else if (typeof v === "string") {
    s = v.trim().replace(/[₱,\s]/g, "");
  } else return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const neg = m[1] === "-";
  const frac = m[3] || "";
  const two = (frac + "00").slice(0, 2);
  const round = frac.length > 2 && frac.charCodeAt(2) >= 53 ? 1 : 0; // third digit >= 5
  const abs = Number(m[2]) * 100 + Number(two) + round;
  if (!Number.isFinite(abs) || abs > CAP) return null;
  return neg ? -abs || 0 : abs;
}

export function fromCentavos(c) {
  return c / 100;
}

export function formatPeso(c) {
  if (typeof c !== "number" || !Number.isFinite(c)) return "–";
  const abs = Math.abs(Math.round(c));
  const pesos = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  const int = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (c < 0 && abs !== 0 ? "-" : "") + "₱" + int + "." + cents;
}

export function manilaDate(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (DATE_ONLY.test(s)) return realDate(s) ? s : null;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const t = Date.parse(hasZone ? s : s + "Z");
  if (Number.isNaN(t)) return null;
  const d = new Date(t + 8 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function monthKey(v) {
  const d = manilaDate(v);
  return d ? d.slice(0, 7) : null;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function buildLedger(invoices, expenses, opts = {}) {
  const { today, opening = 0 } = opts;
  const clientName = opts.clientName || (id => id);
  const rows = [];
  const problems = [];

  for (const r of invoices || []) {
    if (r.status !== "Paid") continue;
    const date = manilaDate(r.paid);
    if (!date) { problems.push({ ref: "IN", id: r.id, reason: "no_date" }); continue; }
    const amount = toCentavos(r.amount);
    if (amount === null) { problems.push({ ref: "IN", id: r.id, reason: "no_amount" }); continue; }
    const cl = Array.isArray(r.client) ? r.client[0] : r.client;
    const name = cl ? clientName(cl) : "";
    rows.push({
      id: r.id, kind: "in", date, month: date.slice(0, 7), amount, signed: amount,
      category: "Client payment",
      label: [r.no, name].filter(Boolean).join(" · "),
      ref: "IN", created: r.created || "", future: date > today, balance: 0,
    });
  }

  for (const r of expenses || []) {
    const date = manilaDate(r.date);
    if (!date) { problems.push({ ref: "EX", id: r.id, reason: "no_date" }); continue; }
    const amount = toCentavos(r.amount);
    if (amount === null) { problems.push({ ref: "EX", id: r.id, reason: "no_amount" }); continue; }
    rows.push({
      id: r.id, kind: "out", date, month: date.slice(0, 7), amount, signed: -amount,
      category: r.category || "Other",
      label: r.desc || "",
      ref: "EX", created: r.created || "", future: date > today, balance: 0,
    });
  }

  rows.sort((a, b) =>
    cmp(a.date, b.date) ||
    cmp(a.kind === "in" ? 0 : 1, b.kind === "in" ? 0 : 1) ||
    cmp(a.created, b.created) ||
    cmp(a.id, b.id));

  let bal = opening;
  for (const e of rows) { bal += e.signed; e.balance = bal; }
  rows.reverse();
  // Carry opening on the array (non-enumerable) so balanceAsOf works on an empty ledger.
  Object.defineProperty(rows, "opening", { value: opening, enumerable: false });
  return { entries: rows, problems };
}

export function totals(entries) {
  let i = 0, o = 0;
  for (const e of entries) { if (e.kind === "in") i += e.amount; else o += e.amount; }
  return { in: i, out: o, net: i - o };
}

export function byMonth(entries) {
  const m = new Map();
  for (const e of entries) {
    const b = m.get(e.month) || { month: e.month, in: 0, out: 0, net: 0 };
    if (e.kind === "in") b.in += e.amount; else b.out += e.amount;
    b.net = b.in - b.out;
    m.set(e.month, b);
  }
  return [...m.values()].sort((a, b) => cmp(b.month, a.month));
}

export function byCategory(entries) {
  const m = new Map();
  for (const e of entries) {
    if (e.kind !== "out") continue;
    const b = m.get(e.category) || { category: e.category, out: 0, count: 0, share: 0 };
    b.out += e.amount;
    b.count += 1;
    m.set(e.category, b);
  }
  const list = [...m.values()];
  const totalOut = list.reduce((s, x) => s + x.out, 0);
  for (const x of list) x.share = totalOut > 0 ? Math.round((x.out / totalOut) * 1e4) / 1e4 : 0;
  return list.sort((a, b) => b.out - a.out || cmp(a.category, b.category));
}

export function balanceAsOf(entries, today) {
  const past = entries.find(e => e.date <= today); // newest non-future row
  if (past) return past.balance;
  if (typeof entries.opening === "number") return entries.opening;
  if (!entries.length) return 0;
  const oldest = entries[entries.length - 1];
  return oldest.balance - oldest.signed;
}

export function filterEntries(entries, { month, category } = {}) {
  return entries.filter(e => (!month || e.month === month) && (!category || e.category === category));
}

export function validateExpenseFields(fields, fid, { create = false } = {}) {
  const errs = [];
  const f = fields || {};
  const has = k => Object.prototype.hasOwnProperty.call(f, fid[k]);
  const v = k => f[fid[k]];

  if (create) {
    for (const k of ["desc", "date", "amount"]) if (!has(k)) errs.push(`${k} is required`);
  }
  if (has("desc") && (typeof v("desc") !== "string" || !v("desc").trim())) errs.push("desc must be non-empty text");
  if (has("amount") && toCentavos(v("amount")) === null) errs.push("amount is not a valid peso amount");
  if (has("date") && !realDate(v("date"))) errs.push("date must be a real YYYY-MM-DD date");
  if (has("category") && v("category") !== null && !EXPENSE_CATEGORIES.includes(v("category"))) errs.push("category is not an allowed option");
  return errs;
}
