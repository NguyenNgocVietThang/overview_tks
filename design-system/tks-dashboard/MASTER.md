# Design System Master File — TKS Dashboard

> **LOGIC:** Khi xây dựng một trang hoặc component cụ thể, luôn kiểm tra `design-system/tks-dashboard/pages/[page-name].md` (nếu có).
> Nếu file trang tồn tại, các quy tắc trong đó sẽ **ghi đè (override)** file Master này.
> Nếu không, bắt buộc tuân thủ nghiêm ngặt toàn bộ nguyên tắc và tokens trong file Master bên dưới.

---

## 1. Metadata & Design DNA

- **Project:** TKS Dashboard (TOKOSI · Live Operations & Inventory Dashboard)
- **Category:** Inventory & Stock Management (Keywords: inventory, stock, warehouse, product, barcode, supply, sku, real-time analytics)
- **Dashboard Style:** Real-Time Monitoring + Data-Dense + Premium Operations
- **Design Dials:** 
  - **Variance:** `6/10` (Modern, Balanced, Curated)
  - **Motion:** `5/10` (Standard, Tactile Micro-Interactions, 150–300ms)
  - **Density:** `8/10` (Dense / Real-time Data Grid)
- **Visual Aesthetic:** **Rich Aesthetics & Visual Excellence** — Tận dụng tối đa bảng màu HSL/HEX tinh lọc, Dark Mode chiều sâu Obsidian, hiệu ứng Glassmorphism & Subtle Gradients, chuyển động Micro-animations sống động và lớp nâng cao 3D Three.js.

---

## 2. Nguyên Tắc Thiết Kế Cốt Lõi (Core Design Principles)

### 2.1 Rich Aesthetics & Visual Excellence (Thẩm mỹ Cao cấp & Đẳng cấp)
- **Ấn tượng thị giác mạnh mẽ (WOW factor):** Giao diện phải mang lại cảm giác hiện đại, chỉn chu ngay từ cái nhìn đầu tiên với chiều sâu không gian, gradient tinh tế và đường viền phát sáng nhẹ (ambient glow/subtle border).
- **Tránh màu sắc thô, đơn điệu (No Generic Colors):** Tuyệt đối không dùng các màu cơ bản (plain red, plain blue, plain green). Bắt buộc sử dụng bảng màu được phối hợp hài hòa (Curated Palettes: Deep Sapphire, Emerald Green, Warm Amber, Slate Obsidian).
- **Typography hiện đại:** Sử dụng bộ font thương hiệu chuẩn quốc tế kết hợp hỗ trợ tiếng Việt tối đa (`Be Vietnam Pro` cho tiêu đề, `Inter` cho nội dung, `IBM Plex Mono` cho số liệu tài chính/tồn kho).
- **Không sử dụng hình ảnh/icon tạm bợ (No Placeholders):** Tuyệt đối không dùng emoji làm icon hoặc placeholder sơ sài. Mọi icon phải là SVG chuẩn (Heroicons / Lucide phong cách đồng nhất).

### 2.2 Dynamic & Alive (Giao diện Sống động & Phản hồi Tức thì)
- **Tương tác có chiều sâu (Tactile Micro-interactions):** Mọi nút bấm, thẻ thông tin (card), và hàng trong bảng phải có trạng thái hover, focus, active rõ ràng (lún nút nhẹ, đổi màu nền mượt 150–200ms, viền phát sáng).
- **Phản hồi thời gian thực (Real-Time Feedback):** Trạng thái đồng bộ dữ liệu, spinner tải trang, đồng hồ cập nhật (`last updated`) luôn hiển thị trực quan ở vị trí cố định.

### 2.3 Premium Quality & Data Density (Chất lượng Hoàn thiện & Mật độ Dữ liệu)
- **Tối ưu mật độ thông tin:** Bố cục dạng Dashboard Dense (8/10), thông tin phân cấp mạch lạc, các chỉ số KPI quan trọng nhất (tồn kho nguy cấp, đơn hàng cần xuất) luôn nằm ở vị trí dễ quan sát nhất (above the fold).
- **Không vỡ bố cục khi co giãn:** Layout responsive mượt mà từ Mobile (375px), Tablet (768px), Laptop (1024px) đến Wide Desktop (1440px+).

---

## 3. Technology Stack & Implementation Standards

1. **Cấu trúc & Ngôn ngữ Cốt lõi:**
   - **HTML5:** Cấu trúc ngữ nghĩa chuẩn (Semantic HTML: `<header>`, `<nav>`, `<main>`, `<aside>`, `<section>`, `<article>`, `<footer>`).
   - **CSS:** **Vanilla CSS** với hệ thống CSS Variables (`:root`), Flexbox/Grid, Native Dialog/Popover, `color-mix()`, `:has()`, `:focus-visible`. *Tránh sử dụng TailwindCSS trừ khi có yêu cầu đặc biệt từ người dùng.*
   - **JavaScript:** Vanilla JS ES6+ / Three.js cho hiệu ứng 3D, module hóa rõ ràng, xử lý tác vụ bất đồng bộ tối ưu (`scheduler.yield`, `requestAnimationFrame`, `debounce`/`throttle`).
2. **Hiệu năng & Khả năng tiếp cận (Performance & a11y):**
   - Tuân thủ chuẩn WCAG AA: Độ tương phản văn bản chữ ≥ 4.5:1; viền điều khiển UI ≥ 3:1.
   - Hỗ trợ đầy đủ `@media (prefers-reduced-motion: reduce)` để tắt hoàn toàn hoạt họa phức tạp cho người dùng nhạy cảm chuyển động.
   - Các phần tử tương tác phải có `id` định danh duy nhất phục vụ kiểm thử tự động và điều hướng bàn phím.

---

## 4. Global Design Tokens (Hệ Thống Token Toàn Cục)

### 4.1 Color System (Hệ Màu Chuẩn)

#### Dark Mode (Theme Mặc Định — Obsidian Slate)
| Role | Hex / Value | CSS Variable | Mục đích sử dụng |
|------|-------------|--------------|------------------|
| Background | `#090D16` | `--bg` | Nền canvas toàn trang (Deep Obsidian) |
| Panel / Card | `#111827` | `--panel` | Nền card chính, container, table container |
| Panel 2 | `#1E293B` | `--panel-2` | Nền input, sidebar, dropdown menu, table hover |
| Panel 3 | `#334155` | `--panel-3` | Trạng thái active, chip hover, divider đậm |
| Border | `#26334D` | `--border` | Đường viền chính cho card, table, input |
| Border Subtle | `rgba(255,255,255,0.06)` | `--border-subtle` | Viền ngăn cách nhẹ bên trong card |
| Border Focus / Ring | `#3B82F6` | `--border-focus` / `--blue` | Viền focus bàn phím & active ring |
| Primary Blue | `#3B82F6` | `--primary` | Màu nhấn thương hiệu chính (Sapphire) |
| Primary Gradient | `linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)` | `--primary-gradient` | Nút CTA chính, header highlight |
| Primary Hover | `linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)` | `--primary-hover` | Nút CTA khi hover |
| On Primary Text | `#FFFFFF` | `--primary-text` | Chữ trên nền primary gradient |
| Text Primary | `#F8FAFC` | `--text` | Văn bản chính (Crisp Slate 50, contrast > 10:1) |
| Text Secondary | `#CBD5E1` | `--text-secondary` | Văn bản phụ, nhãn cột (Slate 300) |
| Muted | `#94A3B8` | `--muted` | Ghi chú, placeholder, timestamp (WCAG AA ≥ 4.5:1) |
| Accent Amber | `#F59E0B` | `--amber` | Cảnh báo, tồn kho thấp, scanner barcode |
| Accent Green | `#10B981` | `--green` | Thành công, còn hàng, tăng trưởng dương |
| Accent Red | `#EF4444` | `--red` | Hết hàng, lỗi, thao tác nguy hiểm (Destructive) |
| Accent Purple | `#8B5CF6` | `--purple` | Vai trò Quản lý, badge cấp cao |
| Ambient Glow 1 | `rgba(59,130,246,0.08)` | `--ambient-1` | Vùng sáng xanh nền dịu nhẹ |
| Ambient Glow 2 | `rgba(16,185,129,0.05)` | `--ambient-2` | Vùng sáng xanh lá dịu nhẹ |

#### Light Mode (`:root[data-theme="light"]`)
| Role | Hex / Value | CSS Variable | Mục đích sử dụng |
|------|-------------|--------------|------------------|
| Background | `#F8FAFC` | `--bg` | Nền canvas sáng (Slate 50) |
| Panel / Card | `#FFFFFF` | `--panel` | Nền card trắng tinh |
| Panel 2 | `#F1F5F9` | `--panel-2` | Nền input, hover list, header table |
| Panel 3 | `#E2E8F0` | `--panel-3` | Nền active, chip nền xám |
| Border | `#E2E8F0` | `--border` | Đường viền sáng |
| Border Subtle | `#F1F5F9` | `--border-subtle` | Viền ngăn cách phụ |
| Border Focus / Ring | `#2563EB` | `--border-focus` | Viền focus sáng |
| Primary Blue | `#2563EB` | `--primary` | Xanh dương đậm nét |
| Primary Gradient | `linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)` | `--primary-gradient` | Nút CTA sáng |
| Primary Hover | `linear-gradient(135deg, #1D4ED8 0%, #1E40AF 100%)` | `--primary-hover` | Nút CTA hover |
| Text Primary | `#0F172A` | `--text` | Văn bản chính (Slate 900) |
| Text Secondary | `#334155` | `--text-secondary` | Văn bản phụ (Slate 700) |
| Muted | `#64748B` | `--muted` | Ghi chú, placeholder (Slate 500) |
| Accent Amber | `#D97706` | `--amber` | Cảnh báo sáng |
| Accent Green | `#059669` | `--green` | Thành công sáng |
| Accent Red | `#DC2626` | `--red` | Hết hàng / Lỗi sáng |
| Accent Purple | `#7C3AED` | `--purple` | Vai trò quản lý sáng |

---

### 4.2 Typography (Hệ Thống Phông Chữ)

- **Display & Heading Font:** `Be Vietnam Pro` (Weights: 600, 700, 800) — Thiết kế cho các tiêu đề `<h1>`–`<h4>`, Action Buttons, Modal Headers; hỗ trợ hoàn hảo dấu tiếng Việt.
- **Body Font:** `Inter` (Weights: 400, 500, 600, 700) — Dành cho văn bản hiển thị chung, nhãn form, bảng dữ liệu mô tả.
- **Data & Numeric Font:** `IBM Plex Mono` (Weights: 500, 600, 700) — Dành cho số lượng kho, mã SKU, barcode, đơn giá tiền tệ VNĐ, tỷ lệ %, đồng hồ thời gian thực (`font-variant-numeric: tabular-nums`).

```html
<!-- Google Fonts Embed Link -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@500;600;700;800&family=IBM+Plex+Mono:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

```css
:root {
  --font-display: 'Be Vietnam Pro', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-data: 'IBM Plex Mono', monospace;
}
```

#### Typography Scale
| Token / Element | Size | Weight | Line Height | Letter Spacing | Font Family |
|-----------------|------|--------|-------------|----------------|-------------|
| `Page Title (h1)` | `22px–26px` | `700–800` | `1.2` | `-0.02em` | `--font-display` |
| `Section Title (h2)` | `18px–20px` | `700` | `1.3` | `-0.01em` | `--font-display` |
| `Card Title (h3)` | `15px–16px` | `600` | `1.4` | `0` | `--font-display` |
| `Body Standard` | `14px` | `400 / 500` | `1.5` | `0` | `--font-body` |
| `Body Small / Meta` | `12px–13px` | `500` | `1.4` | `0` | `--font-body` |
| `KPI Metric Big` | `24px–32px` | `700` | `1.1` | `-0.02em` | `--font-data` |
| `Table Numeric Cell`| `13px–14px` | `600` | `1.4` | `0` | `--font-data` |
| `Badge / Tag Label` | `11px–12px` | `600–700`| `1.0` | `+0.03em` | `--font-body` |

*Quy tắc ngặt nghèo: Không dùng cỡ chữ dưới 12px trên toàn bộ hệ thống để đảm bảo tính dễ đọc.*

---

### 4.3 Spacing Variables (Hệ Thống Khoảng Cách — 8pt/4pt Grid)

| Token | Value | Ứng dụng chính |
|-------|-------|----------------|
| `--space-xs` | `2px` / `0.125rem` | Khoảng cách siêu nhỏ (viền đôi, chấm status) |
| `--space-sm` | `4px` / `0.25rem` | Khoảng cách giữa icon và chữ nhỏ, inline badge |
| `--space-md` | `8px` / `0.5rem` | Khoảng đệm chip, cell bảng dense, gap icon chuẩn |
| `--space-lg` | `12px` / `0.75rem` | Padding input, khoảng cách form-group nhỏ |
| `--space-xl` | `16px` / `1rem` | Padding thẻ Card, khoảng cách giữa các phần tử |
| `--space-2xl` | `24px` / `1.5rem` | Padding container chính, margin header |
| `--space-3xl` | `32px` / `2rem` | Khoảng cách phân cách giữa các Section lớn |

---

### 4.4 Border Radius Scale (Bo Góc)

```css
:root {
  --radius-xs: 6px;    /* Chips, mini badges */
  --radius-sm: 8px;    /* Inputs, select fields, action buttons */
  --radius-md: 10px;   /* Tab buttons, dropdown menus */
  --radius-lg: 12px;   /* KPI cards, data cards */
  --radius-xl: 14px;   /* Large panels, modal dialogs */
  --radius-pill: 9999px; /* Status pills, avatar circles, filter pills */
}
```

---

### 4.5 Elevation, Shadows & Glassmorphism

```css
:root {
  /* Dark Mode Shadows & Elevation */
  --card-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.5), 0 0 1px 1px rgba(255, 255, 255, 0.06);
  --shadow-modal: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 1px 1px rgba(255, 255, 255, 0.1);
  --shadow-toast: 0 8px 24px rgba(0, 0, 0, 0.4);
  --shadow-focus-blue: 0 0 0 3px rgba(59, 130, 246, 0.35), 0 0 20px rgba(59, 130, 246, 0.25);
  --shadow-brand: 0 4px 14px rgba(37, 99, 235, 0.35);

  /* Glassmorphism & Backdrop */
  --glass-bg: rgba(17, 24, 39, 0.75);
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-blur: blur(12px);
}
```

---

## 5. Quy Cách Component Chuẩn (Component Specs)

### 5.1 Buttons (Nút Bấm)

```css
/* Primary CTA Button */
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: 10px 18px;
  background: var(--primary-gradient);
  color: var(--primary-text);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 700;
  border: none;
  border-radius: var(--radius-sm);
  box-shadow: var(--primary-shadow);
  cursor: pointer;
  transition: transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease;
  user-select: none;
}
.btn-primary:hover {
  background: var(--primary-hover);
  transform: translateY(-1px);
  box-shadow: 0 6px 20px 0 rgba(37, 99, 235, 0.45);
}
.btn-primary:active {
  transform: translateY(1px);
  box-shadow: 0 2px 8px 0 rgba(37, 99, 235, 0.3);
}
.btn-primary:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus-blue);
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

/* Secondary Outlined Button */
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: 10px 16px;
  background: var(--panel-2);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 600;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease;
}
.btn-secondary:hover {
  background: var(--panel-3);
  border-color: var(--muted);
  transform: translateY(-1px);
}
.btn-secondary:active {
  transform: translateY(1px);
}
```

### 5.2 Cards / Panels / KPI Blocks

```css
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-xl);
  box-shadow: var(--card-shadow);
  position: relative;
  transition: border-color 200ms ease, transform 200ms ease, box-shadow 200ms ease;
}
.card:hover {
  border-color: rgba(59, 130, 246, 0.35);
}

/* KPI Stat Metric Card */
.kpi-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.kpi-card .kpi-label {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
.kpi-card .kpi-value {
  font-family: var(--font-data);
  font-size: 26px;
  font-weight: 700;
  color: var(--text);
}
```

### 5.3 Status Badges & Pills (Kho Hàng & Vận Hành)

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

/* Tồn kho an toàn / Đã xuất */
.badge-success, .badge-in-stock {
  color: #34d399;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.3);
}

/* Tồn kho thấp / Cảnh báo */
.badge-warning, .badge-low-stock {
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.14);
  border: 1px solid rgba(245, 158, 11, 0.3);
}

/* Hết hàng / Lỗi / Hủy */
.badge-danger, .badge-out-of-stock {
  color: #f87171;
  background: rgba(239, 68, 68, 0.14);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

/* Thông tin / Đang xử lý */
.badge-info, .badge-pending {
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.14);
  border: 1px solid rgba(59, 130, 246, 0.3);
}
```

### 5.4 Form Controls & Inputs

```css
.form-input, .form-select {
  width: 100%;
  padding: 10px 14px;
  background: var(--panel-2);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.form-input:focus, .form-select:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
}
.form-input::placeholder {
  color: var(--muted);
}
.form-input:disabled {
  opacity: 0.6;
  background: var(--panel-3);
  cursor: not-allowed;
}
```

### 5.5 Data Tables (Bảng Dữ Liệu Dense)

- **Sticky Header:** Cố định tiêu đề bảng khi cuộn dọc (`position: sticky; top: 0; z-index: 10;`).
- **Nền Header:** Sử dụng `var(--panel-2)` với chữ `var(--text-secondary)`, `font-weight: 600`, viết hoa nhẹ (`text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em;`).
- **Dòng dữ liệu (Row Hover):** Hover đổi nền mượt mà sang `var(--panel-2)` hoặc `var(--surface-hover)`. Không tạo bóng nâng dòng làm lệch layout.
- **Cột Số liệu & Mã:** Căn phải (`text-align: right;`), dùng `font-family: var(--font-data); font-variant-numeric: tabular-nums;`.
- **Target tương tác:** Nút xem chi tiết, sao chép mã SKU, thao tác phải có kích thước tối thiểu 40×40px (desktop) và 44×44px (mobile).

```css
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-body);
  font-size: 13px;
}
.data-table th {
  position: sticky;
  top: 0;
  background: var(--panel-2);
  color: var(--text-secondary);
  font-weight: 600;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.05em;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}
.data-table td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--row-divider);
  color: var(--text);
  vertical-align: middle;
}
.data-table tbody tr {
  transition: background-color 100ms ease;
}
.data-table tbody tr:hover {
  background: var(--panel-2);
}
.data-table .col-numeric {
  text-align: right;
  font-family: var(--font-data);
  font-weight: 600;
}
```

---

## 6. Motion & Micro-Interactions (Chuyển Động & Hiệu Ứng)

### 6.1 Chuẩn Hoạt Họa Giao Diện
- **Thời lượng tiêu chuẩn:** `150ms – 300ms` (không vượt quá 300ms cho các tương tác UI nhằm tránh cảm giác chậm chạp).
- **Easing Curve:** `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` cho phản hồi tự nhiên, sắc nét.
- **Giới hạn Transform:** Chỉ sử dụng `translateY(-1px đến -2px)`, `scale(0.98)` (active), `opacity` và `backgroundColor`. Tuyệt đối tránh scale lớn làm biến dạng bố cục lưới.

### 6.2 Hỗ Trợ Giảm Chuyển Động (Reduced Motion)
Bắt buộc áp dụng toàn diện trên tất cả các file CSS và Script:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## 7. 3D Progressive Enhancement Layer (Lớp Nâng Cao 3D Three.js)

Hệ thống tích hợp lớp **Progressive Enhancement 3D** tùy chọn (đáp ứng 7 trang nghiệp vụ), độc lập và không phá vỡ CSS nền tảng:

1. **Hạt nền Three.js (`three-bg.js`):** 300 hạt chuyển động đa chiều, đổi màu tự động theo theme dark/light, canvas mang `aria-hidden="true"`, z-index: -1.
2. **Card Tilt 3D (`three-interactions.js`):** Xoay nhẹ góc 3D theo tọa độ chuột (`perspective(1000px) rotateX(...) rotateY(...)`).
3. **Tactile Buttons & Navigation:** Hiệu ứng lún nút 3D và lan tỏa xúc giác (tactile feedback).
4. **3D Loading Cube (`three-loading.js`):** Khối lập phương 3D xoay không gian khi tải dữ liệu (`role="status"`).
5. **Biểu đồ 3D (`three-charts.js`):** Render biểu đồ cột 3D Three.js cho doanh thu trên trang tổng quan.
6. **Cơ chế An toàn & Tối ưu Hiệu năng:**
   - Tự động hạ tần số khung hình render khi FPS giảm (`three-performance.js`).
   - Thu hồi bộ nhớ WebGL và giải phóng context khi rời trang (`three-memory.js`).
   - Tạm dừng render hoạt họa khi tab trình duyệt bị ẩn (`three-visibility.js`).
   - Tắt hoàn toàn khi bật `prefers-reduced-motion: reduce`.
   - Có khả năng tắt hoặc gỡ bỏ tức thì mà không gây lỗi console (xem [ROLLBACK.md](../../ROLLBACK.md)).

---

## 8. Quy Trình Thực Hiện (Implementation Workflow)

Mỗi khi phát triển hoặc cập nhật trang/component mới, tuân thủ 5 bước chuẩn hóa:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Plan & Understand                                        │
│    - Xác định rõ yêu cầu nghiệp vụ, vai trò người dùng       │
│    - Phân tích bố cục Data-Dense & các chỉ số KPI ưu tiên   │
├─────────────────────────────────────────────────────────────┤
│ 2. Build the Foundation                                     │
│    - Sử dụng chuẩn CSS variables từ MASTER.md & shared.css  │
│    - Định hình Typography, Grid Layout, Spacing Tokens      │
├─────────────────────────────────────────────────────────────┤
│ 3. Create Components                                        │
│    - Viết các component tái sử dụng (Button, Card, Badge)   │
│    - Không dùng style inline ad-hoc; tuân thủ token chuẩn   │
├─────────────────────────────────────────────────────────────┤
│ 4. Assemble Pages & Responsive Layout                       │
│    - Tích hợp vào khung tổng thể (Sidebar + Header + Body)  │
│    - Kiểm thử hiển thị trên 375px, 768px, 1024px, 1440px    │
├─────────────────────────────────────────────────────────────┤
│ 5. Polish, Optimize & Accessibility                         │
│    - Thêm micro-interactions & feedback xúc giác            │
│    - Kiểm tra WCAG AA ≥ 4.5:1, keyboard navigation, INP/LCP │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Tiêu Chuẩn SEO & Web Standards

Áp dụng tự động trên toàn bộ các trang:
- **Heading Structure:** Duy nhất một thẻ `<h1>` trên mỗi trang biểu thị tiêu đề chức năng chính; các tiêu đề phụ phân cấp hợp lý `<h2>` → `<h3>` → `<h4>`.
- **Title & Meta Tags:** `<title>` mô tả chính xác trang (Ví dụ: `Tồn Kho & Quản Lý SKU | TKS Dashboard`); có thẻ `<meta name="description">` tóm tắt mục đích trang.
- **Semantic HTML5:** Sử dụng đúng thẻ ngữ nghĩa (`<main>`, `<nav>`, `<aside>`, `<section>`, `<article>`, `<header>`, `<footer>`).
- **Unique IDs:** Đảm bảo tất cả các nút bấm, input, modal, menu trigger đều có `id` duy nhất phục vụ điều hướng a11y và automation testing.
- **Tối ưu tốc độ tải trang:** Giảm thiểu blocking render, nén tài nguyên hình ảnh, dùng font-display swap.

---

## 10. Anti-Patterns (Những Điều TUYỆT ĐỐI KHÔNG Làm)

- ❌ **Không dùng Emojis thay cho icons:** Luôn sử dụng icon SVG (Heroicons/Lucide phong cách nhất quán).
- ❌ **Không quên `cursor: pointer`:** Tất cả phần tử có tương tác click (nút, tab, hàng bảng có thể mở chi tiết, chip filter) bắt buộc phải có `cursor: pointer`.
- ❌ **Không dùng màu sắc cơ bản sơ sài (Plain Colors):** Tránh các mã màu nguyên bản `#ff0000`, `#00ff00`, `#0000ff`. Phải dùng đúng hệ token (`--red`, `--green`, `--blue`).
- ❌ **Không gây giật bố cục khi Hover (Layout-shifting):** Tuyệt đối không dùng `margin`/`padding`/`border-width` biến thiên khi hover; chỉ dùng `transform` hoặc `backgroundColor`.
- ❌ **Không tạo độ tương phản kém (Low Contrast):** Màu chữ trên nền phải đạt tối thiểu `4.5:1` (WCAG AA).
- ❌ **Không ẩn outline Focus bàn phím:** Giữ nguyên `:focus-visible` với vòng sáng xanh rõ nét (`var(--shadow-focus-blue)`).
- ❌ **Không để logic phụ thuộc cứng vào 3D/JS:** Giao diện cơ bản phải hoạt động hoàn hảo ngay cả khi Three.js hoặc WebGL bị tắt hoặc không được hỗ trợ.

---

## 11. Pre-Delivery Checklist (Bảng Kiểm Tra Trước Khi Bàn Giao UI)

Trước khi nghiệm thu bất kỳ giao diện nào, lập trình viên phải kiểm tra đủ các mục sau:

- [ ] **Icon đồng bộ:** Toàn bộ icon là SVG nội tuyến hoặc SVG sprite, không có emoji.
- [ ] **Màu sắc & Token:** 100% màu sắc và khoảng cách sử dụng CSS Variables chuẩn từ `MASTER.md` / `shared.css`.
- [ ] **Độ tương phản:** Đạt chuẩn WCAG AA (chữ thường ≥ 4.5:1, chữ lớn & icon ≥ 3:1).
- [ ] **Tương tác chuột:** `cursor: pointer` đầy đủ trên mọi phần tử bấm được.
- [ ] **Tương tác bàn phím:** Điều hướng phím Tab mượt mà, `:focus-visible` sáng rõ.
- [ ] **Hoạt họa:** Mượt mà (150–300ms), hỗ trợ tắt tức thì khi có `prefers-reduced-motion: reduce`.
- [ ] **Responsive:** Kiểm thử hiển thị không lỗi và không tràn màn hình ngang trên `375px`, `768px`, `1024px`, `1440px`.
- [ ] **Touch Target:** Kích thước vùng bấm trên Mobile tối thiểu `44×44px`.
- [ ] **Ngữ nghĩa HTML:** Có 1 thẻ `<h1>` duy nhất, cấu trúc thẻ semantic chuẩn.
- [ ] **Rollback 3D:** Giao diện không phát sinh bất kỳ lỗi console nào khi tắt lớp 3D Three.js.
