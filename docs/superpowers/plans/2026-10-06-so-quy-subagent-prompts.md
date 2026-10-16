# Sổ quỹ — Prompt cho nhiều subagent

Spec gốc: `docs/superpowers/specs/2026-10-06-so-quy-design.md`

## Sơ đồ phụ thuộc

```
A (Xác minh dữ liệu) ──► B (Migration + Sync) ──► C (Backend API) ──► E (Frontend) ──► F (Kiểm thử & review)
                    └──► D (Quyền + Nav) ────────────────────────────┘
```

- A chạy một mình trước, vì mọi agent khác cần kết quả của nó.
- B và D chạy song song sau A.
- C chạy sau B. E chạy sau C và D. F chạy cuối.
- Mỗi agent làm trong worktree/nhánh riêng: `cashbook/a-verify`, `cashbook/b-sync`… Orchestrator merge vào nhánh `feat/cashbook` theo thứ tự trên.

---

## 0. Prompt cho ORCHESTRATOR (agent chính)

```text
Bạn điều phối việc triển khai tính năng "Sổ quỹ" cho TOKOSI Dashboard (D:\Web TKS Dashboard).
Spec đã duyệt: docs/superpowers/specs/2026-10-06-so-quy-design.md. Prompt từng subagent: docs/superpowers/plans/2026-10-06-so-quy-subagent-prompts.md (mục A–F).

Quy trình:
1. Tạo nhánh feat/cashbook từ main.
2. Giao A, chờ kết quả. A báo không có khóa ID tài khoản → DỪNG toàn bộ, báo người dùng.
3. Giao B và D song song (mỗi agent một worktree riêng). Merge B rồi đến D vào feat/cashbook, chạy toàn bộ test.
4. Giao C, merge, chạy test. 5. Giao E, merge, chạy test. 6. Giao F.
7. Mỗi lần nhận kết quả từ subagent: đọc diff, kiểm tra có đúng phạm vi và có đi lệch spec không, chạy test. Hỏng thì gửi lại cho chính agent đó sửa, KHÔNG tự sửa hộ trừ lỗi rất nhỏ.
8. Truyền nguyên văn "Kết quả xác minh" (mục 12 spec) của A vào prompt của B, C, E.

Cấm: push, deploy, áp migration lên DB production, mở rộng phạm vi ngoài spec.
Báo cáo cuối cho người dùng: danh sách commit, số test trước/sau, bộ lọc bị ẩn kèm lý do, checklist deploy (mục 11 spec), ảnh chụp từ F.
```

---

## Quy tắc chung (dán kèm vào ĐẦU mọi prompt A–F)

```text
QUY TẮC CHUNG:
- Đọc hết docs/superpowers/specs/2026-10-06-so-quy-design.md trước khi làm. Spec là nguồn sự thật duy nhất; không bàn lại các quyết định D1–D7, không thêm tính năng ngoài phạm vi.
- Chỉ sửa đúng các file thuộc phần việc của bạn. Phát hiện cần sửa chỗ khác → ghi vào báo cáo, không tự sửa.
- Viết code cùng phong cách với code xung quanh: comment tiếng Việt cùng mật độ, mọi truy vấn SQL đều dùng tham số, múi giờ Asia/Ho_Chi_Minh.
- Làm theo TDD: viết test trước, rồi chạy `node --test` với glob (vd `node --test "server/cashbook/*.test.js"`) và chạy cả toàn bộ suite. Không giảm số test đang pass.
- Windows/Git Bash: sửa file có chữ Việt có dấu thì dùng Edit/Write, KHÔNG dùng heredoc→node hay sed -i.
- Commit theo Conventional Commits, cuối commit message có dòng:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Cấm push, deploy, kết nối DB production để ghi.
- Báo cáo cuối: file đã đổi, commit, số test trước/sau, các giả định, việc còn tồn.
```

---

## A. Xác minh dữ liệu (chỉ đọc)

```text
[QUY TẮC CHUNG]

NHIỆM VỤ: Thực hiện Bước 0 (mục 3 spec). KHÔNG viết code tính năng.

1. Dùng role đọc (reporting readonly, migration 0010) để truy vấn:
   SELECT raw FROM cash_flows ORDER BY trans_date DESC LIMIT 20;
   SELECT key, count(*) FROM cash_flows, jsonb_object_keys(raw) key GROUP BY key ORDER BY 2 DESC;
   Kèm thêm mẫu: 1 phiếu thu, 1 phiếu chi, 1 phiếu đã hủy, 1 phiếu tiền mặt, 1 phiếu chuyển khoản.
2. Xác định chính xác: khóa ID tài khoản; giá trị status của "đã thanh toán"/"đã hủy"; dấu của amount ở phiếu chi; khóa loại thu chi (id + tên); hạch toán KQKD; người tạo; loại/tên/mã/SĐT người nộp-nhận; công nợ đối tác.
3. Qua client trong server/kiotviet/, gọi GET /bankaccounts (chỉ đọc) và ghi lại cấu trúc. Xác nhận ID ở đây khớp với khóa ID tài khoản trong cash_flows.raw.
4. Đếm: tổng số dòng cash_flows; số dòng có/không có ID tài khoản (để ước lượng thời gian backfill).
5. Điền mục 12 của spec. Với mỗi bộ lọc: GIỮ hoặc ẨN (kèm lý do). Commit: docs(cashbook): record data verification results

Nếu KHÔNG có khóa ID tài khoản → dừng, báo lại kèm mẫu raw (che số tài khoản).
```

---

## B. Migration + Sync

```text
[QUY TẮC CHUNG]
KẾT QUẢ XÁC MINH TỪ A: <dán mục 12>

NHIỆM VỤ: mục 4 và 5 của spec.
1. server/db/migrations/0033_cash_book.sql: thêm cột account_id, status vào cash_flows (tên khóa theo kết quả A); tạo bảng cash_book_accounts và cash_book_checkpoints; tạo index. Backfill theo lô 20k dòng, chỉ UPDATE các dòng account_id IS NULL. Tham khảo migration cũ để biết cách viết vòng lặp/DO block.
2. Cập nhật server/db/SCHEMA.md và server/db/migrate.integration.test.js.
3. server/kiotvietSync/entities/cashFlows.js: thêm account_id, status vào columns/updateColumns/map (giữ đúng thứ tự cột). Cập nhật cashFlows.test.js.
4. Entity mới server/kiotvietSync/entities/bankAccounts.js + test (mẫu: categories.js). Đăng ký trong scheduler.js: 1 lần/ngày, và chạy ngay khi khởi động nếu bảng còn trống. Cập nhật preflightCheck/reconcileCounts nếu các file này liệt kê entity.
5. Chạy migration trên DB local/test (KHÔNG chạy trên production).
Commit: feat(cashbook): sync bank accounts and cash flow account_id
```

---

## C. Backend API

```text
[QUY TẮC CHUNG]
KẾT QUẢ XÁC MINH TỪ A: <dán mục 12>
Phụ thuộc: B đã merge (có cột account_id/status và 2 bảng mới).

NHIỆM VỤ: mục 6 của spec. Tạo server/cashbook/ gồm:
- cashbookFilters.js (thuần): parse/validate query → filter chuẩn → mệnh đề SQL có tham số. Preset thời gian theo giờ VN. Giá trị lạ → lỗi 400.
- cashbookBalance.js: số dư = checkpoint mới nhất + Σ thu − Σ chi, chỉ tính phiếu có trans_date > checkpoint_at, bỏ phiếu hủy. Chưa chốt → null. Quỹ đầu kỳ tính được cả khi from nằm trước hoặc sau checkpoint. Xử lý dấu amount đúng như kết quả A.
- cashbookRepository.js: summary, entries (phân trang máy chủ, số dư lũy kế bằng window function, chỉ trả khi thỏa điều kiện ở mục 6), filter-options (tên nhân viên đi qua dashboard/saleName.js), checkpoints, insertCheckpoint trong transaction (tự tính system_balance và diff).
- cashbookExport.js: xlsx/html cho 3 view balances|entries|checkpoints, chọn cột, giới hạn 20.000 dòng, escape HTML (mẫu: shipment/orderLifecycleExport.js, excelTableStyle.js).
- cashbookRoutes.js: 6 endpoint (bảng API ở mục 6), dùng requireFeature('cashbook.view' / 'cashbook.manage'). Mount trong server/routes.js. Bỏ qua cookie tks_branch.
Test bắt buộc: mọi case liệt kê ở mục 9 spec cho Balance/Filters/Routes/Export.
Nếu D chưa merge thì featureRegistry chưa có key mới: trong test, stub quyền thay vì sửa registry.
Commit: feat(cashbook): balance, ledger and checkpoint API
```

---

## D. Quyền + Điều hướng

```text
[QUY TẮC CHUNG]

NHIỆM VỤ: mục 7 của spec. CHỈ sửa:
- server/auth/featureRegistry.js: nhóm 'cashbook' đặt ngay sau 'hr'; thêm feature cashbook.view và cashbook.manage (MANAGER_ONLY; manage requires view nếu cơ chế requires áp dụng được); thêm trang { path:'/cashbook', href:'/cashbook/', anyOf:['cashbook.view'] }.
- Test quyền: Quản lý có đủ 2 quyền; Sale/Kho/Khách không có quyền nào; admin cứng vẫn hoạt động; trang quản trị phân quyền hiện nhóm "Sổ quỹ".
- server/public/shared/shared-nav.js: mục cấp 1 "Sổ quỹ" (key cashbook) đặt NGAY DƯỚI "Quản lý nhân sự", chỉ hiện khi có cashbook.view, active khi currentPath === '/cashbook'. Mẫu tham khảo: khối "Vị trí hàng". Chọn icon cùng bộ icon đang dùng.
- Kiểm tra pageGuard chặn /cashbook/ với người không có quyền (xem cách /stock-locations được bảo vệ trong server/index.js).
Commit: feat(cashbook): permissions and sidebar entry
```

---

## E. Frontend

```text
[QUY TẮC CHUNG]
KẾT QUẢ XÁC MINH TỪ A: <dán mục 12 — bộ lọc nào bị ẨN thì không dựng>
Phụ thuộc: C và D đã merge.

NHIỆM VỤ: mục 8 của spec. Tạo server/public/cashbook/index.html (HTML thuần, theme sáng/tối, shared-nav), mẫu tham khảo: public/stock-locations/ và trang vòng đời đơn (hộp "Cột hiển thị", nút xuất file).
- Cột bộ lọc bên trái theo đúng thứ tự trong spec; mobile thì gom vào ngăn kéo "Bộ lọc". Ô text debounce 300ms; lưu bộ lọc vào URL hash.
- Bên phải: dòng "Dữ liệu KiotViet đồng bộ lúc…", 4 thẻ KPI, bảng số dư tài khoản (bấm dòng → lọc theo quỹ đó; nút Chốt số dư chỉ hiện khi có cashbook.manage), sổ chi tiết phân trang (số dư lũy kế bằng null thì để trống + chú thích), lịch sử chốt (chênh lệch ≠ 0 tô đỏ).
- Hộp thoại Chốt số dư: hiện "Hệ thống đang tính / chênh lệch" trước khi lưu; ô số tự định dạng khi gõ; chặn chọn thời điểm ở tương lai.
- Xuất file: mỗi bảng có hộp chọn cột + chọn Excel/HTML.
- Tài khoản chưa chốt hiện "Chưa chốt", không hiện 0. Số âm tô đỏ.
- Test theo kiểu trích code từ HTML: định dạng tiền, dựng query từ bộ lọc, đọc/ghi hash, điều kiện hiện số dư lũy kế.
Commit: feat(cashbook): cash book page with filters and export
```

---

## F. Kiểm thử tích hợp & review

```text
[QUY TẮC CHUNG]

NHIỆM VỤ: kiểm tra toàn bộ nhánh feat/cashbook. Chỉ sửa lỗi nhỏ; lỗi lớn thì báo lại cho orchestrator.
1. Chạy toàn bộ test suite, so số test với main.
2. Đọc diff main...feat/cashbook, đối chiếu từng mục của spec (D1–D7, API, bộ lọc, test ở mục 9). Lập bảng: Mục spec | Đạt/Không đạt | Ghi chú.
3. Review: SQL đều có tham số; mọi route đều có requireFeature; phiếu hủy không lọt vào số dư; múi giờ VN ở biên ngày; không đọc tks_branch; export escape HTML; không có thay đổi lạc ngoài phạm vi.
4. Mở trang /cashbook/ trên trình duyệt bằng harness xem trang nội bộ không cần đăng nhập (memory reference-tokosi-view-pages-without-login, dọn launch.json sau khi xong). Thử: chốt số dư, đổi từng bộ lọc, phân trang, xuất xlsx/html có chọn cột. Chụp ảnh ở chế độ sáng, tối, mobile 375px; console không được có lỗi.
5. Viết docs/cashbook-setup.md ngắn: cách chốt số dư lần đầu, checklist deploy (mục 11 spec).
Commit: test(cashbook): integration review and setup guide
Báo cáo: bảng đối chiếu spec, ảnh chụp, danh sách lỗi còn lại.
```
