# Việc cần làm — level khách / Khách mới / SĐT / địa chỉ

## T1 (S) Migration 0089 + repository
- [ ] `0089_customer_new_tag_contact.sql`: `customer_price_levels.new_customer`, hồ sơ khách `phone`, `address`
- [ ] `saveLevel` nhận `newCustomer` (cùng version/history); `getLevels` trả về
- [ ] Test PGlite: lưu, 409, cột trống
- Verify: `node --test businessReport/customerPriceLevelRepository.test.js`
- Files: migrations/0089, customerPriceLevelRepository(.test).js, customerProfileRepository(.test).js

## T2 (M) Script import Excel (phụ thuộc T1)
- [ ] `scripts/import-customer-levels-from-excel.js` preview/`--apply`, map level, xử lý trùng, báo không khớp, từ chối khi chưa khởi tạo
- [ ] Nạp Khách mới + SĐT + địa chỉ mặc định (không đè giá trị đã nhập tay)
- [ ] Test với fixture nhỏ (đúng 4 level, trùng, không khớp)
- Verify: preview trên file thật, đối chiếu tổng 4.100/754/292/61

### Checkpoint A: migration + import chạy trên PGlite, test xanh

## T3 (M) API
- [ ] Báo cáo khách trả `newCustomer`, `phone`, `address`; PUT customer-price-level nhận `newCustomer`; PUT profile nhận phone/address (nếu chốt sửa được)
- [ ] Quyền: chỉ `canEditPriceLevel`; test từ chối + 409
- Files: businessReportRoutes(.test).js, customerProfileRules.js

## T4 (M) Giao diện
- [ ] Cột "Khách mới" trong bảng tổng quan (sửa tại chỗ, rollback khi lỗi)
- [ ] Thêm SĐT + địa chỉ vào hộp Chi tiết
- [ ] JSDOM test + xem desktop/390px, sáng/tối
- Files: public/index.html, test/frontend/customer-profile.test.js

## T5 (S) Xuất + tài liệu
- [ ] Excel/HTML thêm cột; cập nhật README, server/README, SCHEMA, CURRENT, BRD/SRS, implementation_plan
- [ ] `npm test` xanh, `graphify update .`

### Checkpoint B: toàn bộ test xanh, duyệt trước khi `--apply` DB thật
