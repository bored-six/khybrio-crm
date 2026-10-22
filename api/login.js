import { checkPassword, sessionCookie, isAuthed } from "../lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    return res.status(200).json({ loggedIn: isAuthed(req) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!process.env.CRM_PASSWORD || !process.env.SESSION_SECRET) {
    return res.status(500).json({ error: "not_configured", message: "The site's password isn't set up yet. Add CRM_PASSWORD and SESSION_SECRET in Vercel." });
  }
  const password = (req.body && req.body.password) || "";
  if (!checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return res.status(401).json({ error: "wrong_password", message: "That password isn't right." });
  }
  res.setHeader("Set-Cookie", sessionCookie(req));
  return res.status(200).json({ loggedIn: true });
}
