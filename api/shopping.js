// /api/shopping — text search (the Browse tab). SerpApi Google Shopping.
// Env: SERPAPI_KEY (same key as visual-search).
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { SERPAPI_KEY } = process.env;
  if (!SERPAPI_KEY) return res.status(500).json({ error: "Missing SERPAPI_KEY." });

  try {
    let { query } = req.body || {};
    query = (query && query.trim()) || "modest dress neutral";
    // nudge toward modest + Canada availability
    const q = `${query} modest`;
    const u = new URL("https://serpapi.com/search.json");
    u.searchParams.set("engine", "google_shopping");
    u.searchParams.set("q", q);
    u.searchParams.set("gl", "ca");
    u.searchParams.set("hl", "en");
    u.searchParams.set("api_key", SERPAPI_KEY);

    const r = await fetch(u.toString());
    const d = await r.json();
    const raw = d.shopping_results || [];
    const items = raw.slice(0, 24).map((p) => ({
      name: p.title,
      brand: p.source || "",
      source: p.source || "",
      price: p.price || (p.extracted_price ? `$${p.extracted_price}` : null),
      thumbnail: p.thumbnail,
      url: p.product_link || p.link,
    })).filter((p) => p.thumbnail && p.url);

    return res.status(200).json({ count: items.length, items });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Shopping search failed", detail: e.message });
  }
}
