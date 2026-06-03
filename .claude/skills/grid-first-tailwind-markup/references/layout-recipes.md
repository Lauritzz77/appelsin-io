# Layout recipes (Grid-first)

Copy-ready patterns for the common layouts. Generic recipes use portable
Tailwind; the **appelsin.io** notes show the container-query form this repo
prefers. For class *spelling* (spacing math, renamed utilities, tokens), follow
the `tailwind-v4` skill.

## Contents

1. [Responsive card / photo collection](#1-responsive-card--photo-collection)
2. [Layered media + overlay](#2-layered-media--overlay)
3. [Hero — copy beside media](#3-hero--copy-beside-media)
4. [Sidebar + content](#4-sidebar--content)
5. [App shell (header / main / footer)](#5-app-shell-header--main--footer)
6. [Centering one thing](#6-centering-one-thing)
7. [Detached UI (when absolute is right)](#7-detached-ui-when-absolute-is-right)

---

## 1. Responsive card / photo collection

Intrinsic — reflows on available width with no breakpoints:

```html
<ul class="grid gap-6 grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
  <li>…</li>
</ul>
```

Use `auto-fill` instead of `auto-fit` to keep empty trailing tracks. Lower the
`18rem` floor for denser tiles (a photo wall might use `minmax(min(100%,8rem),1fr)`).

**appelsin.io:** prefer the intrinsic form above for galleries — it needs no
`.screen-root`. When the count is fixed and should change at a known width, use a
container variant instead: `grid grid-cols-2 @min-[760px]:grid-cols-6`. The
existing `.up-grid` class already does this for the upload grid.

## 2. Layered media + overlay

Stack children in one cell instead of `absolute`:

```html
<figure class="grid rounded-xl overflow-hidden">
  <img class="col-start-1 row-start-1 size-full object-cover" />
  <figcaption class="col-start-1 row-start-1 z-10 self-end
                     bg-linear-to-t from-black/60 to-transparent p-4 text-white">
    Caption
  </figcaption>
</figure>
```

The image sizes the box; the caption rides the same cell. `self-end` / `self-center`
/ `place-self-center` position within the cell. No height, no positioning context.

## 3. Hero — copy beside media

Single column on narrow, two columns when there's room:

```html
<section class="grid gap-12 @min-[920px]:grid-cols-[1.02fr_0.98fr] @min-[920px]:gap-5 items-center">
  <div><!-- headline, copy, CTA --></div>
  <div><!-- media --></div>
</section>
```

**appelsin.io:** this mirrors the `.hero` class in `global.css` (1-col → 2-col at
920px). Reuse `.hero` if the structure matches; the snippet above is for new heroes
that differ. Note `@min-[920px]:` resolves against the `.screen-root` wrapper.

## 4. Sidebar + content

Fixed-ish sidebar, fluid content, collapses to one column:

```html
<div class="grid gap-7 @min-[760px]:grid-cols-[340px_1fr] items-start">
  <aside>…</aside>
  <main class="min-w-0">…</main>
</div>
```

`min-w-0` on the content column prevents long/overflowing children (code, tables,
flex rows) from blowing out the track. This is the `.style-cols` pattern.

## 5. App shell (header / main / footer)

Full-height shell with a sticky header and a scrolling main — rows, not flex hacks:

```html
<div class="grid min-h-dvh grid-rows-[auto_1fr_auto]">
  <header>…</header>
  <main class="min-h-0 overflow-y-auto">…</main>
  <footer>…</footer>
</div>
```

`grid-rows-[auto_1fr_auto]` gives header/footer their content height and lets main
take the rest. `min-h-0` lets the scroll container actually scroll inside the grid.

## 6. Centering one thing

Grid centers in both axes with one utility — no `flex items-center justify-center`:

```html
<div class="grid min-h-dvh place-items-center">
  <div class="card">…</div>
</div>
```

## 7. Detached UI (when absolute is right)

A badge pinned to a corner, deliberately out of flow:

```html
<article class="relative rounded-xl border border-cream-line p-6">
  <span class="absolute -top-2 -right-2 badge">NEW</span>
  …
</article>
```

Use `absolute` here because the badge should *not* push the card's content or
affect siblings. The same applies to tooltips, popovers, dropdown panels, and
decorative shapes. If removing the element should reflow the layout, it's
structural — use flow or Grid (§§1–5) instead.
