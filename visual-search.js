// ───────────────────────────────────────────────────────────────
//  /api/visual-search  — the real engine (this is what Slate does)
//
//  Flow:
//   1. Receive the uploaded photo (base64) from the frontend.
//   2. Host it on Supabase Storage so it has a public URL.
//   3. Run Google Lens (via SerpApi) → real VISUAL matches w/ prices.
//   4. (optional) Claude re-ranks for modesty + budget — beats Slate.
//   5. Return clean product cards. Delete the temp image.
//
//  Env vars (set in Vercel → Project → Settings → Environment Variables):
//   SERPAPI_KEY          required  — serpapi.com (free plan to start)
//   SUPABASE_URL         required  — https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY required  — service_role key (server-side only!)
//   SUPABASE_BUCKET      optional  — defaults to "lens-temp" (make it public)
//   ANTHROPIC_KEY        optional  — enables the modesty/budget re-rank
//   MODESTY_RERANK       optional  — "off" to skip the Claude pass
// ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const {
    SERPAPI_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY,
    SUPABASE_BUCKET = "lens-temp", ANTHROPIC_KEY, MODESTY_RERANK,
  } = process.env;

  if (!SERPAPI_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "Missing env vars. See README." });
  }

  try {
    const { imageBase64, mediaType = "image/jpeg", budgetMax, modestyLevel } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: "No image." });

    // 1 + 2 — host the photo so Lens can fetch it by URL
    const ext = (mediaType.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const fileName = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const bytes = Buffer.from(imageBase64, "base64");

    const upload = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${fileName}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": mediaType,
          "x-upsert": "true",
        },
        body: bytes,
      }
    );
    if (!upload.ok) {
      const t = await upload.text();
      return res.status(500).json({ error: "Storage upload failed", detail: t });
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${fileName}`;

    // 3 — Google Lens visual matches (the actual Slate mechanism)
    const lensUrl = new URL("https://serpapi.com/search.json");
    lensUrl.searchParams.set("engine", "google_lens");
    lensUrl.searchParams.set("type", "visual_matches");
    lensUrl.searchParams.set("url", publicUrl);
    lensUrl.searchParams.set("api_key", SERPAPI_KEY);
    // refine toward modest, affordable clothing
    lensUrl.searchParams.set("q", `modest ${modestyLevel || ""} affordable clothing`.trim());

    const lensRes = await fetch(lensUrl.toString());
    const lens = await lensRes.json();
    let matches = Array.isArray(lens.visual_matches) ? lens.visual_matches : [];

    // clean up the temp upload (don't keep user photos around)
    fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${fileName}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    }).catch(() => {});

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

    // 4 — optional Claude re-rank for modesty + budget (the "better than Slate" layer)
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
// Text-only (cheap/fast). Upgrade idea: send thumbnails for true visual modesty.
async function modestyRerank(items, modestyLevel, max, key) {
  const list = items
    .map((m, i) => `${i}. ${m.name} | ${m.source} | ${m.price || "n/a"}`)
    .join("\n");
  const prompt = `These are visual-search results for clothing. Keep ONLY pieces that read as modest (good coverage of arms, legs, neckline) tuned to "${modestyLevel || "very modest"}"${max ? `, priced under ${max}` : ""}. Drop anything revealing, irrelevant, or non-clothing. Return ONLY a JSON array of the kept indices, best match first, e.g. [3,0,7]. No other text.\n\n${list}`;

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
