import { clearCookie } from "../lib/auth.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Set-Cookie", clearCookie(req));
  return res.status(200).json({ loggedIn: false });
}
