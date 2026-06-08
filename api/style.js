// /api/style — the "Layer Up" engine. Claude reads the garment and returns
// modest layering recipes (wear under / wear over) + tactical styling tips.
// Prioritizes pieces the user already owns (her basics closet).
// Env: ANTHROPIC_KEY.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { ANTHROPIC_KEY } = process.env;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "Missing ANTHROPIC_KEY." });

  try {
    const { imageBase64, mediaType = "image/jpeg", modestyLevel = "modest", basics = [] } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: "No image." });

    const ownedList = basics.filter(Boolean).join(", ") || "none listed";
    const prompt = `You are a modest-fashion stylist. Look at this garment. The goal is to make it wearable at a "${modestyLevel}" modesty level by LAYERING, not replacing it.

The user already owns these basics: ${ownedList}.
When a suggestion matches something she owns, set "owned": true and reuse her exact item.

Respond with ONLY valid JSON, no markdown:
{
 "detected": "short name of the garment",
 "under": [ { "piece": "what to wear underneath", "why": "<=12 words", "owned": false, "search_query": "shopping query if not owned" } ],
 "over":  [ { "piece": "what to layer on top", "why": "<=12 words", "owned": false, "search_query": "shopping query if not owned" } ],
 "tips": [ "one tactical styling tip", "another" ]
}
Give 2-3 under, 2-3 over, 2 tips. Keep every field tight. JSON only.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 900,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: prompt },
        ] }],
      }),
    });
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return res.status(200).json(json);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Styling failed", detail: e.message });
  }
}
