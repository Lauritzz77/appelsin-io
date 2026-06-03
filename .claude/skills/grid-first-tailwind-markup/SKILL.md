---
name: grid-first-tailwind-markup
description: Apply a Grid-first layout approach when creating, editing, or reviewing markup in HTML, Astro, JSX, TSX, Vue, or Svelte. Use this whenever you are deciding how to structure a page section, card collection, hero, form, dashboard, nav, or any layered/overlapping composition — semantic HTML and normal flow first, CSS Grid for two-dimensional structure and responsive collections, Flexbox only for small one-dimensional rows (icon + label, chips, toolbars), and absolute positioning only for genuinely detached UI (tooltips, popovers, dropdowns, floating badges, decorative layers). Trigger it even for a single component or a small class tweak, and even when the user never says "grid", "layout", or "responsive" — any time you reach for container, positioning, or breakpoint classes. Pairs with the tailwind-v4 skill: that one owns v4 syntax, this one owns layout structure.
---

# Grid-first layout for Tailwind markup

Layout is a structural decision you make _before_ you start typing classes, and the primitive you pick determines how the markup ages. Reaching for Flexbox + a chain of breakpoints, or for `absolute` by default, tends to produce deep DOMs, brittle z-index stacks, and layouts that only work at the three widths you happened to test. Starting from normal flow and using Grid for structure keeps the DOM shallow, lets the browser do the responsive math, and keeps visual order matched to reading order.

The rule of thumb is **pick the lowest tier that does the job** — drop to a more powerful (and more fragile) primitive only when the one above genuinely can't express the layout.

## 1. Layout hierarchy

1. **Semantic HTML + normal flow.** Headings, paragraphs, lists, `<section>`, `<article>`, `<nav>`, `<details>` already stack and wrap correctly with zero layout CSS. Don't add a grid or flex wrapper around something that's just a vertical stack of prose — `gap` on a single-column grid is the most you need.
2. **CSS Grid for two-dimensional structure.** Page shells, section layouts, responsive card/photo collections, dashboards, forms, heroes (media beside copy), pricing tables, and layered compositions. Grid is the default whenever there are _rows and columns_, or whenever children should share a cell.
3. **Flexbox for one-dimensional internals.** A single row (or column) of items that align together: a button's icon + label, a chip, a nav row, a toolbar, a pill. If you find yourself writing `flex-wrap` + fixed item widths to fake a grid, that's the signal to switch to Grid.
4. **Absolute positioning only for detached UI.** Things that are deliberately removed from flow and shouldn't affect their siblings' size or position: tooltips, popovers, dropdown menus, drag previews, floating badges, portals, decorative blobs. If the element is part of the document's structure, it does not belong in `absolute`.

## 2. Reach for an intrinsic Grid before a breakpoint chain

A responsive collection should respond to the **space available**, not to arbitrary viewport widths you hard-coded. `auto-fit` + `minmax()` lets the grid decide how many columns fit, so one declaration covers phone through ultrawide with no breakpoints at all:

```html
<div
  class="grid gap-6 grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))]"
>
  <!-- cards -->
</div>
```

The `min(100%, 18rem)` floor is what keeps a single card from overflowing when the container is narrower than the track — it caps the track at the container width. Use `auto-fill` instead of `auto-fit` when you want empty trailing tracks to hold their space rather than collapse.

Reach for explicit breakpoint columns only when the layout **meaningfully changes** at a specific width (e.g. a sidebar appears, or a 2-up becomes a 3-up for editorial reasons) — not as the default way to get more columns:

```html
<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
  <!-- columns that are deliberately 1-then-3, not "as many as fit" -->
</div>
```

## 3. Prefer Grid overlap over absolute positioning

When you need to stack elements on top of each other — text over an image, a badge over a thumbnail, a gradient scrim over media — put both children in the **same grid cell** instead of pulling one out of flow with `absolute`:

```html
<div class="grid">
  <img class="col-start-1 row-start-1 size-full object-cover" />
  <div class="col-start-1 row-start-1 z-10 place-self-center">
    Overlay content
  </div>
</div>
```

Why this beats `absolute`: both children stay in flow, so the **content sizes the box** — you don't have to give the container a manual height or worry about the overlay escaping it. There's no positioning context to manage and no z-index arms race. `place-self-*` / `place-items-*` handle alignment within the shared cell.

## 4. Flexbox is for one dimension

Flexbox shines for a single row or column whose items align and distribute together. Keep it to genuinely 1-D internals:

```html
<button class="inline-flex items-center gap-2">
  <svg>…</svg>
  Save changes
</button>
```

`items-center` + `gap-2` is the canonical icon-and-label row. The moment a layout has both rows and columns, or you're reaching for `flex-wrap` plus fixed widths to simulate a grid, hand it to Grid (§2) instead.

## 5. Absolute positioning is for detached layers

`absolute` is the right tool when an element is _supposed_ to float free of the layout — a badge pinned to a card corner, a popover, a decorative shape:

```html
<article class="relative rounded-xl …">
  <span class="absolute -top-2 -right-2 …">NEW</span>
  …
</article>
```

Anchor it with a `relative` parent, and reserve it for things whose whole purpose is to _not_ take up space or push siblings. If removing the element would (or should) reflow the layout, it's structural — use flow or Grid instead.

## 6. Quick self-check before emitting layout markup

- Is this just a vertical stack of prose? → normal flow + `gap`, no grid/flex wrapper.
- Did I reach for Flexbox where there are really rows _and_ columns? → use Grid.
- Did I write a breakpoint chain to get "more columns"? → try `grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))]` first.
- Did I use `absolute` for something that's part of the layout? → use Grid overlap or flow instead; keep `absolute` for detached UI.
- Does visual order still match DOM reading order, and do focus outlines have room (no clipping)?

When the compact rules above aren't enough, go deeper:

- [`references/layout-recipes.md`](references/layout-recipes.md) — copy-ready recipes: responsive collections, layered media, app shells, centering.
- [`references/css-grid-first-tailwind-guide.html`](references/css-grid-first-tailwind-guide.html) — the full visual rulebook: decision rules and annotated _prefer / avoid_ examples.
