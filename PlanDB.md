# PlanDB.md — Kế hoạch xây dựng CSDL nội bộ cho KiotViet

> Tài liệu kiến trúc & lộ trình cho việc xây dựng PostgreSQL làm lớp dữ liệu riêng của website, đồng bộ từ KiotViet API, bắt đầu bằng việc cắt đứt phụ thuộc Google Sheets cho tính năng **"Báo cáo tổng hợp"**. Viết theo `spec-driven-development` sau một phiên phỏng vấn với chủ dự án (2026-08-30).

## Mục lục

1. [Bối cảnh & vấn đề hiện tại](#1-bối-cảnh--vấn-đề-hiện-tại)
2. [Mục tiêu & phạm vi](#2-mục-tiêu--phạm-vi)
3. [Nguyên tắc kiến trúc bất biến](#3-nguyên-tắc-kiến-trúc-bất-biến)
4. [Quyết định công nghệ](#4-quyết-định-công-nghệ)
5. [Xử lý 2 tài khoản KiotViet độc lập (Hà Nội / Sài Gòn)](#5-xử-lý-2-tài-khoản-kiotviet-độc-lập-hà-nội--sài-gòn)
6. [Thiết kế schema PostgreSQL](#6-thiết-kế-schema-postgresql)
7. [Thiết kế Sync Engine](#7-thiết-kế-sync-engine)
8. [Lộ trình triển khai theo giai đoạn](#8-lộ-trình-triển-khai-theo-giai-đoạn)
9. [Rủi ro & câu hỏi kỹ thuật cần xác minh sớm](#9-rủi-ro--câu-hỏi-kỹ-thuật-cần-xác-minh-sớm)
10. [Ranh giới (Boundaries)](#10-ranh-giới-boundaries)
11. [Phụ lục: file liên quan trong repo hiện tại](#11-phụ-lục-file-liên-quan-trong-repo-hiện-tại)

---

## 1. Bối cảnh & vấn đề hiện tại

Quy trình dữ liệu hiện tại của công ty:

```
KiotViet API → Google Apps Script (src-dashboard/, 2 deployment KiotHN + KiotSG)
             → ghi trực tiếp vào Google Sheets (SpreadsheetApp)
             → Node server (server/) đọc Sheets LIVE mỗi request qua googleapis
             → website hiển thị
```

Không có database nào trong `server/` — mọi "repository" (`server/hr/hrLeaveRepository.js`, `server/shipment/vcOrderRepository.js`, v.v.) đều là wrapper đọc/ghi Google Sheets tại thời điểm request, có cache RAM ngắn hạn (~90 giây).

**Vấn đề cụ thể đang gặp phải:**

- **Google Sheets đã chạm trần kỹ thuật**: giới hạn cứng 10 triệu ô/spreadsheet đã được chủ động né bằng code (`ensureSpreadsheetCellHeadroom_` trong `src-dashboard/utils/Helpers.gs`) — nghĩa là áp lực này là **có thật, đã xảy ra**, không phải giả định.
- **Không có transaction/lock giữa các tiến trình**: `server/shipment/vcOrderRepository.js` đã tự ghi chú "Google Sheets không hỗ trợ transaction hay pessimistic locking... nếu cần chính xác tuyệt đối trong tương lai, cần chuyển sang RDBMS có hỗ trợ SELECT FOR UPDATE".
- **2 chi nhánh là 2 spreadsheet tách biệt hoàn toàn** (Hà Nội dùng `SPREADSHEET_ID`, Sài Gòn dùng `SPREADSHEET_ID_SG`, mỗi bên có deployment Apps Script riêng — KiotHN/KiotSG) → **không tồn tại báo cáo gộp cả 2 chi nhánh ở bất kỳ đâu hôm nay**. Đây là hạn chế lớn nhất mà việc chuyển sang 1 CSDL chung giải quyết được ngay lập tức.
- Pipeline GAS hiện tại vừa được vá 4 bug mất dữ liệu do đụng độ khóa giữa các tiến trình đồng bộ (2026-08-29) — hệ thống **đang chạy ổn định sau khi vá**, tuyệt đối không đụng vào trong phạm vi tài liệu này.

SRS hiện tại (`docs/02-srs/SRS_Dashboard_GoogleSheets.md`, mục 2.5 "Định hướng kiến trúc mở rộng dài hạn") đã ghi sẵn:

> *"Khi bổ sung CSDL (Giai đoạn 3+): thêm PostgreSQL để lưu lịch sử, không phá vỡ luồng đọc Sheets hiện tại."*

Tài liệu này là bước hiện thực hóa định hướng đó, được làm rõ và mở rộng qua phỏng vấn trực tiếp với chủ dự án.

### Phạm vi cụ thể của "Báo cáo tổng hợp"

Đây là tên **nhóm điều hướng có thật trong code** (`server/public/shared/shared-nav.js:605-621`), không phải khái niệm trừu tượng. Nhóm này gồm 6 tab:

| Tab | View key |
|---|---|
| Tổng quan | `overview` |
| Hàng hóa | `products` |
| Hóa đơn | `invoices` |
| Khách hàng | `customers` |
| Nhà cung cấp | `suppliers` |
| Công nợ | `debt` |

Cả 6 tab được phục vụ bởi **`server/dashboard/dashboardData.js`** (gọi thêm `server/dashboard/debtReport.js` cho tab Công nợ) thông qua các route trong `server/routes.js`:

- `GET /api/dashboard` (dòng 141) — dữ liệu chính cho 6 tab
- `GET /api/search` (dòng 181) — tìm kiếm trong dữ liệu trên
- `GET /api/customer-product-top` (dòng 202) — top khách hàng theo sản phẩm
- `GET /api/customer-product-revenue` (dòng 230) — doanh thu theo khách/sản phẩm
- `POST /api/export`, `/api/export/fields` — xuất Excel từ cùng dữ liệu

Tất cả các route trên hiện đọc Google Sheets qua `server/sheets/sheetsClient.js`.

---

## 2. Mục tiêu & phạm vi

**Mục tiêu tổng quát**: xây PostgreSQL làm lớp dữ liệu riêng của website, đồng bộ gần thời gian thực từ KiotViet API, để:

1. **Trước mắt (Phase 1 + 2)**: tính năng "Báo cáo tổng hợp" (6 tab ở trên) chạy hoàn toàn trên PostgreSQL, **cắt đứt hoàn toàn phụ thuộc Google Sheets** cho riêng tính năng này.
2. **Về lâu dài (Phase 3, ngoài phạm vi thiết kế chi tiết của tài liệu này)**: PostgreSQL trở thành nguồn dữ liệu gốc (có thể tạo/sửa trực tiếp trên website), KiotViet chỉ còn là một nguồn tham chiếu.

**Điều đây KHÔNG phải là** (ranh giới quan trọng, tránh hiểu lầm phạm vi):

- **Không phải** "thêm một đường đọc mới chạy song song mãi mãi" — đây là một cuộc **cutover thật sự**: dựng bản thay thế đọc Postgres, xác minh khớp số liệu với bản Sheets cũ, chuyển route sang dùng bản mới, rồi **xóa hẳn code đọc Sheets cũ** trong `dashboardData.js`/`debtReport.js`.
- **Không đụng đến** `src-dashboard/` (Apps Script) — GAS tiếp tục ghi Google Sheets như cũ, phục vụ nhân viên thao tác tay, không có gì thay đổi ở phía đó.
- **Không đụng đến** `server/sheets/sheetsClient.js` — module này vẫn được giữ nguyên vì còn phục vụ các tính năng khác **ngoài phạm vi** tài liệu này:
  - `server/auth/userRepository.js` — tab "Users" (không phải dữ liệu KiotViet, chỉ tình cờ nằm chung spreadsheet)
  - `server/shipment/invoiceStatusService.js`, `server/shipment/shipmentOrderRoutes.js` — tra cứu vận chuyển
  - `server/dashboard/stockoutCheck/*` — tính năng kiểm tra dứt hàng (đã tự gọi KiotViet API trực tiếp cho phần so sánh, nhưng `productCodeValidator.js` vẫn đọc Sheets)
  - `server/hr/*` — quản lý nhân sự (spreadsheet HR riêng)

  Tất cả các tính năng trên **giữ nguyên, không đổi** trong kế hoạch này.

**Quy mô mục tiêu thiết kế**: 5-20 chi nhánh, 1.000-10.000 đơn/ngày (thực tế hiện tại nhỏ hơn — chỉ 2 chi nhánh HN/SG — nhưng thiết kế có sẵn chỗ mở rộng không tốn thêm chi phí). Backfill lịch sử từ **2026-01-01**.

---

## 3. Nguyên tắc kiến trúc bất biến

Áp dụng cho **mọi bảng nghiệp vụ**, không ngoại lệ — đây là điều kiện để Phase 3 (DB làm nguồn gốc) khả thi mà không phải viết lại schema:

1. **Khóa chính là surrogate key**: `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`. **Không bao giờ** dùng ID của KiotViet làm khóa chính — vì sau này sẽ có dòng dữ liệu tạo trực tiếp trên website, không qua KiotViet, và không có ID KiotViet nào cho dòng đó.
2. **Liên kết KiotViet, không đồng nhất với KiotViet**: mỗi bảng có `kiotviet_id BIGINT NULL` + unique index dạng **partial**:
   ```sql
   CREATE UNIQUE INDEX ... ON <table>(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
   ```
   Nhờ vậy một dòng có `kiotviet_id = NULL` (tạo thẳng trên website ở Phase 3) không tham gia ràng buộc unique này — không cần đổi schema khi việc đó xảy ra. Mọi upsert dùng `ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO UPDATE ...`.
3. **Cột nguồn gốc**: `source TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import'))`. Dùng TEXT+CHECK thay vì `ENUM` của Postgres vì enum khó mở rộng sau này (`ALTER TYPE ... ADD VALUE` có nhiều hạn chế trong transaction).
4. **Bookkeeping đồng bộ** — 4 timestamp riêng biệt, không gộp:
   - `kiotviet_modified_at` — thời điểm KiotViet báo đối tượng được sửa lần cuối (dùng làm mốc cho lượt poll tiếp theo)
   - `kiotviet_synced_at` — thời điểm sync engine xác nhận/ghi dòng này lần cuối (cập nhật mỗi lượt kể cả khi nội dung không đổi)
   - `created_at` / `updated_at` — bookkeeping DB tiêu chuẩn, `updated_at` là cột mà một chỉnh sửa tay tương lai sẽ cập nhật
5. **`branch_id` là khái niệm của chúng ta**, không phải của KiotViet: bảng `branches` riêng (Hà Nội/Sài Gòn hôm nay), gán theo **bộ credential nào đã lấy được dòng dữ liệu này** — khác với field `BranchId`/`BranchName` nội bộ của KiotViet (một khái niệm hẹp hơn, chi nhánh *bên trong* một tài khoản KiotViet). Field gốc của KiotViet vẫn lưu lại (`kiotviet_branch_id`, `kiotviet_branch_name`) để truy vết, nhưng không dùng để phân vùng báo cáo.
6. **Kiểu dữ liệu**: tiền tệ `NUMERIC(18,2)` (không bao giờ dùng float), số lượng `NUMERIC(18,3)` (KiotViet cho phép số lẻ/hàng theo cân), thời gian `TIMESTAMPTZ` — KiotViet trả chuỗi giờ **không có offset múi giờ**, phải tự cộng `+07:00` giống code hiện tại đã làm (`getCurrentMonthRange` trong `server/jobs/syncCustomerReport.js`) — quên bước này sẽ lệch 7 tiếng trong mọi báo cáo. Text dùng `TEXT`, không giới hạn `VARCHAR(n)`.
7. **Luôn tự tạo index cho cột FK dùng để JOIN** — Postgres không tự động làm việc này (khác một số DB khác).

---

## 4. Quyết định công nghệ

| Hạng mục | Quyết định | Lý do |
|---|---|---|
| **Database** | PostgreSQL | Đúng định hướng đã ghi sẵn ở SRS §2.5; mạnh cho `GROUP BY`/window function phục vụ báo cáo tổng hợp đa chi nhánh; JSON/JSONB sẵn có nếu cần lưu payload gốc sau này |
| **Driver** | `pg` (node-postgres), **không dùng ORM** | Toàn bộ codebase hiện tại (`hr`, `auth`, `shipment`) đều là repository pattern viết tay, không ORM nào. `server/package.json` tuyên bố rõ `"build": "no build step required"` — Prisma cần bước generate client, phá nguyên tắc này. Aggregate reporting về bản chất là SQL thô (`GROUP BY`, `date_trunc`, window function) — ORM thường phải thoát ra raw query cho đúng việc này, nên không tận dụng được lợi ích chính của ORM |
| **Migration** | File `.sql` đánh số tay (`0001_branches.sql`, `0002_...`) + script runner ~100 dòng (`server/db/migrate.js`) + bảng `schema_migrations` theo dõi version đã chạy | Giống hệt pattern đã có sẵn ở `server/scripts/migrateUserBranches.js` (idempotent, forward-only, chạy một lần) — không thêm dependency mới. Forward-only, không cần down-migration |
| **Hosting DB** | Render Postgres (managed) cho hiện tại, kết nối qua `DATABASE_URL` chuẩn | Server đã chạy Render (xác nhận qua chú thích trong `.env.example`). Dùng connection string chuẩn, không đặc thù vendor → khi chuyển sang **VPS riêng sau này**, chỉ cần `pg_dump`/`pg_restore` + đổi `DATABASE_URL`, không cần thiết kế lại |
| **KiotViet API client** | Trích xuất `server/dashboard/stockoutCheck/kiotVietClient.js` (đã có sẵn: cache token, retry 429/5xx, tự refresh khi 401, phân trang dạng callback) thành `server/kiotviet/kiotVietApiClient.js` dùng chung | Tránh viết bản thứ 3 — hiện đã có 2 bản KiotViet client trùng lặp (bản này và bản inline trong `server/jobs/syncCustomerReport.js`) |
| **Tiến trình sync** | 1 process Node **chạy dài hạn** (long-running daemon), tự lên lịch bằng `setTimeout` nối tiếp (không dùng cron ngắn hạn) | Nhịp 90 giây cho hóa đơn/đơn hàng không hợp với tiến trình ngắn hạn: (1) cold-start container ăn vào phần đáng kể của chu kỳ 90s; (2) tiến trình mới phải xin token OAuth mới mỗi lần thay vì tái dùng token đã cache ~55 phút; (3) mục tiêu "chạy dưới process supervisor bất kỳ" (Render Background Worker hôm nay, PM2/systemd trên VPS sau) mô tả đúng một daemon thường trực, không phải job định kỳ |

---

## 5. Xử lý 2 tài khoản KiotViet độc lập (Hà Nội / Sài Gòn)

**Xác nhận quan trọng**: đây là **2 tài khoản/subscription KiotViet hoàn toàn tách biệt** — khác `client_id`, `client_secret`, `retailer` (`CHhanoi` vs `CHsaigon`) — **không phải** 1 tài khoản KiotViet có 2 chi nhánh nội bộ. Điều này ảnh hưởng trực tiếp tới toàn bộ thiết kế sync engine:

### 5.1. Cấu hình

Tái sử dụng đúng biến môi trường đã có, không đặt tên mới:

| Biến | Hà Nội | Sài Gòn |
|---|---|---|
| Client ID | `KIOTVIET_CLIENT_ID` | `KIOTVIET_CLIENT_ID_SG` |
| Client Secret | `KIOTVIET_CLIENT_SECRET` | `KIOTVIET_CLIENT_SECRET_SG` |
| Retailer | `KIOTVIET_RETAILER` | `KIOTVIET_RETAILER_SG` |

`server/kiotvietSync/branchConfig.js` đọc cả 2 bộ, dựng mảng `[{branchCode:'hanoi',...}, {branchCode:'saigon',...}]`. Nếu bộ `_SG` để trống → **bỏ qua Sài Gòn kèm cảnh báo log, không crash server** — giống hệt cách `VC_SPREADSHEET_ID_SG`/`HR_SPREADSHEET_ID_SG` đang được xử lý trong `server/config.js` hiện tại.

### 5.2. Cô lập hoàn toàn giữa 2 branch

- **Token OAuth tách biệt**: mỗi branch tự xin và tự cache token riêng (`id.kiotviet.vn/connect/token`, grant `client_credentials`). Token Hà Nội không liên quan gì tới token Sài Gòn.
- **Rate limit tách biệt theo tài khoản**: vì là 2 tài khoản KiotViet khác nhau, quota gần như chắc chắn tính riêng theo từng tài khoản → **không cần** dùng chung 1 concurrency pool giữa 2 branch. Mỗi branch có pool giới hạn đồng thời riêng (2-3 request cùng lúc mỗi branch).
- **Lịch chạy độc lập, cô lập lỗi (điểm quan trọng nhất)**: nếu API KiotViet của Hà Nội lỗi/timeout, việc đồng bộ Sài Gòn **tuyệt đối không được bị ảnh hưởng**, và ngược lại. Cơ chế: `scheduler.js` khởi tạo **2 cặp vòng lặp (nhanh/chậm) độc lập hoàn toàn**, mỗi vòng có `try/catch` riêng và không chờ đợi lẫn nhau. Bảng `sync_checkpoints`/`sync_run_log` có `branch_id` trong khóa chính nên lỗi liên tiếp của Hà Nội chỉ tăng `consecutive_error_count` của riêng dòng `(branch_id='hanoi', entity_name=...)`.
- **Backfill chạy tách theo branch**: `node backfill.js --branch=hanoi --from=2026-01-01` và `node backfill.js --branch=saigon --from=2026-01-01` là 2 lượt độc lập, mỗi lượt tự chia theo từng tháng (8 chunk cho khoảng 2026-01 → 2026-08) và tự resume nếu lỗi giữa chừng.

### 5.3. Lợi ích mới có được

Vì 2 chi nhánh hiện là 2 spreadsheet tách biệt hoàn toàn, **không tồn tại báo cáo "tổng cả Hà Nội + Sài Gòn" ở đâu cả hôm nay**. Khi dữ liệu 2 branch nằm chung 1 PostgreSQL (phân biệt bằng cột `branch_id`), báo cáo có thể:
- `GROUP BY branch_id` → xem riêng từng chi nhánh (như hiện tại)
- Bỏ filter branch → xem **gộp toàn hệ thống** — khả năng hoàn toàn mới, đúng nghĩa "báo cáo tổng hợp"

### 5.4. Rủi ro mới phát sinh — phân quyền chi nhánh

Hôm nay ranh giới chi nhánh được đảm bảo **vật lý**: 2 spreadsheet khác nhau, nhân viên Hà Nội không có quyền truy cập file Sài Gòn — bản thân việc tách file *là* cơ chế phân quyền. Khi gộp vào 1 CSDL, ranh giới vật lý đó biến mất — **toàn bộ trách nhiệm phân quyền theo chi nhánh chuyển hẳn sang tầng ứng dụng** (middleware `resolveBranch`/`req.branch` đã có sẵn trong `server/branch/branchMiddleware.js`).

**Hành động bắt buộc trước khi code Phase 2**: mọi query báo cáo tổng hợp mới phải filter theo `req.branch` giống hệt cơ chế hiện tại, **trừ khi** xác nhận rõ có vai trò nào được phép xem báo cáo gộp cả 2 chi nhánh — cần chốt việc này với chủ dự án trước khi viết SQL cho Phase 2, không tự suy đoán.

---

## 6. Thiết kế schema PostgreSQL

**10 entity đồng bộ** — 9 tab hiện có trong Sheets, cộng thêm **`cash_flows`** (phát hiện là bắt buộc khi rà soát `src-dashboard/kiotviet/CustomerDebtReport.gs:46-78`: báo cáo Công nợ hiện tại không chỉ dùng khách hàng/hóa đơn/trả hàng mà còn gọi endpoint `/cashflow` của KiotViet — thiếu bảng này thì tab "Công nợ" trên Postgres sẽ sai/thiếu so với bản Sheets).

### 6.1. Dimension

```sql
-- branches: KHÔNG đến từ KiotViet, là khái niệm của chúng ta
CREATE TABLE branches (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,          -- 'hanoi' | 'saigon'
  name              TEXT NOT NULL,                 -- 'Hà Nội' | 'Sài Gòn'
  kiotviet_retailer TEXT NOT NULL,                 -- 'CHhanoi' | 'CHsaigon'
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Thêm chi nhánh #3 sau này chỉ cần 1 INSERT + 1 bộ env var mới, không đổi schema.

-- staff: suy ra dần từ SoldById/CreatedById trong hóa đơn/đơn hàng/trả hàng/
-- nhập hàng/thu chi — không cần poll endpoint riêng ở Phase 1.
CREATE TABLE staff (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id            BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id          BIGINT NULL,
  kiotviet_code        TEXT NULL,
  full_name            TEXT NOT NULL,
  phone                TEXT NULL,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  discovered_via       TEXT NULL,                  -- 'invoice'|'order'|'return'|'purchase'|'cashflow'
  source               TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at TIMESTAMPTZ NULL,
  kiotviet_synced_at   TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_branch_kiotviet_uq ON staff(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;

-- categories
CREATE TABLE categories (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id            BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id          BIGINT NULL,
  kiotviet_parent_id   BIGINT NULL,
  parent_category_id   BIGINT NULL REFERENCES categories(id),
  name                 TEXT NOT NULL,
  has_child            BOOLEAN NOT NULL DEFAULT false,
  source               TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at TIMESTAMPTZ NULL,
  kiotviet_synced_at   TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_branch_kiotviet_uq ON categories(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE INDEX categories_parent_idx ON categories(parent_category_id);
```

### 6.2. Sản phẩm & tồn kho

```sql
CREATE TABLE products (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id            BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id          BIGINT NULL,
  category_id          BIGINT NULL REFERENCES categories(id),
  kiotviet_category_id BIGINT NULL,
  product_code         TEXT NOT NULL,
  name                 TEXT NOT NULL,
  product_type         TEXT NULL,                  -- 'hang_hoa' | 'combo' | 'dich_vu'
  base_price           NUMERIC(18,2) NULL,
  allows_sale          BOOLEAN NOT NULL DEFAULT true,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  unit                 TEXT NULL,
  conversion_value     NUMERIC(18,4) NULL,
  has_variants         BOOLEAN NOT NULL DEFAULT false,
  description          TEXT NULL,
  shelf_location       TEXT NULL,
  source               TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at TIMESTAMPTZ NULL,
  kiotviet_synced_at   TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_branch_kiotviet_uq ON products(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX products_branch_code_uq ON products(branch_id, product_code);
CREATE INDEX products_category_idx ON products(category_id);

-- Bảng con riêng — KiotViet trả Inventories[] theo TỪNG branch nội bộ, không
-- phải 1 số duy nhất (xem Helpers.gs:189-238). Mặc định kiotviet_branch_id=0
-- khi KiotViet không tách theo branch nội bộ, để unique constraint luôn có
-- conflict target rõ ràng (tránh lỗ hổng NULL-uniqueness).
CREATE TABLE product_inventory (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kiotviet_branch_id  BIGINT NOT NULL DEFAULT 0,
  kiotviet_branch_name TEXT NULL,
  on_hand             NUMERIC(18,3) NULL,
  reserved            NUMERIC(18,3) NULL,
  cost                NUMERIC(18,2) NULL,
  min_quantity        NUMERIC(18,3) NULL,
  max_quantity        NUMERIC(18,3) NULL,
  kiotviet_synced_at  TIMESTAMPTZ NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_inventory_uq ON product_inventory(product_id, kiotviet_branch_id);

-- Append-only, phục vụ biểu đồ xu hướng tồn kho — thứ Sheets không làm được
-- vì chỉ lưu trạng thái hiện tại. Ghi 1 dòng/ngày, tận dụng lượt poll products
-- hằng ngày, không cần lịch riêng.
CREATE TABLE inventory_daily_snapshot (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id         BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kiotviet_branch_id BIGINT NOT NULL DEFAULT 0,
  snapshot_date      DATE NOT NULL,
  on_hand            NUMERIC(18,3) NULL,
  reserved           NUMERIC(18,3) NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inventory_snapshot_uq ON inventory_daily_snapshot(product_id, kiotviet_branch_id, snapshot_date);
```

### 6.3. Hóa đơn, đơn hàng, trả hàng

```sql
CREATE TABLE invoices (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id                 BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id               BIGINT NULL,
  invoice_code              TEXT NOT NULL,
  purchase_date             TIMESTAMPTZ NOT NULL,
  order_code                TEXT NULL,
  customer_id               BIGINT NULL REFERENCES customers(id),   -- xem lưu ý thứ tự tạo bảng bên dưới
  kiotviet_customer_id      BIGINT NULL,
  customer_code_snapshot    TEXT NULL,
  customer_name_snapshot    TEXT NULL,
  customer_contact_snapshot TEXT NULL,
  sold_by_staff_id          BIGINT NULL REFERENCES staff(id),
  kiotviet_branch_id        BIGINT NULL,      -- field nội bộ KiotViet, KHÁC branch_id
  kiotviet_branch_name      TEXT NULL,
  total_amount              NUMERIC(18,2) NOT NULL,
  discount_amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_payment             NUMERIC(18,2) NOT NULL DEFAULT 0,
  status                    SMALLINT NULL,     -- giữ nguyên mã gốc KiotViet, KHÔNG suy diễn nhãn (xem mục 9)
  description               TEXT NULL,
  using_cod                 BOOLEAN NOT NULL DEFAULT false,
  source                    TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at      TIMESTAMPTZ NULL,
  kiotviet_synced_at        TIMESTAMPTZ NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoices_branch_kiotviet_uq ON invoices(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX invoices_branch_code_uq ON invoices(branch_id, invoice_code);
CREATE INDEX invoices_branch_date_idx ON invoices(branch_id, purchase_date);
CREATE INDEX invoices_branch_customer_date_idx ON invoices(branch_id, customer_id, purchase_date);

-- Không có ID dòng ổn định từ KiotViet cho từng line item → line_no (vị trí
-- trong mảng) là conflict target. Chiến lược upsert: XÓA hết dòng cũ của 1
-- invoice rồi CHÈN LẠI toàn bộ trong cùng transaction với header, thay vì cố
-- diff từng dòng — hóa đơn thường <20 dòng nên đơn giản > tối ưu sớm.
CREATE TABLE invoice_line_items (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id            BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  branch_id             BIGINT NOT NULL,     -- copy từ cha, ghi trong CÙNG transaction nên không lệch
  line_no               INT NOT NULL,
  product_id            BIGINT NULL REFERENCES products(id),
  kiotviet_product_id   BIGINT NULL,
  product_code_snapshot TEXT NULL,
  product_name_snapshot TEXT NULL,
  quantity              NUMERIC(18,3) NOT NULL,
  price                 NUMERIC(18,2) NOT NULL,
  discount              NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_ratio        NUMERIC(9,4) NULL,
  line_amount           NUMERIC(18,2) NOT NULL,
  note                  TEXT NULL
);
CREATE UNIQUE INDEX invoice_line_items_uq ON invoice_line_items(invoice_id, line_no);
CREATE INDEX invoice_line_items_product_idx ON invoice_line_items(product_id);

-- orders: cùng hình dạng invoices (không tách line item, đúng phạm vi 9 tab
-- hiện tại — Sheets cũng không tách "Đặt hàng" thành chi tiết riêng).
CREATE TABLE orders (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id                 BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id               BIGINT NULL,
  order_code                TEXT NOT NULL,
  order_date                TIMESTAMPTZ NOT NULL,
  customer_id               BIGINT NULL REFERENCES customers(id),
  kiotviet_customer_id      BIGINT NULL,
  customer_code_snapshot    TEXT NULL,
  customer_name_snapshot    TEXT NULL,
  customer_contact_snapshot TEXT NULL,
  created_by_staff_id       BIGINT NULL REFERENCES staff(id),
  kiotviet_branch_id        BIGINT NULL,
  kiotviet_branch_name      TEXT NULL,
  total_amount              NUMERIC(18,2) NOT NULL,
  total_payment             NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_ratio            NUMERIC(9,4) NULL,
  status                    SMALLINT NULL,
  description               TEXT NULL,
  using_cod                 BOOLEAN NOT NULL DEFAULT false,
  source                    TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at      TIMESTAMPTZ NULL,
  kiotviet_synced_at        TIMESTAMPTZ NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX orders_branch_kiotviet_uq ON orders(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX orders_branch_code_uq ON orders(branch_id, order_code);
CREATE INDEX orders_branch_date_idx ON orders(branch_id, order_date);
CREATE INDEX orders_branch_customer_idx ON orders(branch_id, customer_id);

CREATE TABLE returns (
  id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id                   BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id                 BIGINT NULL,
  return_code                 TEXT NOT NULL,
  return_date                 TIMESTAMPTZ NOT NULL,
  original_invoice_id         BIGINT NULL REFERENCES invoices(id),
  kiotviet_original_invoice_id BIGINT NULL,
  customer_id                 BIGINT NULL REFERENCES customers(id),
  sold_by_staff_id            BIGINT NULL REFERENCES staff(id),
  received_by_staff_id        BIGINT NULL REFERENCES staff(id),  -- KiotViet có cả 2 vai trò
  return_total                NUMERIC(18,2) NOT NULL DEFAULT 0,
  return_discount             NUMERIC(18,2) NOT NULL DEFAULT 0,
  return_fee                  NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_payment               NUMERIC(18,2) NOT NULL DEFAULT 0,
  status                      SMALLINT NULL,
  source                      TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at        TIMESTAMPTZ NULL,
  kiotviet_synced_at          TIMESTAMPTZ NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX returns_branch_kiotviet_uq ON returns(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX returns_branch_code_uq ON returns(branch_id, return_code);
CREATE INDEX returns_branch_date_idx ON returns(branch_id, return_date);
CREATE INDEX returns_original_invoice_idx ON returns(branch_id, original_invoice_id);
```

### 6.4. Khách hàng & nhà cung cấp

```sql
CREATE TABLE customers (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id             BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id           BIGINT NULL,
  customer_code         TEXT NOT NULL,
  name                  TEXT NOT NULL,
  contact_number        TEXT NULL,
  sub_contact_number    TEXT NULL,
  address               TEXT NULL,
  organization          TEXT NULL,
  customer_group_names  TEXT NULL,   -- gộp chuỗi, giống cách hiện tại đang làm
  gender                TEXT NULL,
  birthday              DATE NULL,
  debt_amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_invoiced         NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_revenue         NUMERIC(18,2) NOT NULL DEFAULT 0,  -- số KiotViet tự tính — đối chiếu chéo với SUM(invoices) sau backfill
  source                TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at  TIMESTAMPTZ NULL,
  kiotviet_synced_at    TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_branch_kiotviet_uq ON customers(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX customers_branch_code_uq ON customers(branch_id, customer_code);

CREATE TABLE suppliers (
  id                            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id                     BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id                   BIGINT NULL,
  supplier_code                 TEXT NOT NULL,
  name                          TEXT NOT NULL,
  contact_number                TEXT NULL,
  address                       TEXT NULL,
  debt_amount                   NUMERIC(18,2) NOT NULL DEFAULT 0,
  is_active                     BOOLEAN NOT NULL DEFAULT true,
  created_by_staff_id           BIGINT NULL REFERENCES staff(id),
  total_purchased                NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_purchased_net_of_returns NUMERIC(18,2) NOT NULL DEFAULT 0,
  source                        TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at          TIMESTAMPTZ NULL,
  kiotviet_synced_at            TIMESTAMPTZ NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_branch_kiotviet_uq ON suppliers(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX suppliers_branch_code_uq ON suppliers(branch_id, supplier_code);
```

### 6.5. Nhập hàng

Tab "Nhập hàng" hiện tại trong Sheets lặp lại header trên mỗi dòng chi tiết vì Sheets không JOIN được — đây là hạn chế bị ép buộc bởi Sheets, không phải thiết kế đúng. Trong Postgres tách quan hệ đúng chuẩn, giống `invoices`/`invoice_line_items`:

```sql
CREATE TABLE purchases (
  id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id                BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id              BIGINT NULL,
  purchase_code            TEXT NOT NULL,
  purchase_date            TIMESTAMPTZ NOT NULL,
  supplier_id              BIGINT NULL REFERENCES suppliers(id),
  kiotviet_supplier_id     BIGINT NULL,
  supplier_code_snapshot   TEXT NULL,
  supplier_name_snapshot   TEXT NULL,
  created_by_staff_id      BIGINT NULL REFERENCES staff(id),
  total_amount             NUMERIC(18,2) NOT NULL,
  discount_amount          NUMERIC(18,2) NOT NULL DEFAULT 0,
  supplier_debt_amount     NUMERIC(18,2) NOT NULL DEFAULT 0,
  paid_amount              NUMERIC(18,2) NOT NULL DEFAULT 0,
  status                   SMALLINT NULL,
  note                     TEXT NULL,
  source                   TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at     TIMESTAMPTZ NULL,
  kiotviet_synced_at       TIMESTAMPTZ NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX purchases_branch_kiotviet_uq ON purchases(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX purchases_branch_code_uq ON purchases(branch_id, purchase_code);
CREATE INDEX purchases_branch_date_idx ON purchases(branch_id, purchase_date);
CREATE INDEX purchases_branch_supplier_idx ON purchases(branch_id, supplier_id);

-- Cùng chiến lược xóa-và-chèn-lại như invoice_line_items.
CREATE TABLE purchase_line_items (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purchase_id           BIGINT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  branch_id             BIGINT NOT NULL,
  line_no               INT NOT NULL,
  product_id            BIGINT NULL REFERENCES products(id),
  kiotviet_product_id   BIGINT NULL,
  product_code_snapshot TEXT NULL,
  product_name_snapshot TEXT NULL,
  quantity              NUMERIC(18,3) NOT NULL,
  price                 NUMERIC(18,2) NOT NULL,
  discount              NUMERIC(18,2) NOT NULL DEFAULT 0,
  line_amount           NUMERIC(18,2) NOT NULL,
  note                  TEXT NULL
);
CREATE UNIQUE INDEX purchase_line_items_uq ON purchase_line_items(purchase_id, line_no);
CREATE INDEX purchase_line_items_product_idx ON purchase_line_items(product_id);
```

### 6.6. Thu/chi (bảng mới — bắt buộc cho tab Công nợ)

Phát hiện khi rà soát `src-dashboard/kiotviet/CustomerDebtReport.gs:46-78`: báo cáo Công nợ (HN1/HN3/HN7, do GAS tính) gọi endpoint **`/cashflow`** của KiotViet với tham số `isReceipt=true/false` để phân biệt phiếu thu/phiếu chi, dùng cùng với khách hàng/hóa đơn/trả hàng để tính công nợ chính xác. **Không đồng bộ bảng này thì tab "Công nợ" trên Postgres sẽ sai/thiếu.**

```sql
CREATE TABLE cash_flows (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id             BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id           BIGINT NULL,
  code                  TEXT NOT NULL,
  trans_date            TIMESTAMPTZ NOT NULL,
  amount                NUMERIC(18,2) NOT NULL,
  is_receipt            BOOLEAN NOT NULL,     -- true = phiếu thu, false = phiếu chi
  kiotviet_partner_id   BIGINT NULL,
  customer_id           BIGINT NULL REFERENCES customers(id),
  supplier_id           BIGINT NULL REFERENCES suppliers(id),
  partner_name_snapshot TEXT NULL,
  contact_number        TEXT NULL,
  status                SMALLINT NULL,
  description           TEXT NULL,
  source                TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at  TIMESTAMPTZ NULL,
  kiotviet_synced_at    TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cash_flows_branch_kiotviet_uq ON cash_flows(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE INDEX cash_flows_branch_date_idx ON cash_flows(branch_id, trans_date);
CREATE INDEX cash_flows_branch_customer_idx ON cash_flows(branch_id, customer_id);
```

### 6.7. Hạ tầng đồng bộ

Khóa tự nhiên, không cần surrogate key vì đây là bảng bookkeeping, không phải entity nghiệp vụ:

```sql
CREATE TABLE sync_checkpoints (
  branch_id               BIGINT NOT NULL REFERENCES branches(id),
  entity_name             TEXT NOT NULL,
  last_checkpoint_at      TIMESTAMPTZ NULL,
  last_success_at         TIMESTAMPTZ NULL,
  last_error              TEXT NULL,
  last_error_at           TIMESTAMPTZ NULL,
  consecutive_error_count INT NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, entity_name)
);

CREATE TABLE sync_run_log (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id        BIGINT NOT NULL REFERENCES branches(id),
  entity_name      TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL,
  finished_at      TIMESTAMPTZ NULL,
  status           TEXT NOT NULL,   -- 'success' | 'error'
  records_fetched  INT NULL,
  records_upserted INT NULL,
  error_message    TEXT NULL
);
CREATE INDEX sync_run_log_branch_entity_idx ON sync_run_log(branch_id, entity_name, started_at DESC);
```

**Lưu ý thứ tự migration**: `customers`/`suppliers` phải tạo **trước** `invoices`/`orders`/`purchases`/`cash_flows` vì các bảng sau tham chiếu FK tới chúng; `products`/`categories` phải tạo trước `invoice_line_items`/`purchase_line_items`.

---

## 7. Thiết kế Sync Engine

### 7.1. Cấu trúc thư mục

```
server/db/
  pool.js                      -- pg.Pool dùng chung, đọc DATABASE_URL + PGSSL
  migrate.js                   -- migration runner
  migrations/
    0001_branches.sql
    0002_staff.sql
    0003_categories.sql
    0004_products.sql
    0005_customers.sql
    0006_suppliers.sql
    0007_invoices.sql
    0008_orders.sql
    0009_returns.sql
    0010_purchases.sql
    0011_cash_flows.sql
    0012_sync_infra.sql
server/kiotviet/
  kiotVietApiClient.js         -- trích xuất từ stockoutCheck/kiotVietClient.js, dùng chung
server/kiotvietSync/
  branchConfig.js              -- đọc KIOTVIET_CLIENT_ID[_SECRET|_RETAILER][_SG] → 2 branch config độc lập
  syncCheckpointRepository.js
  entities/
    categoriesSync.js  productsSync.js  customersSync.js  suppliersSync.js
    staffSync.js        -- helper dùng chung, không tự chạy độc lập
    invoicesSync.js  ordersSync.js  returnsSync.js  purchasesSync.js  cashFlowsSync.js
  scheduler.js                 -- MỖI branch 1 cặp vòng lặp nhanh/chậm ĐỘC LẬP, lệch giờ bắt đầu
  runSyncEngine.js              -- entry point; xử lý SIGTERM để thoát sạch; hỗ trợ cờ --once
  backfill.js                  -- CLI: node backfill.js --branch=hanoi|saigon --from=2026-01-01 [--to=...]
```

### 7.2. Nguyên tắc vận hành

- **Checkpoint**: mỗi `(branch_id, entity_name)` lưu `last_checkpoint_at`. Trước mỗi lượt poll, lấy mốc này trừ đi khoảng đệm an toàn 2-5 phút (chống lệch giờ/dữ liệu đến muộn), gọi KiotViet từ mốc đó, upsert toàn bộ kết quả; **chỉ khi thành công** mới đẩy checkpoint tiến lên (bằng thời điểm bắt đầu request, không phải tin tưởng mù quáng vào `ModifiedDate` của từng entity).
- **Upsert idempotent**: mọi ghi đều qua `ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO UPDATE SET ..., kiotviet_synced_at = now(), updated_at = now()` — không bao giờ ghi đè `created_at`, không đụng `source` của dòng đã có `kiotviet_id`. Với bảng có line item (invoices, purchases): upsert header trong transaction, `DELETE` toàn bộ line item cũ theo `invoice_id`/`purchase_id`, `INSERT` lại toàn bộ, commit — dùng `DO UPDATE SET x = EXCLUDED.x` (không dùng `DO NOTHING`) để `RETURNING id` luôn có giá trị kể cả khi conflict.
- **Lỗi giữa chừng = không đẩy checkpoint**: nếu 1 batch lỗi, ghi `sync_run_log` (`status='error'`), tăng `consecutive_error_count`, **không** đẩy checkpoint — lượt sau tự động chạy lại từ mốc cũ. Đơn giản hơn nhiều so với cơ chế chunk/resume của GAS, vì Node không bị giới hạn 6 phút/lần thực thi như Apps Script.
- **Không bao giờ đụng Google Sheets**: `server/kiotvietSync/` và `server/kiotviet/` không import `googleapis`, không đọc `GOOGLE_SERVICE_ACCOUNT_JSON` — đây là đảm bảo về **cấu trúc code**, không chỉ là quy ước cần nhớ.

### 7.3. Nhịp đồng bộ (áp dụng cho MỖI branch riêng biệt)

| Tầng | Entity | Chu kỳ | Vì sao |
|---|---|---|---|
| Nhanh | invoices, orders | ~90 giây | 2 bảng giá trị cao nhất theo yêu cầu |
| Chậm | categories, products, customers, suppliers, purchases, returns, cash_flows | 15 phút | Bằng/tốt hơn tần suất polling hiện tại của GAS cho các bảng không có webhook (returns/suppliers/purchases hôm nay đã poll 15 phút) |
| Miễn phí | staff | — | Suy ra ngay trong lúc sync invoices/orders/cash_flows, không cần lịch riêng |

Cấu hình qua biến môi trường mới: `KIOTVIET_SYNC_FAST_INTERVAL_MS` (mặc định 90000), `KIOTVIET_SYNC_SLOW_INTERVAL_MS` (mặc định 900000). Lệch giờ bắt đầu (stagger) giữa các track để tránh dồn toàn bộ request vào cùng 1 thời điểm — cùng nguyên tắc đã áp dụng ở `docs/superpowers/specs/2026-08-20-stagger-customer-report-triggers-design.md`.

---

## 8. Lộ trình triển khai theo giai đoạn

### Phase 1 — Database + Ingest cho cả 2 chi nhánh

*Chưa đổi bất kỳ route nào của web trong phase này.*

1. Tạo Render Postgres, thêm `DATABASE_URL`/`PGSSL` vào `server/config.js` theo đúng pattern `required()`/optional hiện có.
2. `server/db/pool.js` + `server/db/migrate.js` + toàn bộ migration ở mục 6.
3. Trích xuất `server/kiotviet/kiotVietApiClient.js` từ `stockoutCheck/kiotVietClient.js` (refactor nhỏ, không đổi hành vi module cũ).
4. Sync dimension trước: `branches` (seed 2 dòng hanoi/saigon), `categoriesSync.js`, `staffSync.js` (helper).
5. `productsSync.js` + `product_inventory` + `inventory_daily_snapshot`.
6. `customersSync.js`, `suppliersSync.js`.
7. Bảng giao dịch (cần FK ở trên): `invoicesSync.js`, `ordersSync.js`, `returnsSync.js`, `purchasesSync.js`, `cashFlowsSync.js`.
8. `scheduler.js` (2 branch độc lập hoàn toàn) + `runSyncEngine.js`; deploy dạng Render Background Worker.
9. `backfill.js` chạy riêng từng branch, 2026-01-01 → hiện tại, chia theo tháng.
10. Test `node:test` (cùng convention hiện tại, dependency-injection cho KiotViet client và `pg` pool) + xác minh qua `sync_run_log` cho cả 2 branch.

**Done khi**: 10 entity × 2 chi nhánh tự động đồng bộ đúng nhịp; `sync_checkpoints` tiến đều, `consecutive_error_count = 0`; lỗi ở 1 branch không ảnh hưởng branch còn lại; backfill phủ từ 2026-01-01; **không có đường code nào chạm vào Sheets/GAS**; chưa route web nào thay đổi.

### Phase 2 — Cutover "Báo cáo tổng hợp" khỏi Google Sheets

*Đây là một cuộc di dời thật sự (cutover), không phải thêm tính năng chạy song song mãi mãi.*

1. Viết lại phần tính toán của `dashboardData.js`/`debtReport.js` (module mới hoặc sửa tại chỗ) để đọc hoàn toàn từ PostgreSQL — **giữ nguyên response shape** hiện tại để `server/public/index.html` không cần đổi gì ở frontend. Tab Công nợ dùng `cash_flows` mới thay vì đọc tab HN1/HN3/HN7.
2. **Xác minh song song** (script/test so sánh, KHÔNG phải route production phục vụ 2 nguồn cùng lúc): chạy bản Postgres cạnh bản Sheets, đối chiếu số liệu khớp trên vài kỳ/khách hàng/chi nhánh cụ thể trước khi tin tưởng.
3. Chuyển `server/routes.js` (`/api/dashboard`, `/api/search`, `/api/customer-product-top`, `/api/customer-product-revenue`, `/api/export`) sang gọi bản Postgres.
4. **Xóa hẳn** code đọc Sheets cũ trong `dashboardData.js`/`debtReport.js` — bỏ `require('../sheets/sheetsClient')` khỏi các file này. **Không đụng** `sheetsClient.js` (module dùng chung) và **không đụng** `auth/userRepository.js`, `shipment/*`, `hr/*`, `stockoutCheck/*` — các tính năng này tiếp tục đọc Sheets bình thường, ngoài phạm vi.
5. Áp dụng đúng phân quyền chi nhánh ở tầng ứng dụng cho mọi query mới — xem mục 5.4 (cần chốt trước: vai trò nào (nếu có) được xem báo cáo gộp 2 chi nhánh).

**Done khi**: cả 6 tab của "Báo cáo tổng hợp" chạy 100% trên Postgres; không còn dòng code nào trong `dashboardData.js`/`debtReport.js` gọi `sheetsClient`; dashboard hiển thị với người dùng y hệt như trước (cùng response shape); dashboard Sheets của các tính năng khác (shipment/HR/stockout-check) không đổi.

### Phase 3 — DB làm nguồn chính, ghi ngược Sheets nếu cần (spec riêng, ngoài phạm vi tài liệu này)

Chỉ ghi nhận điều kiện tiên quyết — đã được đảm bảo sẵn từ Phase 1-2, không cần làm gì thêm ngay: surrogate key + `kiotviet_id` nullable (đã hỗ trợ dòng dữ liệu không qua KiotViet), cột `source` (phân biệt dòng nào cần ghi ngược Sheets, dòng nào không).

Vấn đề để ngỏ cho spec riêng sau: khóa 3 lớp của GAS (`dataLock`/`ScriptLock`/`invoiceLock`, xem memory `kiotviet-sync-lock-hierarchy`) **không thể với tới được từ một tiến trình Node bên ngoài** — không có primitive khóa chung giữa 2 runtime. Hai hướng khả dĩ, không quyết định ở đây: (a) chia cột/vùng ghi rõ ràng, không bao giờ chồng lấn, giữa GAS và Node; hoặc (b) tắt hẳn trigger ghi của GAS cho tab/cột nào Node đã tiếp quản.

---

## 9. Rủi ro & câu hỏi kỹ thuật cần xác minh sớm

Nên xác minh các mục này **khi bắt đầu code Phase 1**, trước khi giả định và code cứng theo giả định sai:

- **Endpoint `/cashflow` cần xác minh kỹ tham số** (phân trang, `isReceipt`, có cần OAuth scope khác `PublicApi.Access` không) — tham chiếu `src-dashboard/kiotviet/CustomerDebtReport.gs:46-78` làm chuẩn trước khi code `cashFlowsSync.js`.
- **Rate limit KiotViet không được công bố công khai** — chỉ biết `pageSize` tối đa 100/request. Đo thực tế (log số lần gặp HTTP 429) thay vì đoán số liệu.
- **Mã trạng thái hóa đơn/đơn hàng không nhất quán ngay trong code hiện tại**: `SheetSchemas.gs` coi status `1` = "Phiếu tạm" (nháp), nhưng `server/jobs/syncCustomerReport.js` lại lọc `status === 1` như hóa đơn hợp lệ để tính doanh thu, và cũng dùng `status: '1'` làm query filter khi gọi endpoint `/invoices` — có thể 2 chỗ này dùng 2 enum khác nhau. **Phải xác minh với API thật** trước khi Phase 2 hardcode bất kỳ filter "chỉ tính hoàn thành" nào — đây chính là lý do schema ở mục 6 lưu nguyên `status SMALLINT`, không suy diễn nhãn ngay từ đầu.
- **Phân quyền chi nhánh chuyển từ vật lý (2 spreadsheet) sang phần mềm (middleware)** khi gộp dữ liệu — xem mục 5.4, phải chốt trước khi viết SQL cho Phase 2.
- **Tính khả dụng dữ liệu lịch sử cho backfill 2026-01-01** chưa được xác nhận (KiotViet có cắt bớt field cho hóa đơn cũ không?) — nên test nhanh 1 hóa đơn tháng 3/2026, so sánh field với 1 hóa đơn gần đây, trước khi build backfill đầy đủ. Phân trang `currentItem` là offset-based (không phải cursor), nên `backfill.js` nên chia theo tháng để giảm rủi ro trôi dữ liệu giữa các trang khi kéo dữ liệu lớn.
- **Naive local-time parsing**: KiotViet trả chuỗi giờ không kèm offset; code hiện tại đã phải tự cộng `+07:00` thủ công (`getCurrentMonthRange` trong `syncCustomerReport.js`). Sync engine mới phải áp dụng đúng quy tắc này ở mọi nơi chuyển đổi sang `TIMESTAMPTZ`, quên sẽ lệch 7 tiếng trong mọi báo cáo bucket theo ngày.
- **Kích thước connection pool**: khi Phase 2 thêm web server cũng mở `pg.Pool` riêng bên cạnh pool của sync engine, tổng `max` của cả 2 pool phải nằm trong giới hạn kết nối của gói Postgres đã mua — mục cần kiểm tra khi provisioning, không phải lỗi thiết kế.
- **Endpoint danh sách nhân viên riêng?** — cần xác minh KiotViet Public API có endpoint Users/Employees không; nếu có thì tốt hơn cách suy ra từ hóa đơn/đơn hàng/thu chi (đủ field hơn: vai trò, SĐT, trạng thái hoạt động).
- **Đối chiếu số liệu kỹ trước khi xóa code Sheets cũ ở Phase 2 bước 4** — vì đây là cutover thật, sai số liệu sau khi xóa code cũ sẽ khó rollback nhanh trên production. Giữ lại code cũ trong lịch sử git (không phải chạy song song) để có thể revert nếu phát hiện sai lệch sau khi lên production.

---

## 10. Ranh giới (Boundaries)

- **Luôn làm**: surrogate PK cho mọi bảng nghiệp vụ; `TIMESTAMPTZ` + xử lý offset `+07:00` tường minh mọi nơi; mỗi branch có checkpoint/error-count độc lập; viết test `node:test` theo convention hiện có trước khi coi 1 entity sync là xong; index mọi cột FK dùng để JOIN.
- **Hỏi trước khi làm**: bất kỳ thay đổi nào trong `src-dashboard/` (Apps Script); đăng ký hoặc sửa cấu hình webhook KiotViet; bắt đầu code Phase 3 (ghi ngược Sheets/DB làm nguồn chính) — cần spec riêng và duyệt riêng vì đụng tới pipeline production đang chạy; xác nhận vai trò nào (nếu có) được xem báo cáo gộp 2 chi nhánh, trước khi viết SQL cho Phase 2.
- **Không bao giờ làm**: để `server/kiotvietSync/`/`server/kiotviet/` import `googleapis` hoặc đọc `GOOGLE_SERVICE_ACCOUNT_JSON`; dùng ID của KiotViet làm khóa chính bất kỳ bảng nào; hardcode ý nghĩa mã trạng thái (`status`) khi chưa xác minh qua API thật; đăng ký thêm webhook KiotViet dưới bất kỳ hình thức nào (sẽ cướp mất đăng ký hiện có của GAS, vì KiotViet chỉ cho 1 webhook/loại sự kiện); xóa hoặc sửa `server/sheets/sheetsClient.js`, `server/auth/userRepository.js`, `server/shipment/*`, `server/hr/*`, `server/dashboard/stockoutCheck/*`.

---

## 11. Phụ lục: file liên quan trong repo hiện tại

| File | Vai trò |
|---|---|
| `src-dashboard/kiotviet/SheetSchemas.gs` | Tham chiếu chuẩn cho tên field KiotViet, đường dẫn endpoint (chú ý `/purchaseorders` không phải `/purchases`), tham số `listQuery` cho từng entity |
| `src-dashboard/kiotviet/CustomerDebtReport.gs` | Tham chiếu cách dùng endpoint `/cashflow` (dòng 46-78) cho bảng `cash_flows` mới |
| `src-dashboard/utils/Helpers.gs` | Lock hierarchy (`dataLock`/`invoiceLock`/`ScriptLock`) — không đụng vào; cũng có `ensureSpreadsheetCellHeadroom_` minh chứng áp lực trần 10 triệu ô |
| `server/dashboard/stockoutCheck/kiotVietClient.js` | KiotViet REST client tái sử dụng được (token cache, retry, phân trang) — trích xuất thành `server/kiotviet/kiotVietApiClient.js` |
| `server/dashboard/stockoutCheck/concurrencyPool.js` | Bộ giới hạn concurrency nhỏ gọn, tái sử dụng cho sync engine |
| `server/jobs/syncCustomerReport.js` | Tiền lệ tiến trình Node độc lập gọi KiotViet trực tiếp; tham khảo cách xử lý `+07:00`, đọc `.env`, entry pattern `require.main === module` |
| `server/config.js` | Nơi thêm `DATABASE_URL`/`PGSSL`, theo đúng pattern `required()`/optional đã có |
| `server/dashboard/dashboardData.js` + `server/dashboard/debtReport.js` | Mục tiêu cutover chính của Phase 2 |
| `server/routes.js` (dòng 141-230) | Các route cần chuyển sang gọi bản Postgres ở Phase 2 |
| `server/public/shared/shared-nav.js` (dòng 605-621) | Định nghĩa 6 tab của nhóm "Báo cáo tổng hợp" |
| `server/sheets/sheetsClient.js` | **Không đụng** — dùng chung với các tính năng ngoài phạm vi |
| `server/scripts/migrateUserBranches.js` | Mẫu cho phong cách migration script idempotent, forward-only |
| `docs/02-srs/SRS_Dashboard_GoogleSheets.md` §2.5, §7.6 | Định hướng PostgreSQL đã ghi sẵn; xác nhận "KiotViet chỉ chấp nhận 1 webhook/loại sự kiện" |
