// /api/shopping — text search (Browse, anything). SerpApi Google Shopping +
// optional Gemini filter that enforces the query and applies modesty ONLY to
// clothing (so houses/cars/rings aren't dropped for "not being modest").
// Env: SERPAPI_KEY (required), GEMINI_KEY (optional, sharpens results).
import { geminiText } from "./_gemini.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { SERPAPI_KEY, GEMINI_KEY } = process.env;
  if (!SERPAPI_KEY) return res.status(500).json({ error: "Missing SERPAPI_KEY." });

  try {
    let { query, category, modesty } = req.body || {};
    const base = [category, query].filter(Boolean).join(" ").trim();
    const APPAREL = /dress|top|blouse|skirt|abaya|kurta|thobe|trouser|pant|jean|blazer|cardigan|sweater|knit|coat|jacket|shirt|jumpsuit|gown|hijab|scarf|tunic|romper|kaftan|kimono|maxi|midi|outfit|clothing|wear|sleeve|cami|legging|bodysuit|co-?ord|tunic|kaftan/i;
    const apparel = category === "Clothing" || !base || APPAREL.test(base);
    let q = base || "dress";
    if (apparel) q = "modest " + q;

    const u = new URL("https://serpapi.com/search.json");
    u.searchParams.set("engine", "google_shopping");
    u.searchParams.set("q", q);
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
        const kept = await enforceQuery(items, q, apparel, modesty, GEMINI_KEY);
        if (kept?.length) items = kept;
      } catch (e) { console.warn("filter skipped:", e.message); }
    }

    return res.status(200).json({ count: items.length, items: items.slice(0, 40) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Shopping search failed", detail: e.message });
  }
}

async function enforceQuery(items, query, apparel, modesty, key) {
  const list = items.map((m, i) => `${i}. ${m.name} | ${m.source}`).join("\n");
  const modestRule = apparel ? buildModestRule(modesty) : "These are NOT clothing — do not apply any modesty rule, just match the query.";
  const prompt = `A user searched for "${query}". Keep an item ONLY if it clearly matches the query (right type, and exact color if a color is named). ${modestRule} Drop mismatches and irrelevant results. Return ONLY a JSON array of kept indices, best match first, e.g. [2,0,5]. No other text.\n\n${list}`;
  const text = await geminiText([{ text: prompt }], key, 600);
  const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  return arr.map((i) => items[i]).filter(Boolean);
}

// Shared strict modesty rule, tuned by the user's filter toggles.
export function buildModestRule(m) {
  m = m || {};
  const on = (v, d) => (v === undefined ? d : v);
  const rules = [];
  if (on(m.neck, true)) rules.push("necklines must be high and modest — no plunging, low-cut, deep-V, off-shoulder, or cleavage-baring");
  if (on(m.sleeves, true)) rules.push("must have sleeves — at minimum short sleeves, ideally 3/4 or long; reject sleeveless, tank, cami, halter, strapless, spaghetti-strap, or tube styles");
  if (on(m.length, true)) rules.push("hemlines must be long — maxi, midi, ankle, or at least clearly below the knee; reject mini, micro, or above-knee");
  if (on(m.opaque, true)) rules.push("fabric must be opaque; reject sheer, see-through, mesh, or heavily cut-out pieces");
  if (m.hijab) rules.push("strongly prefer looks styled with a headscarf / hijab");
  if (!rules.length) return "Keep modest, non-revealing clothing.";
  return `These are CLOTHING. Apply modest dress strictly: ${rules.join("; ")}. EXCEPTION: if an item is clearly an outer layer meant to go over other clothes (open cardigan, blazer, kimono, abaya, duster), keep it even if worn open. Also reject bodycon/skin-tight pieces.`;
}
