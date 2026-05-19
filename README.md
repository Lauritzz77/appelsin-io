# appelsin

Live event photo sharing — guests scan a QR code on the table, upload photos
from their phone, and the photos appear on the big screen in real time.

A modern (Astro 6 / Cloudflare / Vue 3) rebuild of the 2019 `appelsin.io`
idea. See [PLAN.md](./PLAN.md) for the full product plan and weekly
milestones.

## Stack

- **Astro 6** SSR + **Vue 3** islands (guest upload, live photo wall)
- **Cloudflare**: Workers + Pages, D1 (Drizzle), R2, Images, Durable Objects
- **Better Auth** on D1 + magic links via **Resend** (console-logged in dev)
- **Stripe** for event passes + planner subscriptions (not wired yet)
- **Tailwind CSS v4**

## Local development

### Prerequisites

- Node 24 (see `.nvmrc`) and pnpm 10
- A Cloudflare account with **R2** and **Images** enabled (Images is $5/mo)
- `pnpm exec wrangler login` once

### First-time setup

```bash
pnpm install

# Provision resources on your CF account (EU region per GDPR):
pnpm exec wrangler d1 create appelsin-io-db --location=weur
pnpm exec wrangler r2 bucket create appelsin-io-photos --jurisdiction=eu
```

Paste the returned `database_id` into `wrangler.jsonc` →
`d1_databases[0].database_id`. Then:

```bash
pnpm exec wrangler types
pnpm exec wrangler d1 migrations apply appelsin-io-db --local
```

Set CF Images account ID + delivery hash in `wrangler.jsonc` → `vars`:

```jsonc
"CF_IMAGES_ACCOUNT_ID": "<your-cf-account-id>",
"CF_IMAGES_HASH":       "<your-delivery-hash>"
```

(Both are on the **Images → Hosted images** dashboard. Watch out: capital `O`
vs digit `0` are easy to confuse — copy from the API response or the
right-hand panel, not the rendered text.)

Create `.dev.vars` (gitignored) with:

```env
BETTER_AUTH_SECRET=<openssl rand -hex 32>
RESEND_API_KEY=                          # empty = dev mode (links to console)
RESEND_FROM_EMAIL=onboarding@resend.dev
STRIPE_SECRET_KEY=                       # only when wiring Stripe Checkout
STRIPE_WEBHOOK_SECRET=
CF_IMAGES_API_TOKEN=<token with Cloudflare Images:Edit>
```

### Run the dev server

```bash
pnpm dev
```

Opens on http://localhost:4321 (or 4322 if 4321 is busy — the terminal
prints the actual URL).

## Testing the app

### 1. Sign in (no real email needed)

1. Open http://localhost:4321/login
2. Enter any email — Better Auth signs up + signs in in the same step
3. Hit **Send sign-in link**
4. **Watch the terminal running `pnpm dev`.** Since `RESEND_API_KEY` is empty,
   the magic link is logged to the console instead of sent. Look for:

   ```
   [email:dev] → you@example.com | Sign in to appelsin
    <p>Click to sign in: <a href="http://localhost:4321/api/auth/magic-link/verify?token=...">...</a></p>
   ```

5. Open that link in the same browser → you land on `/app`

### 2. Create + activate an event

1. From `/app` click **New event**, give it a name and date, **Create**
2. Click the new event on the dashboard → `/app/events/[id]`
3. Click **Activate event** — status flips `draft` → `live`. (This is the
   interim button; once Stripe Checkout is wired, that webhook will flip
   the status for paid events instead.)
4. Now click **Open photo wall** — `/display/[code]` opens in a new tab with
   "● live" status and an empty grid.

### 3. Add photos — three ways

#### A) Real upload from the browser (the actual product flow)

In another tab open `http://localhost:4321/e/<CODE>` (the 6-char short code
shown on the event detail page). Tap **Tap to add a photo**, pick an image —
it compresses client-side, uploads direct to Cloudflare Images, our Worker
records the row and broadcasts via the per-event Durable Object. You should
see it pop in on the display tab within ~1s.

This uses real CF Images storage + delivery (counts against your quota).

#### B) Dev-only fake inject (no Images bytes used)

For exercising the realtime path without touching CF Images:

```bash
# Get your session cookie first — easiest: in the authed tab open DevTools →
# Application → Cookies → copy the `better-auth.session_token` value
SESSION='better-auth.session_token=...'
CODE=ABCDEF

curl -X POST http://localhost:4321/api/dev/inject-photo \
  -H "Cookie: $SESSION" \
  -H "Origin: http://localhost:4321" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\"}"
```

Creates a photo row with `cf_images_id=null` and broadcasts to the DO. The
display wall renders a colored tile placeholder instead of an image. Only
available in `import.meta.env.DEV`.

#### C) Programmatic upload via curl (CI-style smoke)

The full three-step pipeline without a browser:

```bash
PORT=4321
CODE=ABCDEF

# 1. Mint a one-time signed upload URL
RESP=$(curl -s -X POST "http://localhost:$PORT/api/upload-url" \
  -H "Origin: http://localhost:$PORT" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\"}")
UPLOAD_URL=$(echo "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["uploadURL"])')
CF_ID=$(echo "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

# 2. Upload the image bytes direct to Cloudflare Images
curl -s -F "file=@/path/to/your/photo.jpg" "$UPLOAD_URL"

# 3. Tell our Worker the upload landed → inserts D1 row + broadcasts to DO
curl -s -X POST "http://localhost:$PORT/api/photo-uploaded" \
  -H "Origin: http://localhost:$PORT" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\",\"cfImagesId\":\"$CF_ID\"}"
```

Need a test image? Generate one from the logo:

```bash
sips -s format jpeg public/logo.svg --out /tmp/test.jpg --resampleHeightWidth 400 400
```

### 4. Test from your phone (LAN)

To scan the QR PDF from your phone on the same wifi:

```bash
pnpm dev --host
```

Note the LAN URL it prints (`http://192.168.1.x:4321`). Temporarily set
`PUBLIC_APP_URL` in `wrangler.jsonc` to that URL — the QR codes encode this
baseURL — then download the QR PDF from `/app/events/[id]/qr.pdf` and scan
it. Revert `PUBLIC_APP_URL` afterwards.

## Deploy

```bash
pnpm build
pnpm exec wrangler deploy
```

Production secrets (each prompts you for the value):

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put RESEND_API_KEY
pnpm exec wrangler secret put CF_IMAGES_API_TOKEN
pnpm exec wrangler secret put STRIPE_SECRET_KEY
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET
```

D1 migrations against prod:

```bash
pnpm exec wrangler d1 migrations apply appelsin-io-db --remote
```

## Repo layout

- `src/pages/` — Astro pages + API routes
- `src/components/` — Vue islands (`PhotoWall`, `GuestUpload`)
- `src/lib/` — auth, email, stripe, qr-pdf helpers
- `src/db/schema.ts` — Drizzle schema (source of truth for D1)
- `src/middleware.ts` — protects `/app/*`, populates `Astro.locals.host`
- `src/worker-entry.ts` — custom Worker entry hosting the `EventChannel`
  Durable Object alongside Astro's fetch handler
- `drizzle/migrations/` — generated SQL migrations
- `wrangler.jsonc` — Cloudflare resource bindings (DB, R2, DO, vars)
- `PLAN.md` — full product + tech plan with weekly milestones
