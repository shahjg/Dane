// /api/tryon — virtual try-on via FASHN (hosted on fal.ai).
// Sends her photo + a garment image, returns her wearing it (~5-17s).
// Env: FAL_KEY  (from fal.ai). ~$0.075 per generation.
//
// personImage / garmentImage may be a public URL or a data: URI.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { FAL_KEY } = process.env;
  if (!FAL_KEY) return res.status(500).json({ error: "Missing FAL_KEY." });

  try {
    const { personImage, garmentImage } = req.body || {};
    if (!personImage || !garmentImage) return res.status(400).json({ error: "Need both images." });

    // fal runs synchronously here; for long jobs switch to their queue API.
    const r = await fetch("https://fal.run/fal-ai/fashn/tryon/v1.5", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Key ${FAL_KEY}` },
      body: JSON.stringify({
        model_image: personImage,
        garment_image: garmentImage,
        category: "auto",          // tops / bottoms / one-pieces auto-detected
        garment_photo_type: "auto",
        mode: "balanced",
      }),
    });
    const d = await r.json();
    if (!r.ok) return res.status(502).json({ error: "Try-on failed", detail: d });

    const image = d?.images?.[0]?.url || d?.image?.url || null;
    if (!image) return res.status(502).json({ error: "No image returned", detail: d });
    return res.status(200).json({ image });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Try-on failed", detail: e.message });
  }
}
