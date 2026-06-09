// /api/shopping — text search (Browse). SerpApi Google Shopping + optional
// Gemini filter that enforces the query (keeps "black" black, drops junk).
// Env: SERPAPI_KEY (required), GEMINI_KEY (optional, free — sharpens results).
import { geminiText } from "./_gemini.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { SERPAPI_KEY, GEMINI_KEY } = process.env;
  if (!SERPAPI_KEY) return res.status(500).json({ error: "Missing SERPAPI_KEY." });

  try {
    let { query } = req.body || {};
    query = (query && query.trim()) || "modest dress neutral";
    const u = new URL("https://serpapi.com/search.json");
    u.searchParams.set("engine", "google_shopping");
    u.searchParams.set("q", `${query} modest`);
    u.searchParams.set("gl", "ca");
    u.searchParams.set("hl", "en");
    u.searchParams.set("api_key", SERPAPI_KEY);

    const r = await fetch(u.toString());
    const d = await r.json();
    const raw = d.shopping_results || [];

    const junk = ["aliexpress", "dhgate", "temu", "wish", "alibaba", "joom"];
    let items = raw.map((p) => ({
      name: p.title, brand: p.source || "", source: p.source || "",
      price: p.price || (p.extracted_price ? `$${p.extracted_price}` : null),
      thumbnail: p.thumbnail, url: p.link || p.product_link,
    })).filter((p) => p.thumbnail && p.url && !junk.some((b) => (p.source || "").toLowerCase().includes(b)));

    if (GEMINI_KEY && items.length) {
      try {
        const kept = await enforceQuery(items, query, GEMINI_KEY);
        if (kept?.length) items = kept;
      } catch (e) { console.warn("filter skipped:", e.message); }
    }

    return res.status(200).json({ count: items.length, items: items.slice(0, 12) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Shopping search failed", detail: e.message });
  }
}

async function enforceQuery(items, query, key) {
  const list = items.map((m, i) => `${i}. ${m.name} | ${m.source}`).join("\n");
  const prompt = `A user searched for "${query}". Keep ONLY items that genuinely match it — same color and same garment type — and that are modest (good coverage). Drop anything off-color, wrong type, non-clothing, or revealing. Return ONLY a JSON array of kept indices, best match first, e.g. [2,0,5]. No other text.\n\n${list}`;
  const text = await geminiText([{ text: prompt }], key, 200);
  const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  return arr.map((i) => items[i]).filter(Boolean);
}
