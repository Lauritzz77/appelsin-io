# appelsin

Live event photo sharing — guests at a wedding or party scan a QR code, upload
photos from their phone, and the photos appear on the big screen in real time.

A modern rebuild of the 2019 `appelsin.io` idea for 2026.

## Stack

- **Astro 6** (server output) + **Vue 3** islands for the interactive bits
  (guest upload, live photo wall)
- **Cloudflare Pages + Workers** — single edge deploy
- **Cloudflare D1** (SQLite) + **Drizzle ORM**
- **Cloudflare R2** (originals) + **Cloudflare Images** (variants / direct
  creator uploads from guest phones)
- **Cloudflare Durable Objects** with hibernating WebSockets — the realtime
  photo wall fan-out
- **Better Auth** on D1 with magic links via MailChannels
- **Stripe** for one-off event passes + planner subscriptions
- **Tailwind CSS v4**

## Develop

```bash
pnpm install
pnpm dev          # local Astro dev server (http://localhost:4321)
pnpm wrangler dev # local edge runtime (D1, R2, KV, DO emulated)
```

## Provision Cloudflare resources (first time only)

```bash
wrangler d1 create appelsin-io-db
wrangler r2 bucket create appelsin-io-photos
wrangler kv namespace create SHORT_CODE_CACHE
```

Paste the returned IDs into `wrangler.jsonc` (`d1_databases[0].database_id`,
`kv_namespaces[0].id`). The R2 bucket is referenced by name.

## Deploy

```bash
pnpm build
pnpm wrangler deploy
```

## Status

Day-1 scaffold. The full MVP plan is in
`/Users/laurasmussen/.claude/plans/i-wanna-take-this-sprightly-pond.md`.
