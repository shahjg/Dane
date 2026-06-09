// /api/tryon — virtual try-on via Google's Gemini image model ("Nano Banana").
// Uses the GEMINI_KEY you already have; free image tier likely covers a single
// user, else ~$0.039/image. Result is hosted on imgbb so the app caches a small
// URL (not a huge base64 string). Env: GEMINI_KEY (req), IMGBB_KEY (req).
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { GEMINI_KEY, IMGBB_KEY } = process.env;
  if (!GEMINI_KEY) return res.status(500).json({ error: "Missing GEMINI_KEY." });

  try {
    const { personImage, garmentImage } = req.body || {};
    if (!personImage || !garmentImage) return res.status(400).json({ error: "Need both images." });

    const person = await toInline(personImage);
    const garment = await toInline(garmentImage);

    const prompt = "Photorealistically dress the person from the FIRST image in the clothing item shown in the SECOND image. " +
      "Keep the person's face, hair, body shape, pose, skin tone and the background exactly the same. " +
      "Replace only their outfit with the given garment, draping it naturally and modestly with full, realistic coverage. " +
      "Return only the edited photograph, no text.";

    const body = {
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: person.mime, data: person.data } },
        { inline_data: { mime_type: garment.mime, data: garment.data } },
      ]}],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    };

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) return res.status(502).json({ error: shortErr(d) });

    const parts = d?.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => p.inline_data?.data || p.inlineData?.data);
    const b64 = img?.inline_data?.data || img?.inlineData?.data;
    if (!b64) return res.status(502).json({ error: "Model didn't return an image. Try a clearer full-body photo." });

    if (IMGBB_KEY) {
      const url = await hostOnImgbb(b64, IMGBB_KEY);
      return res.status(200).json({ image: url });
    }
    return res.status(200).json({ image: `data:image/png;base64,${b64}` });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Try-on error: " + e.message });
  }
}

// Returns {mime, data(base64)} from a data: URI or an http(s) URL.
async function toInline(image) {
  if (image.startsWith("data:")) {
    const [head, data] = image.split(",");
    const mime = (head.match(/data:(.*?);/) || [])[1] || "image/jpeg";
    return { mime, data };
  }
  const r = await fetch(image);
  if (!r.ok) throw new Error("couldn't fetch garment image");
  const buf = Buffer.from(await r.arrayBuffer());
  return { mime: r.headers.get("content-type") || "image/jpeg", data: buf.toString("base64") };
}

async function hostOnImgbb(b64, key) {
  const form = new URLSearchParams(); form.set("image", b64);
  const up = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
  });
  const j = await up.json();
  const url = j?.data?.url || j?.data?.display_url;
  if (!url) throw new Error("couldn't host the result");
  return url;
}

function shortErr(d) {
  const m = d?.error?.message || d?.message;
  return ("" + (m || "Gemini rejected the request")).slice(0, 140);
}
