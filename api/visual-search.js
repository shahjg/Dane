// /api/visual-search — visual matches via Google Lens (SerpApi).
// Accepts EITHER:
//   imageBase64  → hosted briefly on imgbb (snapped photos)
//   imageUrl     → used directly (e.g. "find cheaper" on an existing product)
// Optional Gemini re-rank for modesty + intent.
// Env: SERPAPI_KEY (req), IMGBB_KEY (for base64 path), GEMINI_KEY (optional).
import { geminiText } from "./_gemini.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { SERPAPI_KEY, IMGBB_KEY, GEMINI_KEY, MODESTY_RERANK } = process.env;
  if (!SERPAPI_KEY) return res.status(500).json({ error: "Missing SERPAPI_KEY." });

  try {
    const { imageBase64, imageUrl, budgetMax, modestyLevel, apparel = true } = req.body || {};
    let publicUrl = imageUrl || null;

    if (!publicUrl) {
      if (!imageBase64) return res.status(400).json({ error: "No image." });
      if (!IMGBB_KEY) return res.status(500).json({ error: "Missing IMGBB_KEY." });
      const form = new URLSearchParams(); form.set("image", imageBase64);
      const up = await fetch(`https://api.imgbb.com/1/upload?expiration=600&key=${IMGBB_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
      });
      const upJson = await up.json();
      publicUrl = upJson?.data?.url || upJson?.data?.display_url;
      if (!up.ok || !publicUrl) return res.status(502).json({ error: "Image host failed", detail: upJson });
    }

    const lensUrl = new URL("https://serpapi.com/search.json");
    lensUrl.searchParams.set("engine", "google_lens");
    lensUrl.searchParams.set("type", "visual_matches");
    lensUrl.searchParams.set("url", publicUrl);
    lensUrl.searchParams.set("api_key", SERPAPI_KEY);
    if (apparel) lensUrl.searchParams.set("q", `modest ${modestyLevel || ""} affordable`.trim());

    const lensRes = await fetch(lensUrl.toString());
    const lens = await lensRes.json();
    const matches = Array.isArray(lens.visual_matches) ? lens.visual_matches : [];

    const max = Number(budgetMax) || null;
    const junk = ["aliexpress", "dhgate", "temu", "wish", "alibaba", "joom"];
    let items = matches
      .filter((m) => m.in_stock !== false)
      .filter((m) => !junk.some((b) => (m.source || "").toLowerCase().includes(b)))
      .map((m) => ({
        name: m.title, source: m.source, brand: m.source, url: m.link, thumbnail: m.thumbnail,
        price: m.price?.value || null, priceNum: m.price?.extracted_value ?? null,
      }))
      .filter((m) => (max && m.priceNum != null ? m.priceNum <= max : true));

    if (apparel && GEMINI_KEY && MODESTY_RERANK !== "off" && items.length) {
      try {
        const ranked = await modestyRerank(items, modestyLevel, max, GEMINI_KEY);
        if (ranked?.length) items = ranked;
      } catch (e) { console.warn("re-rank skipped:", e.message); }
    }

    return res.status(200).json({ count: items.length, items: items.slice(0, 40) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Search failed", detail: e.message });
  }
}

async function modestyRerank(items, modestyLevel, max, key) {
  const list = items.map((m, i) => `${i}. ${m.name} | ${m.source} | ${m.price || "n/a"}`).join("\n");
  const prompt = `These are visual-search results for clothing. Keep ONLY pieces that read as modest (good coverage of arms, legs, neckline) tuned to "${modestyLevel || "modest"}"${max ? `, priced under ${max}` : ""}, from real retailers. Drop revealing, irrelevant, or non-clothing. Return ONLY a JSON array of kept indices, best first, e.g. [3,0,7]. No other text.\n\n${list}`;
  const text = await geminiText([{ text: prompt }], key, 600);
  const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  return arr.map((i) => items[i]).filter(Boolean);
}
