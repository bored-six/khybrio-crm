import { isAuthed } from "../lib/auth.js";
import { validateExpenseFields, validateIncomeFields } from "../public/money.js";

// Only these Khybrio Records tables can be read or written through the site.
const BASE = process.env.AIRTABLE_BASE_ID || "app6fRankhuL6LyjF";
const TABLES = new Set([
  "tblGObGOkUtCTLCyX", // Clients & Leads
  "tblsH2LaDJ21U0E3x", // Quotations
  "tbls4JGf4EmpTNZIA", // Contracts
  "tblS66t7fb8lBerx3", // Invoices
  "tblhhCSBErRCDmpgE", // Activity Log
  "tbljG1uprTR1n85UR", // Expenses
  "tblMzpoYxbdynft6O", // Income
]);
const EXPENSES = "tbljG1uprTR1n85UR";
const INCOME = "tblMzpoYxbdynft6O";
// Key -> field id for Expenses. Keep in sync with T.EX.f in index.html.
const FID = {
  desc: "fldexOv0PbHazjQXx",
  date: "fldUhOSnJaaaG3HcA",
  amount: "fldpsZmX1nqQLI9vc",
  category: "fldzY4XPkNJ1H077o",
};
// Key -> field id for Income. Keep in sync with T.IC.f in index.html.
const INCOME_FID = {
  desc: "fldey4VDoM2Inl243",
  date: "fldwucDvcJ6lvA6wc",
  amount: "fld6aAy3EoMxg6V82",
  source: "fldeOnyOdV7qly9AL",
};
const API = process.env.AIRTABLE_API_URL || "https://api.airtable.com/v0";

async function airtable(path, init = {}) {
  const r = await fetch(`${API}/${BASE}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error((body.error && (body.error.message || body.error.type)) || `Airtable error ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return body;
}

const shape = (r) => ({ id: r.id, createdTime: r.createdTime, cellValuesByFieldId: r.fields || {} });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isAuthed(req)) return res.status(401).json({ error: "login_required" });
  if (!process.env.AIRTABLE_TOKEN) {
    return res.status(500).json({ error: "not_configured", message: "AIRTABLE_TOKEN isn't set in Vercel." });
  }

  const table = req.method === "GET" ? req.query.table : req.body && req.body.table;
  if (!TABLES.has(table)) return res.status(400).json({ error: "bad_table" });

  try {
    if (req.method === "GET") {
      const records = [];
      let offset = "";
      do {
        const page = await airtable(
          `${table}?returnFieldsByFieldId=true&pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`
        );
        records.push(...(page.records || []).map(shape));
        offset = page.offset || "";
      } while (offset && records.length < 5000);
      return res.status(200).json({ records });
    }

    if (req.method === "POST" || req.method === "PATCH") {
      const recs = Array.isArray(req.body.records) ? req.body.records : [];
      if (!recs.length || recs.length > 10) return res.status(400).json({ error: "bad_records", message: "Send 1 to 10 records." });
      const clean = recs.map((r) =>
        req.method === "PATCH" ? { id: String(r.id || ""), fields: r.fields || {} } : { fields: r.fields || {} }
      );
      if (table === EXPENSES) {
        for (const r of clean) {
          const errs = validateExpenseFields(r.fields, FID, { create: req.method === "POST" });
          if (errs.length) return res.status(400).json({ error: "bad_fields", message: errs.join("; ") });
        }
      }
      if (table === INCOME) {
        for (const r of clean) {
          const errs = validateIncomeFields(r.fields, INCOME_FID, { create: req.method === "POST" });
          if (errs.length) return res.status(400).json({ error: "bad_fields", message: errs.join("; ") });
        }
      }
      if (req.method === "PATCH" && clean.some((r) => !/^rec[A-Za-z0-9]{14}$/.test(r.id))) {
        return res.status(400).json({ error: "bad_record_id" });
      }
      const out = await airtable(table, {
        method: req.method,
        body: JSON.stringify({ records: clean, typecast: true, returnFieldsByFieldId: true }),
      });
      return res.status(200).json({ records: (out.records || []).map(shape) });
    }

    if (req.method === "DELETE") {
      // Only manual money entries can be removed from the site.
      if (table !== EXPENSES && table !== INCOME) return res.status(400).json({ error: "bad_table", message: "Only expenses and income can be deleted here." });
      const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
      if (!ids.length || ids.length > 10 || ids.some((id) => !/^rec[A-Za-z0-9]{14}$/.test(id))) return res.status(400).json({ error: "bad_record_id" });
      const out = await airtable(`${table}?${ids.map((id) => `records[]=${encodeURIComponent(id)}`).join("&")}`, { method: "DELETE" });
      return res.status(200).json({ records: out.records || [] });
    }

    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    const status = e.status === 401 || e.status === 403 ? 502 : e.status || 502;
    return res.status(status).json({ error: "airtable_error", message: e.message });
  }
}
