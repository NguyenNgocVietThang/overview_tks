# Design: Đồng thuận 2/3 model xKiro cho nhận dạng tin nhắn xin nghỉ

> Trạng thái: Đã duyệt thiết kế hội thoại ngày 31/08/2026; chờ duyệt tài liệu trước Phase Plan.
> Phạm vi kế thừa: `2026-08-31-telegram-ai-leave-message-recognition.md`.

## 1. Mục tiêu

Tăng độ tin cậy của bước AI extraction bằng cách gọi song song ba model free trên cùng xKiro API. Bot chỉ sử dụng kết quả khi ít nhất hai model đồng thuận về ý định và khoảng nghỉ đã được resolver xác nhận. Không có đồng thuận thì không ghi Google Sheet.

## 2. Model và cấu hình

Thêm biến tùy chọn `AI_LEAVE_API_MODELS`, nhận danh sách model cách nhau bằng dấu phẩy. Bộ model triển khai ban đầu:

1. `deepseek/deepseek-v4-pro`
2. `qwen/qwen3-max:free`
3. `mistralai/mistral-small-2603`

Khi `AI_LEAVE_API_MODELS` trống, hệ thống dùng `AI_LEAVE_API_MODEL` hiện có để giữ tương thích ngược. Trước khi chạy bot thật, phải gọi smoke test để xác nhận từng model vẫn khả dụng trên free tier; model trả lỗi entitlement không được xem là một phiếu hợp lệ.

Giữ `AI_LEAVE_API_TIMEOUT_MS=30000` cho từng request và confidence threshold `0.75`.

## 3. Kiến trúc

`leaveAiExtractor` tiếp tục chịu trách nhiệm gọi một model và xác thực JSON schema. Một module consensus mới điều phối ba lời gọi song song, đo latency nội bộ và không log response thô.

Mỗi extraction `leave_request` chỉ trở thành phiếu hợp lệ sau khi:

- đúng JSON schema;
- confidence từ `0.75` trở lên;
- chạy qua `resolveLeaveMessage` mà không phát sinh lỗi thiếu, sai hoặc mâu thuẫn thời gian.

Phiếu `intent: other` hợp lệ khi đúng schema và đạt confidence threshold; phiếu này không chạy resolver khoảng nghỉ.

## 4. Quy tắc đồng thuận

Khóa đồng thuận gồm:

- `intent`;
- nếu là xin nghỉ: ngày/buổi bắt đầu, ngày/buổi kết thúc và tổng số buổi sau resolver.

Reason và handover không nằm trong khóa vì model có thể diễn đạt khác nhau về chữ nhưng cùng nghĩa. Khi hai phiếu có cùng khóa, hệ thống chọn extraction có confidence cao hơn; nếu confidence bằng nhau thì chọn response hoàn thành sớm hơn. Reason/handover của extraction được chọn đi tiếp vào pipeline hiện tại, và bot vẫn hỏi lại nếu thiếu.

Ngay khi có hai phiếu đồng thuận, hệ thống trả kết quả và hủy request còn lại nếu còn chạy. Nếu hai phiếu đầu bất đồng thì chờ phiếu thứ ba. Một model lỗi, timeout, response sai schema, confidence thấp hoặc resolver từ chối không được tính là phiếu.

Nếu hết các request mà không có hai phiếu đồng thuận, module trả lỗi an toàn `AI_LEAVE_NO_CONSENSUS`. Bot thông báo chưa phân tích chắc chắn và yêu cầu nhân viên diễn đạt lại; conversation không được chuyển sang `CONFIRM` và không ghi Sheet.

## 5. An toàn và quan sát vận hành

- Không log hoặc hiển thị `AI_LEAVE_API_KEY`, Authorization header hay response thô của bất kỳ model nào.
- Log vận hành chỉ được chứa tên model, mã lỗi đã chuẩn hóa, latency và trạng thái valid/invalid/agree; không chứa nội dung tin nhắn hoặc JSON extraction.
- Không thay đổi confidence threshold, số lần hỏi lại hoặc vị trí 23 cột của `LEAVE_SCHEMA`.
- Không ghi Sheet nếu TIME thiếu/mâu thuẫn hoặc ensemble không đạt 2/3.
- Polling bot thật chỉ khởi động sau khi kiểm tra không có instance khác dùng cùng Telegram token.
- Dòng Sheet thật chỉ được tạo sau khi người dùng gửi tin từ tài khoản Telegram đã liên kết và tự bấm **Xác nhận**.

## 6. Testing

Test tự động dùng mock, không gọi mạng hoặc Google Sheet thật:

- Hai model đồng thuận sớm: trả kết quả, không chờ model thứ ba.
- Hai model đầu bất đồng, model thứ ba quyết định đa số.
- Chọn confidence cao hơn, latency là tie-break.
- Một model timeout/lỗi nhưng hai model còn lại đồng thuận.
- Response sai schema, confidence thấp hoặc resolver lỗi không được tính phiếu.
- Không đạt 2/3 trả `AI_LEAVE_NO_CONSENSUS` và không ghi Sheet.
- Fallback một model khi `AI_LEAVE_API_MODELS` trống.
- Không làm lộ key/response thô trong lỗi hoặc log.

Sau khi test mock đạt, smoke test thật gọi ba model bằng tin nhắn không nhạy cảm để xác nhận availability, latency và consensus. Sau đó khởi động bot polling nền; người dùng thực hiện smoke test Telegram và xác nhận để ghi một dòng Sheet thật.

## 7. Ngoài phạm vi

- Không thêm model trả phí hoặc tự động mua quota.
- Không dùng một model thứ tư làm judge.
- Không thay đổi giao diện web quản lý nghỉ phép, README hoặc SRS.
- Không tự tạo đơn nghỉ giả dưới danh tính nhân viên.
- Không sửa các test Postgres ngoài phạm vi đã biết.

## 8. Tiêu chí hoàn thành

- Ba request được gọi song song và có thể kết thúc sớm khi đạt 2/3.
- Kết quả chỉ đi tiếp khi đồng thuận trên khoảng nghỉ đã resolve.
- Không đồng thuận hoặc thiếu hai phiếu hợp lệ không thể ghi Sheet.
- Test tự động mới và toàn bộ test scoped hiện có đều pass.
- Smoke test xKiro thật xác nhận model hoạt động mà không lộ secret/raw response.
- Bot thật nhận tin nhắn từ tài khoản liên kết, hiển thị confirmation đúng và chỉ tạo một dòng Sheet sau khi người dùng bấm **Xác nhận**.
