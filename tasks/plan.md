# Kế hoạch: Vá lỗ hổng đổi email + dọn phần BE/FE lệch nhau (2026-10-05)

## Tổng quan

Sáu vấn đề từ đợt rà soát BE↔FE. Mục 1 là lỗ hổng leo thang quyền nên làm và deploy trước, tách riêng. Các mục 3–6 là dọn dẹp, không đổi hành vi người dùng thấy. Mục 2 (sửa SRS/BRD/README) đã xong, chỉ còn kiểm lại ở bước tài liệu cuối.

Danh sách việc chi tiết nằm ở [todo.md](todo.md).

## Lỗ hổng mục 1: đã xác nhận qua code (chưa chạy thử khai thác)

Chuỗi khai thác đọc ra từ code:

1. `POST /api/auth/profile` ([authRoutes.js:809](../server/auth/authRoutes.js)) ghi thẳng `email` mới. Chỉ kiểm định dạng và trùng với `app_users`, không kiểm `hr_employees`, không xác minh, không reset `verifiedEmail`.
2. Ở request kế tiếp, `requireAuth` gọi `resolveUser` ([effectiveUserResolver.js](../server/auth/effectiveUserResolver.js)). Hàm này tìm nhân sự theo email/SĐT hiện tại của tài khoản rồi ghi đè `vaiTro`/`coSo` bằng vai trò trên dòng nhân sự đó.
3. Ai lấy được quyền:
   - TK đã gắn nhân sự (`hrManaged`) hoặc TK nội bộ cũ (`trustedLegacyInternal`): được tin ngay, không cần xác minh.
   - TK Khách có `verifiedEmail = true` (ví dụ đăng nhập Google): qua được `hasVerifiedEmployeeIdentity`, vì cờ này không bị reset khi đổi email.
4. Trở ngại duy nhất: nếu SĐT của TK trỏ tới nhân sự khác thì `findEmployeeByIdentifier` ném `HR_IDENTITY_CONFLICT`. Kẻ tấn công vượt qua bằng cách xóa SĐT qua `POST /api/auth/recovery` với `soDienThoai: ""`. Bước này chỉ cần mật khẩu, và TK chỉ đăng nhập Google thì **không cần gì cả** (`if (current.passwordHash)`).
5. Hệ quả phụ (DoS): nếu nhân sự Quản lý đã có TK web, việc chiếm quyền thất bại, nhưng `findAccountForEmployee` lúc này thấy 2 TK cùng khớp nên ném 409 ở **mọi request của TK Quản lý thật**. Bất kỳ người đăng nhập nào cũng có thể khóa một nhân sự khỏi hệ thống.

Lỗi phụ phát hiện thêm: Quản lý đổi SĐT của TK nhân sự qua trang quản trị ([adminUserRoutes.js:280](../server/auth/adminUserRoutes.js)) gọi `contactChangeService.adminChange(…, 'phone', …)`, nhưng `normalize()` chỉ nhận `'email'` nên luôn trả lỗi 400 `INVALID_CONTACT_FIELD`. Sau khi bỏ đổi SĐT ở recovery, trang quản trị là đường duy nhất, nên phải sửa.

## Quyết định kiến trúc (đã chốt với người dùng 2026-10-05)

- **Email, TK gắn nhân sự (`hrManaged`)**: không được tự đổi. Chỉ Quản lý đổi qua trang quản trị (`adminChange`, đã cập nhật cả `hr_employees`). Ô email trên form hồ sơ chỉ đọc, kèm dòng "Liên hệ Quản lý để đổi email".
- **Email, TK không gắn nhân sự (Khách, nội bộ cũ)**: đổi qua OTP gửi tới địa chỉ mới, dùng lại `contact-change` sau khi đảo điều kiện (hiện API này *chỉ* nhận TK HR). Xác minh xong thì đặt `verifiedEmail = true`, chỉ ghi `app_users`.
- **`POST /api/auth/profile` không bao giờ đổi email nữa**: email gửi lên khác email hiện tại thì trả lỗi, với mã riêng cho TK HR và TK thường.
- **Chốt chặn ở resolver (phòng thủ nhiều lớp)**: TK đã gắn nhân sự `hrRowIndex = X` không bao giờ tự gắn sang nhân sự `Y ≠ X`. Khi khớp sai thì giữ nguyên ràng buộc cũ, không đổi vai trò, ghi log cảnh báo. Lớp này chặn cả những đường ghi email khác mà ta chưa thấy.
- **`POST /api/auth/recovery`**: bỏ hẳn trường `soDienThoai`, chỉ còn email khôi phục.
- **Mục 3**: gỡ các trường thừa khỏi BE, giữ trường nào export hoặc phần tính khác còn dùng. Việc này cũng giảm tải truy vấn (xem sự cố Disk IO 2026-09-28).
- **Mục 4**: gỡ toàn bộ các API không còn giao diện, kể cả luồng đăng ký nhân sự bằng OTP.

## Đồ thị phụ thuộc

```
T0 Kiểm tra DB đã bị khai thác chưa (chỉ đọc)  ── song song với T1
T1 Chốt resolver ─┐
T2 /profile chặn đổi email ─┬─ T4 FE hồ sơ (cần T2 + T3)
T3 contact-change cho TK thường ─┘
T5 recovery bỏ SĐT        (độc lập)
T6 sửa admin đổi SĐT HR   (độc lập; nên xong trước khi deploy T5)
        │
   [Checkpoint 1 → deploy riêng bản vá bảo mật]
        │
T7–T9 gỡ API chết      (độc lập nhau, làm song song được)
T10–T12 gỡ trường thừa (độc lập nhau; T10 đụng routes.js giống T7 nên làm tuần tự)
T13 gỡ nhánh dự phòng FE (sau T10–T12 để kiểm chung một lượt)
T14 dropdown trạng thái (độc lập, XS, chen vào lúc nào cũng được)
T15 tài liệu + memory (cuối cùng)
```

## Danh sách việc

### Giai đoạn 1: Vá bảo mật (deploy riêng)
- [ ] T0: Truy vấn chỉ đọc xem đã có TK nào bị gắn sai nhân sự chưa
- [ ] T1: Resolver không gắn lại TK sang nhân sự khác
- [ ] T2: `POST /api/auth/profile` không đổi email
- [ ] T3: `contact-change` dành cho TK không gắn nhân sự
- [ ] T4: Form hồ sơ: email chỉ đọc (HR) / đổi qua OTP (TK thường)
- [ ] T5: `POST /api/auth/recovery` bỏ trường SĐT
- [ ] T6: Sửa lỗi Quản lý đổi SĐT TK nhân sự

### Checkpoint 1: Bảo mật
- [ ] Test auth + frontend xanh; các kịch bản khai thác thành test và đều bị chặn
- [ ] Người dùng duyệt, commit, deploy riêng

### Giai đoạn 2: Gỡ API không còn giao diện
- [ ] T7: Gỡ `/api/search` + export `search.results`
- [ ] T8: Gỡ `/api/customer-product-top`
- [ ] T9: Gỡ `register/{channels,send-otp,verify}`, `hr/telegram/link-status`, `shipment/lifecycle/lookup`

### Giai đoạn 3: Gỡ trường BE thừa + nhánh FE cũ
- [ ] T10: Tổng quan: bỏ KPI "hôm nay", `activeProducts`, `inventoryValueCategoryCount`, bộ lọc `ov*`
- [ ] T11: Hóa đơn: bỏ `returnsCount`, `totalReturns`, `periodGrossRevenue` (chỉ ở đầu ra)
- [ ] T12: Hàng hóa/tồn kho: bỏ `stockByCategory`, `stockValueByCategory`, `newlyImported.{topByRevenue,salesByCategory,countByCategory}`
- [ ] T13: FE: bỏ nhánh `d.topSellingProducts`, `d.days`

### Checkpoint 2: Dọn dẹp
- [ ] Toàn bộ test xanh; mọi tab hiển thị đúng trên preview; mọi export chạy

### Giai đoạn 4: Hoàn thiện
- [ ] T14: Dropdown "Toàn bộ đơn hàng" thêm "Sự cố", "Đã hủy"
- [ ] T15: Cập nhật README/SRS/BRD + memory

### Checkpoint 3: Hoàn tất
- [ ] Mọi tiêu chí đạt, sẵn sàng review

## Rủi ro và cách giảm

| Rủi ro | Mức | Cách giảm |
|---|---|---|
| Đã có người khai thác trước khi vá | Cao | T0 chạy trước tiên. Nếu thấy TK gắn sai, Quản lý khôi phục tay trước khi deploy T1 (T1 sẽ "đóng băng" ràng buộc hiện tại, kể cả ràng buộc sai). |
| T1 chặn nhầm trường hợp hợp lệ (Quản lý sửa email nhân sự trong `hr_employees` rồi TK khớp dòng mới) | TB | `adminChange` sửa đúng dòng `hrRowIndex` nên ràng buộc không đổi. Test riêng kịch bản này. Khi khớp sai thì chỉ log, không khóa TK. |
| Gỡ khóa quyền khỏi `featureRegistry` (T7–T9) làm hỏng quyền đã lưu trong JSON store | TB | Kiểm `resolvePermissions` bỏ qua khóa lạ; viết test với quyền lưu có khóa cũ. |
| `periodGrossRevenue`/`totalReturns` là bước trung gian của Doanh thu = bán − trả | Cao | T11 chỉ bỏ khỏi đối tượng trả về, giữ phép tính. So số Doanh thu/Thực thu trước và sau trên cùng dữ liệu test. |
| Export hoặc báo cáo Telegram còn đọc trường sắp gỡ | TB | Mỗi task grep toàn `server/`, kể cả `exportService.js`, `telegram/` và test, trước khi xóa. |
| Thử thách OTP `contact-change` lưu trong `Map` ở bộ nhớ | Thấp | Hệ thống chạy 1 instance. Khởi động lại thì người dùng chỉ phải xin OTP mới. Ghi chú, không sửa. |
| Nhiều commit trước vẫn chưa xác nhận deploy | TB | Bản vá Giai đoạn 1 là commit riêng, không phụ thuộc migration nào, deploy được độc lập. |

## Câu hỏi còn mở

- T0 cần quyền đọc DB production. Bạn chạy câu SQL tôi soạn, hay cấp chuỗi kết nối chỉ đọc?
- TK Khách xác minh OTP một email trùng email nhân sự (tức họ đúng là nhân sự đó) thì resolver sẽ gắn TK vào nhân sự. Đây là hành vi "tự nhận diện" hợp lệ. Giữ nguyên, hay muốn Quản lý duyệt?
- Khi T1 phát hiện TK khớp sai nhân sự, ngoài ghi log có cần báo chuông cho Quản lý không?
