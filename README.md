# D4NE — visual modest-fashion search

Send a photo → it matches the look **visually** against products across the
web (via Google Lens) → returns modest, affordable alternatives with real
thumbnails, prices, and buy links. An optional Claude pass re-ranks results
for modesty and budget.

Tiny full-stack app, same shape as D(ane)ua / TheGaming.co:
- `index.html` — the frontend (static)
- `api/visual-search.js` — one Vercel serverless function (the engine)

## Why this needs a backend (not just an artifact)
True visual search needs two things an artifact can't do: **host the uploaded
photo at a public URL**, and **call a reverse-image API**. So it runs as one
function, zero npm deps (Node 18+ has global fetch).

## 1. Keys
- **SerpApi** (Google Lens engine): serpapi.com → copy your API key.
  SearchApi.io is a drop-in alternative if you prefer.
- **Supabase**: create a Storage bucket named `lens-temp` and mark it
  **public**. Grab the project URL + `service_role` key from Settings → API.
- **Anthropic** (optional): an API key turns on the modesty/budget re-rank.

## 2. Deploy on Vercel
1. Drop this folder in a git repo, import to Vercel.
2. Settings → Environment Variables:
   ```
   SERPAPI_KEY=...
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_KEY=...           (service_role — server only, never ship to the browser)
   SUPABASE_BUCKET=lens-temp
   ANTHROPIC_KEY=...                  (optional)
   MODESTY_RERANK=on                  (set "off" to skip the Claude pass)
   NTFY_TOPIC=d4ne-shahjahan-7f3k9q2x (long secret-ish string for phone push)
   ```
3. Deploy. `index.html` serves at `/`, the function at `/api/visual-search`.

Point a domain at it the way you did with ewathletic.com.

## "Send to Shahjahan" (free phone push)
Real free SMS no longer exists (carriers killed the email-to-text gateways),
so this uses **ntfy** — a free push that's more reliable and carries links:
1. Shahjahan installs the free **ntfy** app (App Store / Google Play).
2. In the app, subscribe to one topic — the exact string you set in
   `NTFY_TOPIC` (pick a long, hard-to-guess one).
3. Done. Every "Send to Shahjahan" lands as a push with the product photo and
   a tap-to-open buy link. It also asks the sender for size/colour first.

"Email" stays a one-tap link (opens Mail pre-filled). No WhatsApp.

## How it works (per search)
1. Frontend sends the photo as base64.
2. Function uploads it to Supabase Storage → public URL, then **deletes it
   after** (photos aren't kept).
3. Google Lens returns visual matches (title, source, price, thumbnail, link).
4. Budget + in-stock filter, then optional Claude modesty re-rank.
5. Frontend renders product cards with the real thumbnails.

## Upgrades
- **JAHAAN-first:** before external results, check your own Shopify catalog and
  pin matching pieces to the top.
- **True visual modesty:** upgrade `modestyRerank()` to send candidate
  thumbnails to Claude vision instead of titles (more accurate, slightly slower).
- **Wishlist:** save favorites to a Supabase table (same pattern as D(ane)ua).
- **Cache:** store results keyed by an image hash so repeat searches are instant.

## Limits
- Google Lens matches what's indexed on the web, not literally everything.
- Lens occasionally returns a non-clothing or stale result — the Claude
  re-rank cleans most of these.
- API tiers cap monthly searches; check current limits on the provider.
