# Design System Master File

> **LOGIC:** When building a specific page/section, first check `design-system/tks-dashboard/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** TKS Dashboard (TOKOSI · Live Dashboard)
**Generated:** 2026-07-29 (skill: ui-ux-pro-max)
**Category:** Inventory & Stock Management (matched keywords: inventory, stock, warehouse, product, barcode, supply, sku, management)
**Design Dials:** Variance 6/10 (Balanced / Modern) | Motion 5/10 (Standard) | Density 8/10 (Dense / Dashboard)

> **Note on method:** `search.py` requires Python, which is not installed on this machine
> (only the Microsoft Store stub alias resolves). This file was produced by manually
> applying the same lookup the script would run — `product` → `ui-reasoning` → `style` /
> `color` / `typography` / `motion` — directly against the skill's CSVs
> (`C:\Users\Admin\.claude\skills\ui-ux-pro-max\data\`). If Python becomes available later,
> re-run the real script with `--force` to regenerate and diff against this file.

> **Note on scope:** This is an internal operations dashboard, not a marketing site, so the
> `landing` domain (hero/CTA/section-order patterns) does not apply. The **Dashboard Style**
> field from `products.csv` row 102 is used instead: **Real-Time Monitoring + Data-Dense**.

> **Note on convergence:** The production UI (`server/public/index.html`) and local preview
> (`dev/index.html`) already
> uses a dark navy background with green/amber/red status colors — which is almost exactly
> what this category recommends (`Functional neutral + status traffic-light (green/amber/red)
> + scanner accent`). The amber (`#F0A63A`) already in use **is** the "scanner accent" the
> data calls for. So this system mostly **formalizes and completes** the existing tokens
> (adds a real spacing scale, motion spec, component specs, a11y checklist) rather than
> replacing the palette outright. Keeping the existing brand fonts (Sora for display headings,
> JetBrains Mono for numeric/tabular data) on top of the recommended base is a deliberate,
> documented deviation — not an oversight.

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable | Source |
|------|-----|--------------|--------|
| Primary / Brand Accent (scanner accent) | `#F0A63A` | `--color-primary` | existing brand color = data's "scanner accent" |
| On Primary | `#1B1206` | `--color-on-primary` | existing |
| Secondary (panel) | `#131C30` | `--color-secondary` | existing |
| Secondary 2 (panel-alt) | `#0F1728` | `--color-secondary-2` | existing |
| Accent / Positive (in-stock) | `#3DD68C` | `--color-accent` | existing = traffic-light green |
| Background | `#0B1120` | `--color-background` | existing |
| Foreground | `#ECF1F8` | `--color-foreground` | existing |
| Muted | `#7E8CA8` | `--color-muted` | existing |
| Border | `#22304A` | `--color-border` | existing |
| Destructive / Out-of-stock | `#F1616A` | `--color-destructive` | existing = traffic-light red |
| Ring / Info-Focus | `#5B9BF0` | `--color-ring` | existing, doubles as visible focus-ring color |

**Color Notes:** Matches `colors.csv` row 6 "Financial Dashboard" archetype (dark bg + green
positive / red negative indicators) blended with the category's explicit "traffic-light
(green/amber/red) + scanner accent" mood. **Contrast check required:** verify
`--color-muted` (#7E8CA8) on `--color-background` (#0B1120) hits **4.5:1** for body text —
if any 12–13px muted labels fall short, bump to `#8FA0C2` or increase size to ≥14px rather
than leaving it under threshold (Accessibility is Priority 1 in the skill's rule table).

### Typography

- **Heading / Display Font:** Sora (existing — kept as a deliberate brand accent for `h1`/big
  numbers, layered on top of the recommended base rather than replacing it)
- **Body Font:** Inter — matches `typography.csv` row 5 "Minimal Swiss"
  (*"minimal, clean, swiss, functional, neutral, professional"* — Best For: *Dashboards, admin
  panels, documentation, enterprise apps, design systems*)
- **Numeric / Tabular Font:** JetBrains Mono (existing — for the clock, quantities, prices;
  matches `typography.csv` row 9 "Developer Mono" mood: *code, developer, technical, precise*)
- **Mood:** Professional + Clean hierarchy (from `ui-reasoning.csv` row 102)
- **Google Fonts:** `https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap` (already imported — no change needed)
- **Base size:** 16px minimum body text; never drop below 12px even for dense table cells (Priority 6 check).

### Spacing Variables

*Density: 8/10 — Dense / Dashboard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `2px` / `0.125rem` | Tight gaps (icon-to-label) |
| `--space-sm` | `4px` / `0.25rem` | Icon gaps, inline spacing |
| `--space-md` | `8px` / `0.5rem` | Standard padding (table cells, chips) |
| `--space-lg` | `12px` / `0.75rem` | Card padding, form field gaps |
| `--space-xl` | `16px` / `1rem` | Section internal padding |
| `--space-2xl` | `24px` / `1.5rem` | Section margins, header padding |
| `--space-3xl` | `32px` / `2rem` | Page-level top/bottom padding |

*Replaces today's ad-hoc `padding:16px 24px 24px`-style literals with a consistent scale —
apply the token closest to each existing value rather than inventing new spacing.*

### Shadow Depths

Style = **Flat Design** (`styles.csv` row 12: *"no shadows/gradients, simple hover
(color/opacity shift)"*) → **do not add `box-shadow` for elevation.** Depth is communicated
with `--color-border` (1px) and background-color steps (`--color-background` →
`--color-secondary` → `--color-secondary-2`) instead. The one exception already in the UI —
`.brand-mark` logo lift (`0 2px 8px rgba(0,0,0,0.3)`) — is acceptable as a single branded
exception, not a pattern to extend to cards/tables/buttons.

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-none` | `none` | Default for cards, tables, buttons, panels |
| `--shadow-brand` | `0 2px 8px rgba(0,0,0,0.3)` | Logo mark only — do not reuse elsewhere |

---

## Component Specs

### Buttons

```css
.btn-primary {
  background: var(--color-primary);
  color: var(--color-on-primary);
  padding: var(--space-lg) var(--space-xl);
  border: none;
  border-radius: 8px;
  font-family: 'Sora', sans-serif;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 150ms ease, opacity 150ms ease;
}
.btn-primary:hover { opacity: 0.88; }
.btn-primary:focus-visible {
  outline: 2px solid var(--color-ring);
  outline-offset: 2px;
}
.btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }

.btn-secondary {
  background: var(--color-secondary-2);
  color: var(--color-foreground);
  border: 1px solid var(--color-border);
  padding: var(--space-lg) var(--space-xl);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease;
}
.btn-secondary:hover { border-color: var(--color-muted); }
```

### Cards / Panels

```css
.card {
  background: var(--color-secondary);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: var(--space-xl);
  box-shadow: var(--shadow-none);
  transition: border-color 150ms ease;
}
.card:hover { border-color: var(--color-muted); } /* color shift, not elevation */
```

### Status Badges (traffic-light — the core inventory pattern)

```css
.badge-in-stock    { color: var(--color-accent);      background: color-mix(in srgb, var(--color-accent) 15%, transparent); }
.badge-low-stock   { color: var(--color-primary);      background: color-mix(in srgb, var(--color-primary) 15%, transparent); }
.badge-out-of-stock{ color: var(--color-destructive);   background: color-mix(in srgb, var(--color-destructive) 15%, transparent); }
```

### Inputs / Filters

```css
.input, select, .filter-field {
  padding: var(--space-md) var(--space-lg);
  background: var(--color-secondary-2);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-foreground);
  font-size: 16px; /* never smaller — prevents mobile Safari zoom-on-focus */
  transition: border-color 150ms ease;
}
.input:focus-visible {
  border-color: var(--color-ring);
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-ring) 25%, transparent);
}
```

### Tables (primary data surface — treat with extra care)

- Sticky header row on scroll.
- Row hover = background-color shift only (`var(--color-secondary-2)`), never a shadow/lift.
- Numeric columns: `font-family: 'JetBrains Mono'`, right-aligned.
- Minimum 44×44px hit target on any row-level action button/icon (Priority 2 — Touch & Interaction).

---

## Style Guidelines

**Style:** Flat Design + Minimalism (`ui-reasoning.csv` row 102 Style Priority)

**Keywords:** 2D, minimalist, bold colors, no shadows, clean lines, simple shapes,
typography-focused, modern, icon-heavy

**Best For:** Web apps, dashboards, SaaS, corporate tools — matches this project directly.

**Key Effects:** Color-shift hover + fast 150ms transitions + no shadows (row 102). Icons must
be SVG (Heroicons/Lucide-style), never emoji.

### Dashboard Layout Pattern

**Pattern:** Real-Time Monitoring + Data-Dense (`products.csv` row 102, Dashboard Style column)

- Sidebar + content layout (already in place) — keep the persistent left nav.
- Lead with the most time-sensitive data (out-of-stock alerts, low-stock banner) above the fold.
- Charts and tables get equal visual weight; neither should force horizontal scroll on desktop.
- Refresh state (spinner, last-updated clock) stays visible at all times — already implemented, keep it.

---

## Motion

**Hover Micro-interaction** (Standard tier) — Trigger: hover | Duration: 200-300ms | Easing: `power2.out`

Adapted from `motion.csv` row 2, with the `boxShadow` property dropped (Flat Design forbids
shadow-based elevation — use color/translateY only):

```js
gsap.to(el, { y: -2, backgroundColor: 'var(--color-secondary-2)', duration: 0.2, ease: 'power2.out' });
```

Pair every hover tween with a matching mouseleave/pointerleave reverse tween so state can't
get stuck if the pointer leaves quickly. For plain CSS (no GSAP dependency needed for
hover/focus states — reserve GSAP for the refresh spinner and any future chart transitions):

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- ✅ Use for card/row/button hover and the existing refresh-button spin.
- ❌ Don't use `back.out()`/overshoot easing on dense data tables — it reads as sloppy on informational UI (motion.csv row 9 note).
- ⚡ `prefers-reduced-motion` must be respected — currently **not** implemented anywhere in `dev/index.html` / `Dashboard.html`; add it.

---

## Anti-Patterns (Do NOT Use)

- ❌ Excessive decoration
- ❌ Complex shadows
- ❌ 3D effects
- ❌ Complex 3D / premium-luxury ornamentation / immersive effects (Flat Design "Do Not Use For")

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have `cursor:pointer`
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout; use color/translateY instead
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio (check `--color-muted` usages)
- ❌ **Instant state changes** — Always use transitions (150–300ms)
- ❌ **Invisible focus states** — Focus states must be visible for keyboard nav (`:focus-visible`, not `outline: none`)

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from a consistent icon set (Heroicons/Lucide-style, currently inline SVG — keep that)
- [ ] `cursor-pointer` on all clickable elements (chart legend items, table rows with drill-down, filter chips)
- [ ] Hover states with smooth transitions (150–300ms), color/translateY only, no box-shadow elevation
- [ ] Dark-mode text contrast 4.5:1 minimum, especially `--color-muted` on `--color-background`
- [ ] Focus states visible for keyboard navigation (`:focus-visible` outline using `--color-ring`)
- [ ] `prefers-reduced-motion` respected (not yet present — add)
- [ ] Responsive: 375px, 768px, 1024px, 1440px — verify the sidebar collapses correctly below 768px
- [ ] No content hidden behind the fixed header
- [ ] No horizontal scroll on mobile (tables need a scroll container, not the page)
- [ ] Touch targets ≥44×44px for icon-only buttons (refresh button, table row actions)
