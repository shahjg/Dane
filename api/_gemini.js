// Shared Gemini helper (free tier, no credit card). Model can be swapped here.
export const GEMINI_MODEL = "gemini-2.5-flash";

export async function geminiText(parts, key, maxTokens = 400) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d).slice(0, 300));
  return (d?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
}
