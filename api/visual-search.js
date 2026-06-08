// ───────────────────────────────────────────────────────────────
//  /api/visual-search  — the real engine (this is what Slate does)
//
//  Flow:
//   1. Receive the uploaded photo (base64) from the frontend.
//   2. Host it briefly on imgbb (auto-deletes itself — no cleanup).
//   3. Run Google Lens (via SerpApi) → real VISUAL matches w/ prices.
//   4. (optional) Claude re-ranks for modesty + budget.
//   5. Return clean product cards.
//
//  Env vars (Vercel → Settings → Environment Variables):
//   SERPAPI_KEY    required  — serpapi.com
//   IMGBB_KEY      required  — api.imgbb.com (free key; hosts the temp photo)
//   ANTHROPIC_KEY  optional  — enables the modesty/budget re-rank
//   MODESTY_RERANK optional  — "off" to skip the Claude pass
//
//  No Supabase needed. (Swap imgbb for Vercel Blob if you prefer in-platform.)
// ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { SERPAPI_KEY, IMGBB_KEY, ANTHROPIC_KEY, MODESTY_RERANK } = process.env;
  if (!SERPAPI_KEY || !IMGBB_KEY) {
    return res.status(500).json({ error: "Missing SERPAPI_KEY or IMGBB_KEY. See README." });
  }

  try {
    const { imageBase64, budgetMax, modestyLevel } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: "No image." });

    // 1 + 2 — host the photo so Lens can fetch it by URL.
    // expiration=600 → imgbb auto-deletes it after 10 minutes.
    const form = new URLSearchParams();
    form.set("image", imageBase64);
    const up = await fetch(`https://api.imgbb.com/1/upload?expiration=600&key=${IMGBB_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const upJson = await up.json();
    const publicUrl = upJson?.data?.url || upJson?.data?.display_url;
    if (!up.ok || !publicUrl) {
      return res.status(502).json({ error: "Image host failed", detail: upJson });
    }

    // 3 — Google Lens visual matches (the actual Slate mechanism)
    const lensUrl = new URL("https://serpapi.com/search.json");
    lensUrl.searchParams.set("engine", "google_lens");
    lensUrl.searchParams.set("type", "visual_matches");
    lensUrl.searchParams.set("url", publicUrl);
    lensUrl.searchParams.set("api_key", SERPAPI_KEY);
    lensUrl.searchParams.set("q", `modest ${modestyLevel || ""} affordable clothing`.trim());

    const lensRes = await fetch(lensUrl.toString());
    const lens = await lensRes.json();
    let matches = Array.isArray(lens.visual_matches) ? lens.visual_matches : [];

    // normalize + basic budget/stock filter
    const max = Number(budgetMax) || null;
    let items = matches
      .filter((m) => m.in_stock !== false)
      .map((m) => ({
        name: m.title,
        source: m.source,
        url: m.link,
        thumbnail: m.thumbnail,
        price: m.price?.value || null,
        priceNum: m.price?.extracted_value ?? null,
        currency: m.price?.currency || null,
        rating: m.rating ?? null,
      }))
      .filter((m) => (max && m.priceNum != null ? m.priceNum <= max : true));

    // 4 — optional Claude re-rank for modesty + budget
    if (ANTHROPIC_KEY && MODESTY_RERANK !== "off" && items.length) {
      try {
        const ranked = await modestyRerank(items, modestyLevel, max, ANTHROPIC_KEY);
        if (ranked?.length) items = ranked;
      } catch (e) {
        console.warn("re-rank skipped:", e.message);
      }
    }

    return res.status(200).json({ count: items.length, items: items.slice(0, 18) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Search failed", detail: e.message });
  }
}

// Ask Claude which results are actually modest + in budget, best first.
async function modestyRerank(items, modestyLevel, max, key) {
  const list = items
    .map((m, i) => `${i}. ${m.name} | ${m.source} | ${m.price || "n/a"}`)
    .join("\n");
  const prompt = `These are visual-search results for clothing. Keep ONLY pieces that read as modest (good coverage of arms, legs, neckline) tuned to "${modestyLevel || "modest"}"${max ? `, priced under ${max}` : ""}. Drop anything revealing, irrelevant, or non-clothing. Return ONLY a JSON array of the kept indices, best match first, e.g. [3,0,7]. No other text.\n\n${list}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  return arr.map((i) => items[i]).filter(Boolean);
}
