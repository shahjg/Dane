// ───────────────────────────────────────────────────────────────
//  /api/notify  — free, automatic "send to phone" via ntfy.sh
//
//  No account, no cost, no carrier approvals. Shahjahan installs the
//  free "ntfy" app (App Store / Play), subscribes to one private topic,
//  and every "Send to Shahjahan" lands as a push with the item photo
//  and a tap-through link to buy.
//
//  Env var (Vercel → Settings → Environment Variables):
//   NTFY_TOPIC   required — a long, hard-to-guess string, e.g.
//                "d4ne-shahjahan-7f3k9q2x". Anyone who knows the topic
//                can post to it, so keep it secret-ish.
// ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { NTFY_TOPIC } = process.env;
  if (!NTFY_TOPIC) return res.status(500).json({ error: "Missing NTFY_TOPIC." });

  try {
    const { name = "A piece", price = "", url = "", thumbnail = "", note = "" } = req.body || {};

    const lines = [name];
    if (price) lines.push(price);
    if (note) lines.push(`Size / colour: ${note}`);
    const message = lines.join("\n");

    // ntfy uses HTTP headers for metadata; keep them ASCII-safe.
    const ascii = (s) => String(s).replace(/[^\x20-\x7E]/g, "").slice(0, 200);
    const headers = {
      Title: ascii(`New find for ${"Shahjahan"}`),
      Tags: "shopping_bags",
      Priority: "default",
    };
    if (url) headers.Click = url;        // tap notification → open the store page
    if (thumbnail) headers.Attach = thumbnail; // show the product image

    const r = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: "POST",
      headers,
      body: message,
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: "Push failed", detail: t });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Notify failed", detail: e.message });
  }
}
