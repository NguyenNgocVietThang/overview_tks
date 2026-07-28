# Nâng cấp CHbansi Dashboard — Premium UI Redesign

Dựa trên code hiện có (Google Apps Script backend + Dashboard HTML frontend), tôi sẽ thiết kế lại toàn bộ giao diện Dashboard với UI **cực kỳ ấn tượng**, giữ nguyên logic backend `Code.gs` và cấu trúc dữ liệu từ Google Sheets.

## Tổng quan kiến trúc hiện tại

| Thành phần | File | Vai trò |
|---|---|---|
| Backend | [Code.gs](file:///D:/Web TKS Dashboard/Code.gs) | Google Apps Script — KiotViet API, webhook, `getDashboardData()` |
| Frontend | [Dashboard.html](file:///D:/Web TKS Dashboard/Dashboard.) | HTML + CSS + JS (Chart.js) — gọi `google.script.run` |

> [!NOTE]
> Backend `Code.gs` **không cần thay đổi** — hàm `getDashboardData()` trả về đúng cấu trúc dữ liệu cần thiết. Chỉ cần nâng cấp file `Dashboard.html`.

## Proposed Changes

### [MODIFY] [Dashboard.html](file:///D:/Web TKS Dashboard/Dashboard.html)

Viết lại toàn bộ file Dashboard với các cải tiến premium sau:

#### 🎨 Design System
- **Color palette** mới: Dark theme sang trọng với gradient aurora (tím-xanh-hồng)
- **Typography**: Google Fonts — `Plus Jakarta Sans` (headings), `Inter` (body), `JetBrains Mono` (số liệu)
- **Glassmorphism**: Các card/panel với `backdrop-filter: blur()` + semi-transparent background
- **CSS Variables**: Toàn bộ design tokens quản lý bằng custom properties

#### ✨ Micro-animations & Effects
- **Animated gradient** background (aurora borealis effect chuyển màu liên tục)
- **Counting animation** cho các số KPI (đếm từ 0 lên giá trị thực)
- **Hover effects** trên card với `scale`, `glow`, `border-color transition`
- **Skeleton loading** thay vì loading veil đơn giản
- **Staggered entry animation** khi chuyển view (từng card xuất hiện lần lượt)
- **Pulse animation** cho live indicator

#### 📊 Charts nâng cấp
- Chart.js vẫn dùng nhưng với **gradient fills**, **custom tooltips**, **smooth animations**
- **Doughnut chart** cho tồn kho: thêm center text hiển thị tổng
- **Revenue chart**: gradient area fill đẹp hơn, custom point styles

#### 🏗️ Layout cải tiến
- **Sidebar**: Glassmorphism, icon SVG thay vì ký tự Unicode, tooltip khi collapsed
- **Header**: Nổi bật hơn với gradient brand mark, animated status dot
- **KPI Cards**: 4 columns với icon + sparkline mini-chart concept
- **Tables**: Styled rows với hover highlight, alternating subtle bg
- **Responsive**: Mobile-first với sidebar collapse hoạt động mượt

#### 🆕 Tính năng mới
- **Auto-refresh** mỗi 60 giây (với countdown indicator)
- **Dark/Light mode toggle** (mặc định dark)
- **Toast notification** khi refresh thành công
- **Scroll-to-top** button
- **Search filter** cho bảng hóa đơn & khách hàng
- **Export summary** button (placeholder)

## Open Questions

> [!IMPORTANT]
> 1. **Google Sheets ID**: File `Code.gs` hiện dùng `SpreadsheetApp.getActiveSpreadsheet()`. Bạn có muốn tôi thêm khả năng cấu hình Spreadsheet ID cụ thể không?
> 2. **Logo/Branding**: Bạn muốn giữ "CHbansi" hay đổi tên thương hiệu trên dashboard?
> 3. **Auto-refresh interval**: Tôi đặt mặc định 60 giây — bạn muốn thay đổi không?

## Verification Plan

### Manual Verification
- Sau khi hoàn thành, bạn copy nội dung `Dashboard.html` vào Google Apps Script project
- Deploy lại Web App và kiểm tra giao diện mới
- Kiểm tra responsive trên mobile, tablet, desktop
- Xác nhận dữ liệu hiển thị đúng từ Google Sheets
