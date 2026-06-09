// /api/tryon — virtual try-on via FASHN v1.5 (hosted on fal.ai).
// Both images are re-hosted on imgbb first so fal can reliably fetch them
// (her photo may arrive as base64; garment links are often hotlink-protected).
// Env: FAL_KEY (required), IMGBB_KEY (required).
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { FAL_KEY, IMGBB_KEY } = process.env;
  if (!FAL_KEY) return res.status(500).json({ error: "Missing FAL_KEY." });

  try {
    const { personImage, garmentImage, category } = req.body || {};
    if (!personImage || !garmentImage) return res.status(400).json({ error: "Need both images." });

    let modelUrl = personImage, garmentUrl = garmentImage;
    if (IMGBB_KEY) {
      [modelUrl, garmentUrl] = await Promise.all([
        hostOnImgbb(personImage, IMGBB_KEY),
        hostOnImgbb(garmentImage, IMGBB_KEY),
      ]);
    }

    const r = await fetch("https://fal.run/fal-ai/fashn/tryon/v1.6", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Key ${FAL_KEY}` },
      body: JSON.stringify({
        model_image: modelUrl,
        garment_image: garmentUrl,
        category: category || "auto",
        garment_photo_type: "auto",
        mode: "quality",
        num_samples: 1,
      }),
    });
    const d = await r.json();
    if (!r.ok) return res.status(502).json({ error: shortErr(d) });

    const image = d?.images?.[0]?.url || d?.image?.url || null;
    if (!image) return res.status(502).json({ error: "fal returned no image." });
    return res.status(200).json({ image });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Try-on error: " + e.message });
  }
}

// Accepts a data: URI or an http(s) URL; returns a hosted imgbb URL.
async function hostOnImgbb(image, key) {
  const form = new URLSearchParams();
  form.set("image", image.startsWith("data:") ? image.split(",")[1] : image);
  const up = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
  });
  const j = await up.json();
  const url = j?.data?.url || j?.data?.display_url;
  if (!url) throw new Error("couldn't host an image");
  return url;
}

function shortErr(d) {
  const m = d?.detail || d?.error || d?.message;
  if (Array.isArray(m)) return (m[0]?.msg || "fal rejected the request").slice(0, 120);
  return ("" + (m || "fal rejected the request")).slice(0, 120);
}
