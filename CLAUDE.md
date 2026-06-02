# CLAUDE.md

Guidance for Claude Code when working in this repo (appelsin.io — Astro + Vue marketing site & event app).

## Working style

- **Don't visually test by default.** Make the code change and stop. Do **not** start the dev server, drive the browser (chrome-devtools / preview tools), or take screenshots unless I explicitly ask (e.g. "test it", "verify in the browser", "show me"). Trust the edit; describe what changed.
- Match the surrounding code's style, naming, and comment density.

## Styling — Tailwind CSS v4

This project uses **Tailwind CSS v4** (`tailwindcss` + `@tailwindcss/vite`). Key implications:

- **CSS-first config — there is no `tailwind.config.js`.** All config lives in [`src/styles/global.css`](src/styles/global.css) via `@import "tailwindcss";` and an `@theme { … }` block.
- **Design tokens in `@theme` generate utilities.** Adding/using a token gives you the matching utility automatically:
  - `--color-navy` → `bg-navy` / `text-navy` / `border-navy`
  - `--color-accent`, `--color-ink`, `--color-tx`, `--color-s1`… → same pattern
  - `--radius-xl` → `rounded-xl`; `--shadow-app` → `shadow-app`; `--font-hand` → `font-hand`
- **Prefer Tailwind utilities over inline `style=""`.** The codebase is mid-migration from inline styles → utilities; keep going that direction.
- **Use existing tokens instead of raw hex** when a token exists. Arbitrary values are fine where needed (e.g. `text-[24px]`, `drop-shadow-[0_2px_6px_rgba(0,0,0,0.18)]`, `bg-[radial-gradient(...)]`).
- Legacy `var(--navy)`, `var(--r-md)`, `var(--sh-app)` aliases still exist in `:root` for older CSS — fine to keep, but new work should favor utilities/tokens.

## Project layout

- **Astro** pages in `src/pages`, with **Danish as default and English mirrored under `src/pages/en/`** — when changing a page, update both locales.
- Reusable components in `src/components` (`brand/`, `marketing/`); interactive **Vue islands** (e.g. `PhotoWall.vue`, `GuestUpload`) for client-side bits.
- Deploys to **Cloudflare** (`wrangler`).

## Commands (run only when asked to verify/build)

- `npm run dev` — dev server (Astro, port 4321)
- `npm run build` — production build
- `npm run preview` — preview the build
