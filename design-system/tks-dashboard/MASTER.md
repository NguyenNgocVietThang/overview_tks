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
> replacing the palette outright. Using Be Vietnam Pro for display headings and IBM Plex Mono
> for numeric/tabular data on top of the recommended base is a deliberate,
> documented deviation — not an oversight.

---

## Global Rules

### Color Palette

#### Dark Mode (Default)
| Role | Hex | CSS Variable | Source |
|------|-----|--------------|--------|
| Primary Gradient | `#3B82F6` → `#2563EB` | `--primary-gradient` | Modern Sapphire/Indigo |
| On Primary | `#FFFFFF` | `--primary-text` | High contrast |
| Panel / Card | `#111827` | `--panel` | Slate 900 |
| Panel 2 (Input/Sidebar) | `#1E293B` | `--panel-2` | Slate 800 |
| Panel 3 (Active/Hover) | `#334155` | `--panel-3` | Slate 700 |
| Background | `#090D16` | `--bg` | Deep Obsidian |
| Text / Foreground | `#F8FAFC` | `--text` | Crisp Slate 50 |
| Text Secondary | `#CBD5E1` | `--text-secondary` | Slate 300 |
| Muted | `#94A3B8` | `--muted` | Slate 400 (4.5:1+ WCAG AA) |
| Border | `#26334D` | `--border` | Refined border |
| Accent Amber | `#F59E0B` | `--amber` | Modern Amber |
| Accent Green (Positive) | `#10B981` | `--green` | Modern Emerald |
| Accent Red (Destructive) | `#EF4444` | `--red` | Modern Coral Red |
| Accent Blue (Ring/Focus) | `#3B82F6` | `--blue` | Sapphire Focus Ring |

#### Light Mode
| Role | Hex | CSS Variable | Source |
|------|-----|--------------|--------|
| Primary Gradient | `#2563EB` → `#1D4ED8` | `--primary-gradient` | Clean Modern Blue |
| On Primary | `#FFFFFF` | `--primary-text` | High contrast |
| Panel / Card | `#FFFFFF` | `--panel` | Pure White |
| Panel 2 | `#F1F5F9` | `--panel-2` | Slate 100 |
| Panel 3 | `#E2E8F0` | `--panel-3` | Slate 200 |
| Background | `#F8FAFC` | `--bg` | Slate 50 Canvas |
| Text / Foreground | `#0F172A` | `--text` | Slate 900 |
| Text Secondary | `#334155` | `--text-secondary` | Slate 700 |
| Muted | `#64748B` | `--muted` | Slate 500 (4.5:1+ WCAG AA) |
| Border | `#E2E8F0` | `--border` | Slate 200 |
| Accent Amber | `#D97706` | `--amber` | Warm Amber |
| Accent Green (Positive) | `#059669` | `--green` | Deep Emerald |
| Accent Red (Destructive) | `#DC2626` | `--red` | Deep Red |
| Accent Blue (Ring/Focus) | `#2563EB` | `--blue` | Vibrant Blue Focus Ring |

### Typography

- **Heading / Display Font:** Be Vietnam Pro — a modern brand accent with strong Vietnamese
  diacritic support, used for headings and primary actions.
- **Body Font:** Inter — matches `typography.csv` row 5 "Minimal Swiss"
  (*"minimal, clean, swiss, functional, neutral, professional"* — Best For: *Dashboards, admin
  panels, documentation, enterprise apps, design systems*)
- **Numeric / Tabular Font:** IBM Plex Mono — for the clock, quantities, prices, percentages,
  and identifiers; use tabular figures so dense columns remain easy to compare.
- **Mood:** Professional + Clean hierarchy (from `ui-reasoning.csv` row 102)
- **Google Fonts:** `https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@600;700&family=IBM+Plex+Mono:wght@500;600;700&family=Inter:wght@400;500;600&display=swap`
- **Font tokens:** `--font-display: 'Be Vietnam Pro', sans-serif`; `--font-body: 'Inter', sans-serif`; `--font-data: 'IBM Plex Mono', monospace`.
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
  font-family: var(--font-display);
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
- Numeric columns: `font-family: var(--font-data)`, `font-variant-numeric: tabular-nums`, right-aligned.
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

- [Do] Use for card/row/button hover and the existing refresh-button spin.
- [Don't] Don't use `back.out()`/overshoot easing on dense data tables — it reads as sloppy on informational UI (motion.csv row 9 note).
- [Note] `prefers-reduced-motion` must be respected — fully supported across all 3D and CSS transition modules via `@media (prefers-reduced-motion: reduce)`.

---

## 3D Progressive Enhancement Layer (Cập nhật 18/08/2026)

Hệ thống bổ sung một lớp **Progressive Enhancement 3D** tùy chọn trên cả 7 trang giao diện, hoạt động độc lập trên nền tảng Flat Design cốt lõi:

1. **Hạt nền Three.js (three-bg.js):** 300 hạt chuyển động mượt mà, tự đổi màu theo theme dark/light, canvas mang `aria-hidden="true"`, z-index -1.
2. **Card Tilt 3D (three-interactions.js):** Tính toán góc xoay nhẹ theo vị trí con trỏ chuột (`transform: rotateX(...) rotateY(...)`) tạo cảm giác chiều sâu vật lý.
3. **Tactile Buttons & Navigation:** Nút bấm có hiệu ứng lún 3D và ripple; menu item nổi lên khi hover.
4. **3D Loading Cube (three-loading.js):** Khối lập phương 3D xoay không gian khi tải dữ liệu (`role="status"`).
5. **Biểu đồ 3D (three-charts.js):** Biểu đồ cột 3D Three.js cho doanh thu trên trang tổng quan.
6. **Thích ứng hiệu năng & Khả năng tiếp cận:**
   - Tự động hạ chất lượng hạt/tần số render khi FPS giảm (`three-performance.js`).
   - Tự động thu hồi bộ nhớ WebGL và giải phóng context khi rời trang (`three-memory.js`).
   - Tự động tạm dừng hoạt họa khi tab bị ẩn (`three-visibility.js`).
   - Vô hiệu hóa toàn bộ hiệu ứng 3D khi người dùng bật `prefers-reduced-motion: reduce`.
   - Xem chi tiết tại [3D Design Plan](../../3D%20Design.md), [Báo cáo tối ưu hiệu năng](../../docs/performance-optimization-report.md) và [Hướng dẫn Rollback](../../ROLLBACK.md).

---

## Anti-Patterns (Do NOT Use)

- **Emojis as icons** — Luôn sử dụng SVG icons (Heroicons, Lucide, Simple Icons), không dùng emoji thay icon.
- **Missing cursor:pointer** — Mọi phần tử click được phải có `cursor:pointer`.
- **Layout-shifting hovers** — Tránh scale transforms làm vỡ layout bảng/lưới; sử dụng color/translateY/CSS 3D perspective.
- **Low contrast text** — Đảm bảo độ tương phản tối thiểu 4.5:1 (WCAG AA).
- **Invisible focus states** — Luôn giữ `:focus-visible` với outline rõ ràng cho điều hướng bàn phím.
- **Hard dependency on 3D** — Tuyệt đối không để logic nghiệp vụ phụ thuộc vào Three.js hoặc WebGL; mọi script 3D phải tự kiểm tra tồn tại và graceful degradation.

---

## Pre-Delivery Checklist

Trước khi hoàn thành và bàn giao UI, kiểm tra:

- [x] Không sử dụng emoji làm icon (sử dụng inline SVG chuẩn)
- [x] Tất cả icon thuộc bộ icon thống nhất (Heroicons/Lucide phong cách)
- [x] `cursor: pointer` trên mọi phần tử tương tác (chips lọc, hàng bảng drill-down, icon actions)
- [x] Hover states mượt mà (150–300ms), không giật lag
- [x] Độ tương phản chữ Dark Mode ≥ 4.5:1 (WCAG AA)
- [x] Focus states hiển thị rõ ràng cho keyboard navigation (`:focus-visible`)
- [x] `prefers-reduced-motion: reduce` được tuân thủ nghiêm ngặt
- [x] Responsive layout kiểm thử trên 375px, 768px, 1024px, 1440px
- [x] Không có nội dung bị che khuất sau fixed header / floating elements
- [x] Không tràn ngang (horizontal scroll) ngoài ý muốn trên thiết bị di động
- [x] Touch targets ≥44×44px cho các nút bấm trên giao diện Mobile
- [x] Lớp 3D có thể tắt hoàn toàn mà không gây bất kỳ lỗi console hoặc vỡ layout nào (theo [ROLLBACK.md](../../ROLLBACK.md))
