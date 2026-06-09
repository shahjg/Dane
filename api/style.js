// /api/style — "Layer Up" / styling helper. Gemini reads a garment and returns
// modest layering recipes (under/over) + tips. Accepts imageBase64 or imageUrl.
// Env: GEMINI_KEY (free).
import { geminiText } from "./_gemini.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { GEMINI_KEY } = process.env;
  if (!GEMINI_KEY) return res.status(500).json({ error: "Missing GEMINI_KEY." });

  try {
    let { imageBase64, mediaType = "image/jpeg", imageUrl, modestyLevel = "modest", basics = [] } = req.body || {};
    if (!imageBase64 && imageUrl) {
      const im = await fetch(imageUrl);
      const buf = Buffer.from(await im.arrayBuffer());
      imageBase64 = buf.toString("base64");
      mediaType = im.headers.get("content-type") || "image/jpeg";
    }
    if (!imageBase64) return res.status(400).json({ error: "No image." });

    const owned = basics.filter(Boolean).join(", ") || "none listed";
    const prompt = `You are a modest-fashion stylist. Look at this garment. Make it wearable at a "${modestyLevel}" modesty level by LAYERING, not replacing it.
The user already owns these basics: ${owned}. When a suggestion matches something she owns, set "owned": true and reuse her exact item.
"over" may include outerwear AND headwear when it suits the look — e.g. a hijab / headscarf, a hat, beret, or a layering scarf.
Respond with ONLY valid JSON, no markdown:
{"detected":"short name","under":[{"piece":"...","why":"<=12 words","owned":false,"search_query":"query if not owned"}],"over":[{"piece":"...","why":"<=12 words","owned":false,"search_query":"..."}],"tips":["tip","tip"]}
Give 2-3 under, 2-3 over (include at least one headwear option like a hijab or hat when appropriate), and 2 tips. Tight fields. JSON only.`;

    const text = await geminiText(
      [{ inline_data: { mime_type: mediaType, data: imageBase64 } }, { text: prompt }],
      GEMINI_KEY, 900
    );
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return res.status(200).json(json);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Styling failed", detail: e.message });
  }
}
