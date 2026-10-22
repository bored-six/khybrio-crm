import crypto from "node:crypto";

const COOKIE = "kcrm_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.SESSION_SECRET;
  const p = process.env.CRM_PASSWORD;
  if (!s || !p) throw new Error("SESSION_SECRET and CRM_PASSWORD must be set");
  // Including the password means changing it logs everyone out.
  return s + "|" + p;
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  return (req.headers["x-forwarded-proto"] || "").includes("https") || !!process.env.VERCEL;
}

export function checkPassword(given) {
  const expected = process.env.CRM_PASSWORD || "";
  if (!expected) return false;
  const h = (v) => crypto.createHash("sha256").update(String(v)).digest();
  return crypto.timingSafeEqual(h(given || ""), h(expected));
}

export function sessionCookie(req) {
  const value = `v1.${Date.now() + MAX_AGE * 1000}`;
  return `${COOKIE}=${value}.${sign(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${isHttps(req) ? "; Secure" : ""}`;
}

export function clearCookie(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? "; Secure" : ""}`;
}

export function isAuthed(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (!raw) return false;
  const i = raw.lastIndexOf(".");
  if (i < 0) return false;
  const value = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const exp = Number(value.split(".")[1]);
  if (!exp || exp < Date.now()) return false;
  try {
    return safeEqual(sig, sign(value));
  } catch {
    return false;
  }
}
