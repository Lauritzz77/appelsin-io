# Plan: appelsin — live event photo SaaS

## Context

The old repo at `/Users/laurasmussen/sites/Private/jm-wedding` is a dead 2019
Vue 2 + Firebase 5 + FilePond scaffold of `appelsin.io` — no recoverable code,
no git history, just dep clues. **We are not modifying that repo.** It served
only as inspiration: same product idea, modern execution.

This repo is the greenfield 2026 rebuild. Guests at an event scan a QR code,
upload photos from their phone, and the photos appear live on a big screen.
Hosts pay; guests upload anonymously.

**Stack directive**: Astro (latest, v6) for the app shell + pages, Cloudflare
end-to-end for hosting/compute/database/storage/images/realtime, Vue islands
for the interactive carousel and upload UI.

Target: 6–8 week MVP for a solo developer.

---

## Product summary

A SaaS where event hosts (couples, party planners, venues) create an event in
a dashboard, get a printable QR-code pack, and a live photo wall that animates
new guest uploads onto a big screen at the venue. After the event, hosts can
download a zip of all photos.

Two audiences:
- **B2C one-off** — couples buying a single event for their wedding.
- **B2B repeat** — planners and venues who run many events per month.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Astro 6** with `output: 'server'`, Cloudflare adapter (`@astrojs/cloudflare`) | Content-heavy marketing + dashboard renders fast as SSR/static; islands let us put Vue only where it earns its weight |
| Interactive islands | **Vue 3** via `@astrojs/vue` | Carousel, live photo wall, guest upload UI — these are the few places we need reactivity. Keeps a thread of continuity with the original project's Vue heritage |
| UI styling | **Tailwind CSS v4** + a small handcrafted component set (Astro components + Vue components). Skipping shadcn (React-only) | Tailwind v4 works cleanly across Astro and Vue islands |
| Hosting + compute | **Cloudflare Pages + Workers** (single deploy via the Astro Cloudflare adapter) | Free tier is generous; zero egress fees; edge-deployed worldwide |
| Database | **Cloudflare D1** (SQLite at the edge) with **Drizzle ORM** for typesafe schema + migrations | SQLite scales fine for this workload (low write rate per event); Drizzle gives us migrations and types |
| Object storage | **Cloudflare R2** for original photos, zip archives | No egress fees, S3-compatible |
| Image CDN + transforms | **Cloudflare Images** for thumbnail/display variants and direct-creator uploads from guest phones | Direct uploads bypass our Workers entirely; auto-resize via variants; signed URLs for private events |
| Realtime (photo wall) | **Cloudflare Durable Objects** with hibernating WebSockets — one DO per event keyed by `short_code`; broadcasts new-photo events to subscribed display clients | The 2026 way on Cloudflare. Hibernation keeps idle cost ~zero |
| Auth (hosts) | **Better Auth** on Workers + D1 with email magic links sent via **Resend** (free tier: 100/day, 3k/mo) | No third-party *auth* vendor (MailChannels stopped being free on CF Workers in mid-2024; Resend is the 2026 default for transactional from Workers); magic link UX matches Notion/Linear |
| Auth (guests) | **None** — gate uploads by event `short_code` + signed Cloudflare Images upload URL + IP rate-limit (Cloudflare Rate Limiting rules) | Simpler than anonymous auth, one less SDK on the phone-side page |
| Payments | **Stripe** Checkout (one-off event passes) + Subscriptions + Customer Portal, with webhook handled by a Worker | Standard 2026 SaaS billing |
| PDF generation | **`pdf-lib`** in a Worker for the printable QR-pack | Lightweight, works in Workers runtime; reasonable layout control |
| QR codes | **`qrcode`** npm | Generates SVG that we embed into the PDF |
| Client image compression | **`browser-image-compression`** in the Vue upload island | Survives venue wifi; cuts ~10MB phone photos to ~1MB |
| Cron / scheduled jobs | **Cloudflare Cron Triggers** | Retention cleanup, event status transitions (draft → live → ended) |
| KV (short-code lookup cache) | **Cloudflare KV** (`SHORT_CODE_CACHE`) | Fast edge cache for the hot path `short_code → event_id` lookup. Deferred until we wire that path |

---

## Data model (D1 / Drizzle)

- `hosts` — id, email, stripe_customer_id, plan, created_at
- `sessions` — id, host_id, expires_at, token (Better Auth managed)
- `events` — id, host_id, name, event_date, short_code (6-char, unique), retention_days, status (`draft`/`live`/`ended`), moderation_mode (`open`/`queue`), branding_json, created_at, expires_at
- `photos` — id, event_id, cf_images_id (Cloudflare Images UUID), r2_original_key, uploader_fingerprint, caption, status (`pending`/`approved`/`rejected`), nsfw_score, created_at
- `subscriptions` — host_id, stripe_sub_id, tier, current_period_end
- `event_purchases` — id, host_id, event_id, stripe_session_id, tier

**Access control** (D1 has no RLS — enforced in Workers / Astro endpoints):
- Host endpoints: middleware checks session → host_id, then every D1 query is scoped `WHERE host_id = ?`
- Guest endpoints: take `short_code` → resolve `event_id` (via KV cache once wired); rate-limit per IP per code; mint a one-time Cloudflare Images Direct Creator Upload URL with TTL
- Display endpoints: take `short_code`, returns only `status='approved'` photo records joined via cached lookup
- All endpoints validate `short_code` is for a `status='live'` event before doing anything

---

## Realtime architecture (the magic moment)

Each event has its own Durable Object instance, keyed by `short_code`:

1. **Display client** (`/display/[code]`) opens a WebSocket to `/api/display-socket?code=ABC123`. The Worker resolves `code → event_id`, looks up the DO stub for that event, forwards the WebSocket. DO accepts and stores the connection in its hibernating-WebSocket list.
2. **Guest uploads a photo** → CF Images direct upload completes → CF Images webhook hits our Worker → Worker inserts a row in D1, then sends a fetch to the event's DO with `{type: 'new-photo', photoId, cfImagesId}`.
3. **DO broadcasts** the new-photo message to all connected display WebSockets. Each display client (a Vue island) receives the message and animates the new photo onto the wall via Vue's `<Transition>` or Motion One.

Why hibernating WebSockets: when nothing is happening, the DO sleeps. Wakes only on insert. Cost is near-zero between events.

Fallback: if a display reconnects mid-event, it first re-fetches the last N approved photos via a regular HTTP endpoint, then opens the WebSocket for live updates.

**Wiring note**: the Astro Cloudflare adapter's default entrypoint (`@astrojs/cloudflare/entrypoints/server`) only exports `{ fetch }`. To ship a Durable Object class we need a custom worker entrypoint that imports Astro's handler and re-exports it alongside our `EventChannel` class. This is a small but real piece of plumbing that lands in the realtime step.

**Astro 6.3 opportunity** (evaluate at the realtime step): the new experimental advanced-routing API has first-class Hono support and lets us compose handlers, proxy paths, and control middleware/rendering order from Astro itself. For `/api/display-socket` (WebSocket upgrade → DO forward) and `/api/cf-images-webhook`, this may give a cleaner pipeline than vanilla Astro endpoints. The `EventChannel` class export still has to live on the Worker entrypoint — that's Cloudflare-side plumbing, not Astro routing.

---

## Routes / pages

**Marketing** (static Astro, no JS)
- `/`, `/pricing`, `/legal/privacy`, `/legal/tos`

**Host app** (SSR Astro, auth required)
- `/login`, `/signup` — magic link form, Vue island for the input field state
- `/app` — event list
- `/app/events/new` — create wizard
- `/app/events/[id]` — overview with Astro tabs: gallery · moderation · qr · settings · download
- `/app/events/[id]/qr` — PDF download endpoint (Worker generates with `pdf-lib`)
- `/app/billing` → Stripe Customer Portal

**Guest** (no auth)
- `/e/[code]` — mobile-first upload page. **Vue island** handles file pick, client-side compress, progress UI, direct upload to Cloudflare Images via signed URL

**Display** (no auth)
- `/display/[code]` — fullscreen photo wall. **Vue island** holds the WebSocket connection, mosaic grid, pop-in animations, optional slideshow mode toggle (v2)

**API / Worker routes**
- `/api/auth/*` — Better Auth handlers
- `/api/upload-url?code=ABC123` — issues signed Cloudflare Images creator upload URL
- `/api/cf-images-webhook` — receives upload-complete notification, writes D1, notifies DO
- `/api/display-socket?code=ABC123` — WebSocket upgrade, forwards to DO
- `/api/stripe/webhook`
- `/api/events/[id]/zip` — streamed zip via `client-zip` from a Worker, pulling originals from R2

---

## SaaS pricing (hybrid)

- **One-off event passes** (primary B2C revenue):
  - Lite €29 — 50 photos, 7-day retention, watermark
  - Plus €59 — 500 photos, 30-day retention, branding
  - Pro €99 — unlimited photos, 90-day retention, no watermark
- **Subscription Pro** (planners/venues): €39/mo or €390/yr — unlimited events, white-label, team seats (v2)
- **Free trial**: 1 event, 30 photos, 7-day retention, watermarked

---

## MVP scope (proves the core loop)

1. Host signup + login (magic link via Better Auth + Resend)
2. Create one event → 6-char short-code generated
3. QR PDF download (one A4 sign layout, ten table-cards) generated by `pdf-lib` Worker
4. Guest upload page at `/e/[code]` — Vue island compresses client-side, uploads direct to CF Images
5. Live display page at `/display/[code]` — Vue island with WebSocket → Durable Object, pop-in animation
6. Stripe Checkout for a single tier (Plus €59); webhook flips event to `status='live'`
7. Photo zip download (sync, size-capped, streamed from R2)
8. Auto-expiry Cron Trigger that deletes expired event R2 objects + CF Images entries + D1 rows
9. Legal pages, basic landing page

**Deferred to v2**: moderation queue, NSFW auto-flag, custom branding, video clips, slideshow themes, AI captions/grouping, team seats, analytics, white-label domains, multi-language.

**Sponsor-watermark for B2B events (v2)** — for corporate / sponsored events (e.g. "AWS RE:Event"), the sponsor's logo is overlaid on the shareable version of each guest photo. Every share to Instagram, LinkedIn or Facebook becomes a small ad for the sponsor — strong organic-reach pitch when selling to brand marketers. Reuses the same overlay plumbing the Lite tier already needs for the appelsin-branded watermark, so both features ship together. Tech: a Cloudflare Images variant with overlay transformation, or a client-side canvas composite invoked from the Web Share API after upload. UX: "Save & share" button on `/e/[code]` post-upload that hands the watermarked variant to the native share sheet. Likely sold as a dedicated "Event sponsor" add-on on top of Subscription Pro, priced per-event or as an annual brand-activation contract.

---

## Top risks & mitigations

1. **GDPR/consent** — guest photos of identifiable people. Mitigations: guest consent checkbox on upload, host-side ToS acceptance at event creation, EU-region D1 + R2 buckets, retention-based auto-deletion via Cron Triggers, DPA template ready for B2B.
2. **NSFW / abuse on the wedding screen** — one bad image is catastrophic. Mitigations: free/lite tiers default to `moderation_mode='queue'`, NSFW scoring (Cloudflare AI Workers `@cf/llava` or AWS Rekognition) on upload before the DO broadcasts, host-side "pause display" kill switch wired through the DO, per-fingerprint ban.
3. **Venue wifi reliability** — typical wedding venue = one bar of LTE. Mitigations: aggressive client compression, Cloudflare Images direct-creator upload (no Worker proxy = fewer hops), service-worker retry queue, "uploads will retry" UX with progress.

---

## Day-1 scaffold (DONE — commit `96e40aa` on `main`)

- `git init` at `/Users/laurasmussen/sites/appelsin-io/`
- `pnpm create astro@latest . --template minimal` → Astro 6.3.1
- `pnpm astro add cloudflare vue tailwind` → `@astrojs/cloudflare` 13.5, `@astrojs/vue` 6.0, Tailwind v4 via `@tailwindcss/vite`
- Runtime deps added: `drizzle-orm`, `better-auth`, `stripe`, `pdf-lib`, `qrcode`, `browser-image-compression`, `client-zip`
- Dev deps added: `drizzle-kit`, `@types/qrcode`, `@types/node`
- `wrangler.jsonc` configured with D1 + R2 bindings (placeholder IDs) and a retention Cron Trigger. KV (`SHORT_CODE_CACHE`) and Durable Object (`EVENT_CHANNEL` / `EventChannel`) bindings are commented out with notes — they come back in the realtime step.
- `.gitignore` extended for `.wrangler/`, `worker-configuration.d.ts`, `.dev.vars`
- `.nvmrc` set to `24.13.1` (Node 24 LTS)
- Minimal `src/layouts/Layout.astro` (imports Tailwind) + placeholder `src/pages/index.astro`
- `pnpm build` is green; `pnpm exec wrangler types` generates `worker-configuration.d.ts` cleanly

---

## Next steps (week 1 of the plan)

1. **Provision Cloudflare resources**:
   ```bash
   wrangler d1 create appelsin-io-db
   wrangler r2 bucket create appelsin-io-photos
   ```
   Paste returned `database_id` into `wrangler.jsonc`.

2. **Drizzle schema** at `src/db/schema.ts` — tables from the data model above. Generate first migration with `drizzle-kit generate` into `./drizzle/migrations`, apply with `wrangler d1 migrations apply appelsin-io-db --local`.

3. **Better Auth** wiring at `src/lib/auth.ts` using the `drizzle` adapter + magic-link plugin. Resend for delivery (dev mode logs the link to console; only sends when `RESEND_API_KEY` is set). Add `/api/auth/[...all].ts` route handler.

4. **Astro middleware** at `src/middleware.ts` — protects `/app/*` routes, exposes `Astro.locals.host` for the dashboard.

5. **Stripe** setup at `src/lib/stripe.ts` + `/api/stripe/webhook.ts`. Store test secrets in `.dev.vars`, prod via `wrangler secret put`.

6. **First end-to-end smoke test**: sign up, log in, create an event row in D1, see it in the host dashboard.

After week 1, the remaining MVP work runs roughly:
- Weeks 2–3: guest upload Vue island + CF Images direct upload + display Vue island + Durable Object realtime (this is the magic — invest here)
- Week 4: QR PDF generation Worker + R2 zip download
- Week 5: retention Cron Trigger + landing page + pricing + legal pages
- Weeks 6–7: beta with one real wedding; fix bugs you only find on a real venue's wifi
- Week 8: payment polish, launch

Add ~50% if learning Astro 6, Drizzle, Cloudflare Durable Objects, or Better Auth for the first time.

---

## Verification (how we'll know the MVP works)

1. **Loop test on a laptop**: host signs up → creates event → opens `/display/[code]` on a second tab → opens `/e/[code]` on phone → upload → photo appears on display within 2s via WebSocket. Repeat 10×, watch ordering.
2. **Venue wifi simulation**: throttle network in Chrome devtools to "Slow 3G", upload from `/e/[code]`, confirm direct CF Images upload + retry UX behaves.
3. **Multi-device fan-out**: open `/display/[code]` on 5 browser tabs simultaneously, upload 20 photos rapidly, confirm all 5 displays receive all 20 inserts in correct order without dropped frames. (Stress-tests Durable Object hibernating-WebSocket fan-out.)
4. **DO hibernation**: leave display open 30 min idle, verify no usage on the Workers dashboard, then upload — first photo arrives in <500ms despite the DO waking from hibernation.
5. **Stripe sandbox**: complete a test Checkout for one tier, confirm webhook flips event to `status='live'`, confirm guest upload page works only for paid events.
6. **Retention cron**: set an event's `expires_at` to 1 minute future in staging, trigger the Cron handler manually with `wrangler`, confirm R2 objects + CF Images entries + D1 rows are gone.
7. **Real beta**: run on one real event (likely the namesake wedding?) before charging anyone. The unknowns are all in the room, not in the code.

---

## Open questions (non-blocking — defaults assumed unless overridden)

- **Product name** — defaulting to keeping `appelsin` / `appelsin.io`. Override anytime.
- **GitHub remote** — `git@github.com:Lauritzz77/appelsin-io.git` (fresh repo, separate from the defunct `manyone-cph/appelsin_io`).
- **Single Cloudflare account vs separate prod/dev** — recommend two Workers/Pages environments (preview + production) on one account; D1 has separate databases per env via Wrangler.
- **First market** — defaulting to weddings (clear willingness to pay, one-off pricing fits). Conferences/corporate would shift moderation + branding priorities into MVP.
