---
name: tailwind-v4
description: Use this skill whenever writing, editing, or reviewing ANY Tailwind CSS — generating or modifying class lists in HTML, JSX, TSX, Vue, Astro, or Svelte, building components, or converting Figma/px design specs into Tailwind classes. This project is on Tailwind CSS v4, and models default hard to v3 (the dominant version in training data), silently emitting v3 syntax that compiles fine but renders wrong. Trigger this even when the user does not say "v4" and even for a single component or class tweak — any Tailwind authoring counts.
---

# Tailwind CSS v4

This project uses Tailwind CSS v4. Never emit v3 syntax. The trap with v4 is that almost every v3-ism still compiles — it just renders wrong or silently bypasses the token system — so there is no error to self-correct against. Follow the rules below by default; do not wait to be reminded.

## 1. Config is CSS-first

There is no `tailwind.config.js`. Configuration lives in CSS.

- Entry CSS uses `@import "tailwindcss";` — **not** the three `@tailwind base/components/utilities` directives.
- Theme tokens go in an `@theme { … }` block as CSS variables, not a JS config object:

```css
@import "tailwindcss";
@theme {
  --color-brand: oklch(0.7 0.15 250);
  --font-display: "Inter", sans-serif;
  --spacing: 0.25rem; /* the base unit; see §2 */
}
```

- Plugins: `@plugin "…";`. Custom utilities: `@utility name { … }`. Custom variants: `@custom-variant`.
- Vite projects use the `@tailwindcss/vite` plugin; PostCSS setups use `@tailwindcss/postcss`. Only fall back to a JS config via `@config "./tailwind.config.js";` if legacy config genuinely must be preserved.

## 2. Spacing — do the math, don't bracket

The spacing scale is dynamic: every value is `n × --spacing`, and `--spacing` defaults to `0.25rem` (4px). This kills almost all need for arbitrary bracket values.

Convert any px spec by **dividing by 4**, then use the bare number:

| Design spec | Correct (v4) | Wrong (v3-ism) |
| ----------- | ------------ | -------------- |
| 52px        | `pl-13`      | `pl-[52px]`    |
| 10px        | `pl-2.5`     | `pl-[10px]`    |
| 24px        | `p-6`        | `p-[24px]`     |
| 32px        | `gap-8`      | `gap-[32px]`   |
| 60px        | `mt-15`      | `mt-[60px]`    |

Rules:

- Every bare integer is a valid step in v4 (`pl-13`, `gap-17`, `w-29`, `mt-15`) — these did not exist in v3, so the instinct to bracket them is a v3 habit. Use the integer.
- The `.5` steps are valid utilities too (`pl-2.5`, `mt-3.5`, `gap-1.5`). 10px → `2.5`, not `[10px]`. Never bracket a value that lands on a `.5` step.
- The conversion is the part models skip: a px value must be divided by 4 _before_ it becomes a class. 52 ÷ 4 = 13. Don't transcribe px literally.
- Use arbitrary `[..px]` / `[..rem]` only for genuinely off-grid values that don't resolve to an integer or `.5` step (e.g. `top-[37px]`).
- Bonus: scale-based classes track `--spacing` if it's themed; bracketed values are frozen. Staying on-scale preserves the design tokens.

## 3. Renamed utilities (silent failures)

These were renamed in v4, and the old names often still exist with a different meaning, so wrong output looks plausible. Always use the v4 name.

**Scale names shifted down one step.** To get the SAME visual result you got in v3, drop one name (`md`/`lg`/`xl`/`2xl` are unchanged):

| Was (v3)     | Now (v4) for same look |
| ------------ | ---------------------- |
| `shadow`     | `shadow-sm`            |
| `shadow-sm`  | `shadow-xs`            |
| `rounded`    | `rounded-sm`           |
| `rounded-sm` | `rounded-xs`           |
| `blur`       | `blur-sm`              |
| `blur-sm`    | `blur-xs`              |

**Behavioral renames and removals:**

- `outline-none` → `outline-hidden` (to remove a focus outline). In v4, `outline-none` now means `outline-style: none`, which is different.
- Opacity utilities are removed → use slash syntax: `bg-opacity-50` → `bg-black/50`, `text-opacity-70` → `text-white/70`, same for `border-*/…`, `ring-*/…`, etc.
- `flex-shrink-*` → `shrink-*`; `flex-grow-*` → `grow-*`.
- `bg-gradient-to-r` → `bg-linear-to-r` (and `bg-conic-*`, `bg-radial-*`).
- `ring` is now 1px by default (was 3px) → use `ring-3` for the old look. The default ring color is now `currentColor` (was `blue-500`), so set a color explicitly: `ring-2 ring-blue-500`.
- `border` with no color now defaults to `currentColor` (was `gray-200`) — set the color explicitly where you relied on the old default.

## 4. Shorthands — prefer the compact form

v4 rewards compact, idiomatic utilities. Prefer these over verbose equivalents:

- `size-*` sets width AND height together: `size-10` = `w-10 h-10`. Use it for square/equal boxes, icons, avatars (`size-full`, `size-px` also valid). Don't write `w-6 h-6`.
- **CSS-variable parentheses shorthand** (v4-specific): reference a custom property with parens, not `var()` in brackets. `bg-(--brand)`, `text-(--fg)`, `w-(--sidebar)` — **not** `bg-[var(--brand)]`.
- `inset-*` collapses position sides: `inset-0` over `top-0 right-0 bottom-0 left-0`; `inset-x-4` / `inset-y-2` for axes.
- Use axis shorthands generally: `px-*`/`py-*` over `pl-*`+`pr-*`, `mx-auto` for centering, `gap-*` over `gap-x-*`+`gap-y-*` when equal.

## 5. Project tokens (appelsin.io)

This repo's tokens live in [`src/styles/global.css`](src/styles/global.css) inside `@theme`. Using a token name gives you the matching utility for free — prefer the token over a raw hex value when one exists (the codebase is mid-migration from inline `style=""` → utilities; keep going that direction):

- `--color-navy` → `bg-navy` / `text-navy` / `border-navy`; same for `--color-accent`, `--color-ink`, `--color-tx`, `--color-s1`, `--color-live`, …
- `--radius-xl` → `rounded-xl`; `--shadow-app` → `shadow-app`; `--font-hand` → `font-hand`
- Slash opacity works on token colors too: `bg-navy/80`, `text-tx/60`.
- Legacy `var(--navy)`, `var(--r-md)`, `var(--sh-app)` aliases still exist in `:root` for older hand-written CSS — fine to keep, but new utility work should use the token names above.

## 6. Quick self-check before emitting Tailwind

- Did I bracket a value that divides cleanly by 4 (or hits a `.5` step)? → use the bare scale step.
- Did I write `shadow-sm`/`rounded-sm`/`blur-sm` meaning the v3 size? → shift to `-xs`.
- Did I write `*-opacity-*`, `flex-shrink/grow`, `bg-gradient`, or `outline-none` (for hiding)? → use the v4 form.
- Did I write `w-N h-N` with equal N, or `[var(--x)]`? → use `size-N` and `(--x)`.
