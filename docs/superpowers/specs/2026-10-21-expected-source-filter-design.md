# Dropdown Nguồn — Dự kiến hàng về

Ngày 21/10/2026. Thiết kế được người dùng duyệt trong chat ("Ok"). Đây là bổ sung thay yêu cầu không thêm bộ lọc nguồn của đợt CONT TKS1 trước đó; chưa deploy.

- Thêm select cùng kiểu Cont/Trạng thái, đứng trước Cont. Mặc định "Tất cả nguồn" (giá trị rỗng), chọn đơn trong YIWU, VK-DUNG, HÀ BẮC, SD, GDONG, KHÁC, CONT TKS1, đúng thứ tự. Hiện đủ bảy lựa chọn dù một nguồn chưa có dòng trong snapshot.
- Lọc chính xác `row.sheetName`, kết hợp AND với Cont, Trạng thái và tìm kiếm đang có. Đổi nguồn về trang 1, cập nhật bảng/KPI/nhãn số dòng; giữ các bộ lọc khác và lựa chọn nguồn khi render lại.
- Tận dụng dữ liệu đã nạp để lọc tại trình duyệt như hai dropdown cũ; xuất Excel/HTML và metadata chọn trường nhận thêm tham số `source`, áp cùng điều kiện trước xuất. HTML xuất ghi nguồn trong mô tả bộ lọc.
- Danh sách cố định bảy option trong markup là phương án chọn: thay đổi nhỏ, luôn có đủ nguồn. Suy danh sách từ dòng dữ liệu không bảo đảm nguồn rỗng vẫn có lựa chọn; thêm metadata/API chỉ cho danh sách hiện tại là không cần thiết.
- Không đổi snapshot/job, product_report, API đọc, schema, dependency, endpoint, quyền, logic tìm kiếm hoặc cột bảng. Không ghi Sheets/DB production, không push/deploy; làm trên main theo chỉ dẫn hiện có.
- Kiểm chứng: kết hợp các bộ lọc/tìm kiếm, nguồn rỗng, reset phân trang/giữ lựa chọn, quyền cũ, file XLSX/HTML thực sự chỉ có dòng nguồn đã chọn, các lựa chọn cột cũ. Kiểm tra trình duyệt desktop/mobile/sáng/tối bằng fixture; test liên quan rồi toàn bộ npm test trong môi trường cách ly DB thật.
