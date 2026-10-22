import { isAuthed } from "../lib/auth.js";

// Only these Khybrio Records tables can be read or written through the site.
const BASE = process.env.AIRTABLE_BASE_ID || "app6fRankhuL6LyjF";
const TABLES = new Set([
  "tblGObGOkUtCTLCyX", // Clients & Leads
  "tblsH2LaDJ21U0E3x", // Quotations
  "tbls4JGf4EmpTNZIA", // Contracts
  "tblS66t7fb8lBerx3", // Invoices
  "tblhhCSBErRCDmpgE", // Activity Log
]);
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
      if (req.method === "PATCH" && clean.some((r) => !/^rec[A-Za-z0-9]{14}$/.test(r.id))) {
        return res.status(400).json({ error: "bad_record_id" });
      }
      const out = await airtable(table, {
        method: req.method,
        body: JSON.stringify({ records: clean, typecast: true, returnFieldsByFieldId: true }),
      });
      return res.status(200).json({ records: (out.records || []).map(shape) });
    }

    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    const status = e.status === 401 || e.status === 403 ? 502 : e.status || 502;
    return res.status(status).json({ error: "airtable_error", message: e.message });
  }
}
