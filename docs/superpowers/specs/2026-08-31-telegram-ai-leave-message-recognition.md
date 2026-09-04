# Spec: Bot Telegram nhận dạng tin nhắn xin nghỉ bằng AI (một tin nhắn tự nhiên)

> Trạng thái: DỰ THẢO — dịch vụ AI proxy đã xác định là **xKiro** (https://xkiro.com), base URL/hợp đồng API và model đã chốt (mục 4, mục 8). Sẵn sàng chuyển sang Phase Plan.
> Bối cảnh liên quan: `docs/superpowers/plans/2026-08-22-gemini-one-message-leave-request.md` (kế hoạch cũ dùng Gemini, dở dang, chỉ tái sử dụng phần logic không phụ thuộc nhà cung cấp), `CHINH-SACH-NGHI-PHEP.md` (chính sách nghỉ phép), `docs/superpowers/specs/2026-08-22-hr-leave-sessions-and-submission-time-design.md` (thiết kế buổi/Sáng-Chiều hiện hành).

## 1. Mục tiêu

Thay luồng phỏng vấn từng bước hiện tại của bot Telegram HR bằng luồng **một tin nhắn tự nhiên**: nhân viên gõ một câu xin nghỉ, AI trích xuất ý định + thời gian, bot tự tính buổi/ngày theo quy tắc mặc định, hỏi lại đúng phần còn thiếu (nếu có), rồi hiển thị một màn hình xác nhận duy nhất trước khi ghi vào Google Sheet — giữ nguyên toàn bộ hành vi ghi Sheet, cờ "nghỉ gấp"/"vi phạm", realtime SSE và các lệnh `/start`, `/lienket`, `/huy` đang có.

**Người dùng:** nhân viên đã liên kết tài khoản Telegram với tài khoản web (qua `/lienket <mã>`), nhắn tin trực tiếp cho bot.

**Thành công =** nhân viên gõ đúng 1 câu tự nhiên, nhận được tóm tắt chính xác thời gian nghỉ (kể cả khi phải suy ra mặc định), xác nhận, và một dòng được ghi đúng vào sheet "Yêu cầu nghỉ phép" — không còn phải trả lời 6 câu hỏi tuần tự như hiện tại.

## 2. Phạm vi

**Trong phạm vi:**
- Thay đổi cách bot xử lý tin nhắn tự do từ nhân viên đã liên kết (thay STEP machine bằng pipeline AI-extract → resolve → clarify-nếu-thiếu → confirm → submit).
- Thêm tích hợp AI proxy đa nhà cung cấp (thay vì hard-code Gemini).
- Thêm cột lưu tin nhắn gốc (và các tin nhắn làm rõ, nếu có) vào Sheet để HR đối soát.
- Cập nhật câu trả lời `/start`, `/xinnghi` cho phù hợp luồng mới.

**Ngoài phạm vi:**
- Mở rộng bot cho chi nhánh Sài Gòn (giới hạn hiện tại giữ nguyên).
- Thay đổi chính sách nghỉ phép, ngưỡng giờ "nghỉ gấp"/"vi phạm" (07:45/12:30), quy trình phê duyệt.
- Giao diện web quản lý nghỉ phép (không đổi).

## 3. Bối cảnh kỹ thuật (đã khảo sát trong repo)

- Bot chạy Node.js, polling (`node-telegram-bot-api`), không cần webhook công khai — file `server/telegram/hrTelegramBot.js`.
- Business logic thuần túy (không phụ thuộc Telegram) nằm ở `server/hr/hrLeaveService.js`: `computeDurationSessions`, `getSessionStartTime` (Sáng=07:45, Chiều=12:30), `computeSubmissionViolation`, `computeIsUrgent`, `parseVietnameseDate`, `formatLeaveBoundary`, `resolveSenderIdentity`.
- Ghi Sheet qua `server/hr/hrLeaveRepository.js` (`LEAVE_SCHEMA` 22 cột, sheet "Yêu cầu nghỉ phép") → `server/sheets/hrSheetsClient.js` (Google Sheets API, service account).
- Trạng thái hội thoại theo `chat_id` được lưu bền vững qua `server/telegram/conversationStore.js` (file JSON, sống sót qua restart, hết hạn sau 60 phút).
- Cấu hình tập trung tại `server/config.js`, secret nằm trong `server/.env` (gitignored) / Firebase secret khi deploy — không hardcode.
- **Tài sản tái sử dụng được từ nhánh cũ `codex/gemini-one-message-leave`** (chưa merge, không phụ thuộc Gemini): thuật toán trong `server/hr/leaveMessageResolver.js` — quy tắc suy luận buổi/ngày mặc định, xử lý "chỉ nêu số ngày" (chọn buổi đầu tiên cách thời điểm nhắn tin ≥ N giờ), và các mã lỗi (`NOT_LEAVE_REQUEST`, `LOW_CONFIDENCE`, `INVALID_DATE`, `CONTRADICTORY_INTERVAL`, `MISSING_LEAVE_INTERVAL`, `UNSUPPORTED_DURATION_UNIT`) — đây là logic thuần Vietnamese-domain, không gọi AI, nên giữ gần như nguyên vẹn, chỉ đổi tên module cho trung lập nhà cung cấp.

## 4. Hợp đồng dữ liệu AI extraction (provider-agnostic)

AI chỉ **trích xuất**, không quyết định — mọi phép tính ngày/buổi/tổng buổi do resolver thuần túy đảm nhiệm (không bao giờ tin trực tiếp ngày/buổi do AI tự tính).

```
Input:  text (tin nhắn nhân viên, có thể là tin gốc nối với các tin làm rõ trước đó)
        context: { messageTime: ISO string giờ Bangkok, timeZone: 'Asia/Bangkok' }

Output: {
  intent: 'leave_request' | 'other',
  start_date: 'YYYY-MM-DD' | null,
  start_session: 'Sáng' | 'Chiều' | null,
  end_date: 'YYYY-MM-DD' | null,
  end_session: 'Sáng' | 'Chiều' | null,
  duration_value: number | null,        // số nguyên dương
  duration_unit: 'day' | 'session' | null,
  reason: string | null,
  handover: string | null,
  reason_declined: boolean,             // true nếu nhân viên chủ động nói "không có lý do"
  handover_declined: boolean,           // true nếu nhân viên chủ động nói "không cần bàn giao"
  confidence: number                    // 0..1
}
```

- Prompt yêu cầu AI: quy đổi "hôm nay/ngày mai/ngày kia" ra `YYYY-MM-DD` theo `messageTime`; không tự bịa lý do/người bàn giao/ngày; `intent: other` cho tin nhắn không liên quan; phân biệt "để trống vì không nói" (`null`) với "chủ động từ chối cung cấp" (`*_declined: true`).
- **Giao thức gọi AI proxy — ĐÃ XÁC NHẬN (nhà cung cấp: xKiro, https://xkiro.com, https://docs.xkiro.com/):**
  ```
  POST https://api.xkiro.com/v1/chat/completions
  Authorization: Bearer {AI_LEAVE_API_KEY}
  Content-Type: application/json
  Body: {
    model: "{AI_LEAVE_API_MODEL}",     // bắt buộc dạng "vendor/model", vd "deepseek/deepseek-chat-v3.1" (miễn phí),
                                        // "deepseek/deepseek-v4-flash" (miễn phí), "google/..." (Gemini), "openai/..." (ChatGPT)
                                        // — không dùng tên trần không có prefix nhà cung cấp
    messages: [{ role: "system", content: "<prompt>" }, { role: "user", content: text }],
    response_format: { type: "json_object" },
    temperature: 0
  }
  → Response chuẩn OpenAI Chat Completions:
  { "choices": [{ "message": { "role": "assistant", "content": "<chuỗi JSON đúng schema trên>" } }], "usage": {...} }
  ```
  xKiro là gateway tương thích chuẩn OpenAI/Anthropic, route 1 key tới nhiều hãng (DeepSeek/Gemini/ChatGPT/Claude/Qwen/Mistral/...). **Model đã chọn sau smoke test thực tế: `deepseek/deepseek-v4-pro`** (free tier trên xKiro). Model này đạt 5/5 câu Success Criteria và 10/10 câu mở rộng; do free tier có độ trễ quan sát khoảng 5–28 giây nên timeout được đặt 30 giây. `deepseek/deepseek-v4-flash-0731` hiện là model trả phí, còn các model free Mistral/Qwen đã thử đều sai ít nhất một case bắt buộc. Có thể đổi model cùng proxy mà không cần đổi code — chỉ đổi `AI_LEAVE_API_MODEL`.
- Lỗi provider (timeout, non-2xx, JSON không hợp lệ, thiếu field) → không ghi Sheet, không tiết lộ key/response thô ra Telegram hay log, báo nhân viên thử lại sau.

## 5. Quy tắc suy luận mặc định thời gian nghỉ (tái sử dụng từ resolver cũ)

Áp dụng theo thứ tự ưu tiên — thời gian tường minh luôn thắng mặc định:

| # | Tin nhắn nêu | Suy luận | Ví dụ |
|---|---|---|---|
| 1 | Ngày rõ, **không nêu buổi** | Mặc định **Sáng → Chiều** ngày đó (trọn ngày) | "Em xin phép nghỉ ngày mai ạ" → Sáng mai đến Chiều mai |
| 2 | Buổi rõ, **không nêu ngày** | Mặc định ngày = **hôm nay** (ngày gửi tin) | "Em xin nghỉ buổi sáng ạ" → Sáng hôm nay |
| 3 | Chỉ nêu 1 buổi cụ thể (vd "chiều mai"), không nêu điểm kết thúc | Kết thúc = **cùng buổi đó** (nửa ngày) — KHÔNG tự mở rộng thành trọn ngày vì buổi đã được nêu rõ | "Em xin nghỉ chiều mai" → Chiều mai đến Chiều mai (1 buổi) |
| 4 | Nêu khoảng ngày (vd "từ mai đến ngày kia"), không nêu buổi đầu/cuối | Bắt đầu Sáng ngày đầu, kết thúc Chiều ngày cuối (áp quy tắc #1 cho cả 2 đầu) | "nghỉ từ mai đến ngày kia" → Sáng mai đến Chiều ngày kia |
| 5 | Nêu số ngày/buổi, **không nêu ngày bắt đầu** | Bắt đầu ở buổi hợp lệ đầu tiên cách thời điểm gửi tin ≥ N giờ (mặc định N=10, dùng lại `CONFIG.HR_URGENT_NOTICE_HOURS_THRESHOLD` đang có, không thêm biến cấu hình mới) | "Em xin nghỉ 3 ngày" gửi 10h sáng nay → bắt đầu Sáng mai, đủ 6 buổi |
| 6 | Ngày/buổi tường minh **và** số ngày/buổi cùng lúc, khớp nhau | Dùng ngày/buổi tường minh, bỏ qua số ngày (chỉ để đối chiếu, không override) | — |
| 7 | Không có bất kỳ mốc thời gian nào (không ngày/buổi/số ngày) | **Không suy đoán** — hỏi lại (mục 6) | "Em xin nghỉ ạ" (không kèm gì khác) |
| 8 | Ngày/buổi kết thúc trước ngày/buổi bắt đầu, hoặc ngày không hợp lệ (vd 31/02) | **Không tự sửa** — hỏi lại xác nhận khoảng thời gian | — |
| 9 | Ngày nêu ra đã ở quá khứ so với thời điểm gửi tin | Không tự động từ chối; hỏi xác nhận lại (có thể là xin nghỉ hồi tố theo Điều 9 chính sách) | "Em xin nghỉ hôm qua" |
| 10 | Độ tin cậy AI thấp (`confidence` dưới ngưỡng, đề xuất 0.75 giữ như bản cũ) dù trông giống xin nghỉ | Coi như chưa rõ — hỏi lại, không tự ghi nhận | — |
| 11 | Tin nhắn không phải xin nghỉ (`intent: other`) | Không tạo yêu cầu; trả lời ngắn gọn hướng dẫn cách xin nghỉ (không báo lỗi) | Nhân viên chat ngoài lề với bot |
| 12 | Đang chờ xác nhận (CONFIRM) mà nhân viên gửi thêm 1 tin nhắn tự do (không bấm nút) | Tin mới thay thế bản nháp đang chờ (chạy lại pipeline), không tạo luồng song song | Gửi "mai" rồi gửi tiếp "à quên, cả ngày luôn ạ" |

Các dòng #7–#12 là **đề xuất bổ sung** theo yêu cầu "đề xuất thêm các trường hợp tương tự" — cần người duyệt spec xác nhận trước khi đưa vào Phase Plan; có thể bỏ bớt nếu không cần thiết.

## 6. Luồng hội thoại (thay STEP machine cũ)

Trạng thái lưu trong `conversationStore` theo `chat_id`:

```
IDLE                     → chưa có yêu cầu đang xử lý (mặc định)
AWAITING_CLARIFICATION   → đã trích xuất một phần, còn thiếu 1 trong 3 nhóm: TIME | REASON | HANDOVER
CONFIRM                  → đã đủ thông tin, chờ nhân viên bấm "Xác nhận"/"Hủy"
```

**Pipeline chạy mỗi khi nhận tin nhắn tự do từ chat đã liên kết** (không phải lệnh `/...`):

1. Ghép tin nhắn mới vào lịch sử tin nhắn của yêu cầu đang xử lý (nếu có draft `AWAITING_CLARIFICATION`), hoặc bắt đầu draft mới (nếu `IDLE` hoặc đang `CONFIRM` — tin mới thay thế draft `CONFIRM` cũ, quy tắc #12).
2. Gọi AI extract trên toàn bộ văn bản đã ghép + `messageTime` gốc (thời điểm tin đầu tiên — không đổi mốc "nghỉ gấp"/"vi phạm" theo tin làm rõ gửi sau).
3. Chạy resolver thuần túy (mục 5) để suy ra khoảng thời gian nghỉ từ output AI.
4. Kiểm tra tuần tự 3 nhóm bắt buộc:
   - **TIME**: nếu resolver báo thiếu/không hợp lệ (case #7, #8, #10 ở mục 5) → hỏi lại, nêu ví dụ cụ thể, lưu `AWAITING_CLARIFICATION` field=TIME.
   - **REASON**: nếu `reason` là `null` và `reason_declined` không phải `true` → hỏi "Lý do nghỉ là gì? (Nếu không có, trả lời 'không có')", field=REASON.
   - **HANDOVER**: tương tự, hỏi "Người bàn giao công việc là ai? (Nếu không cần, trả lời 'không có')", field=HANDOVER.
5. Khi cả 3 nhóm đã đủ (có giá trị hoặc được từ chối hợp lệ) → tính cờ `co_nghi_gap` (nghỉ gấp), `co_vi_pham` (gửi trễ) như hiện tại, hiển thị màn hình tóm tắt — **có ghi chú rõ giá trị nào là mặc định tự suy ra** (vd "(mặc định: nghỉ cả ngày)") để nhân viên phát hiện sai sót trước khi xác nhận — kèm nút **Xác nhận / Hủy** (giữ nguyên cơ chế inline keyboard, dedup callback, idempotency hiện tại).
6. Xác nhận → ghi Sheet đúng schema hiện tại + cột mới lưu toàn bộ tin nhắn gốc/làm rõ; Hủy → xóa draft.

**An toàn chống lặp vô hạn:** nếu cùng một field bị hỏi lại quá 3 lần liên tiếp không giải quyết được, bot dừng hỏi, gợi ý `/huy` để hủy và liên hệ trực tiếp quản lý/HR.

**Không đổi:** `/start`, `/lienket <mã>`, `/huy` giữ nguyên hành vi; chỉ cập nhật nội dung hướng dẫn của `/start`/`/xinnghi` cho khớp luồng 1 tin nhắn (ví dụ mẫu câu thay vì yêu cầu gõ `/xinnghi` trước).

## 7. Thay đổi dữ liệu (Google Sheet)

- Thêm cột cuối **"Tin nhắn"** (`tin_nhan`) vào `LEAVE_SCHEMA` trong `server/hr/hrLeaveRepository.js` — **thêm vào cuối, không chèn giữa**, để không phá vỡ vị trí 22 cột hiện có và dữ liệu lịch sử.
- Giá trị lưu = toàn bộ tin nhắn gốc + các tin làm rõ, nối theo thứ tự gửi (ví dụ phân tách bằng ` | `), phục vụ HR đối soát khi có tranh chấp diễn giải AI.
- Cập nhật độ rộng cột trong `server/hr/hrLeaveExportService.js` và header trong `server/scripts/setupHrSheet.js` (không chạy script này lên sheet thật trong lúc phát triển).

## 8. Cấu hình mới (`server/config.js`)

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `AI_LEAVE_API_KEY` | Có | Secret (key xKiro của người dùng, dạng `sk-xt-...`), chỉ trong `.env`/secret manager, không log, không commit. Người dùng đã dán key trực tiếp vào chat và chủ động quyết định tiếp tục dùng key đó (đã được lưu ý rủi ro lộ key, người dùng chấp nhận vì đây là key dùng model free của xKiro). |
| `AI_LEAVE_API_BASE_URL` | Có | `https://api.xkiro.com/v1` — đã xác nhận từ docs xKiro. |
| `AI_LEAVE_API_MODEL` | Có | `deepseek/deepseek-v4-pro` (free tier trên xKiro) — đã chốt sau smoke test tiếng Việt. Có thể đổi sang model khác cùng proxy chỉ bằng cách sửa biến này, không cần đổi code. |
| `AI_LEAVE_API_TIMEOUT_MS` | Không | Mặc định 30000; free tier DeepSeek V4 Pro có độ trễ quan sát khoảng 5–28 giây. |
| `HR_TIME_ZONE` | Không | Mặc định `Asia/Bangkok`, dùng cho quy đổi ngày tương đối. |

Không thêm biến ngưỡng "mặc định 10 giờ" riêng — tái sử dụng `CONFIG.HR_URGENT_NOTICE_HOURS_THRESHOLD` đã có (đơn giản hóa so với bản kế hoạch Gemini cũ, vốn định nghĩa `HR_DURATION_DEFAULT_NOTICE_HOURS` trùng giá trị mặc định).

## 9. Testing Strategy

- Giữ nguyên: `node --test` (Node test runner), chạy từ `server/`.
- Test bảng dữ liệu (table-driven) cho resolver: toàn bộ case ở mục 5 (đặc biệt #1–#4, #7–#9) — mô phỏng theo `leaveMessageResolver.test.js` của nhánh cũ, không phụ thuộc AI thật.
- Test adapter AI: mock `fetch`, không gọi mạng thật; phủ các lỗi timeout/HTTP lỗi/JSON hỏng.
- Test tích hợp bot: giả lập `node-telegram-bot-api`, kịch bản: 1 tin đủ thông tin → CONFIRM ngay; thiếu buổi → mặc định không hỏi; thiếu hoàn toàn thời gian → hỏi lại đúng 1 câu; nhân viên trả lời "không có" cho lý do/bàn giao → lưu rỗng, không hỏi lặp; sửa draft trước khi xác nhận; lỗi provider → không ghi Sheet.
- Không được gọi AI proxy thật hoặc Google Sheets thật trong test tự động.

## 10. Boundaries

- **Luôn làm:** chạy `node --test` trước khi commit; không bao giờ ghi dòng Sheet khi thời gian nghỉ chưa được giải quyết chắc chắn; không log/lộ API key hoặc response thô của AI.
- **Hỏi trước:** đổi ngưỡng độ tin cậy AI (0.75) hoặc ngưỡng "nghỉ gấp" 10 giờ; đổi số lần hỏi lại tối đa trước khi bỏ cuộc; chạy `setupHrSheet.js` lên sheet thật.
- **Không bao giờ:** tự đoán và ghi Sheet khi resolver báo thiếu/mâu thuẫn thời gian; hardcode API key/base URL vào code; đổi vị trí 22 cột hiện có trong `LEAVE_SCHEMA`; mở rộng sang chi nhánh Sài Gòn trong phase này.

## 11. Success Criteria

- [ ] Nhân viên gõ "Em xin phép nghỉ ngày mai ạ" → bot tóm tắt đúng "Sáng ngày mai → Chiều ngày mai" và ghi đúng 1 dòng khi xác nhận.
- [ ] Nhân viên gõ "Em xin nghỉ buổi sáng" → mặc định ngày hôm nay, không hỏi thêm về buổi/ngày.
- [ ] Nhân viên gõ "Em xin nghỉ ạ" (không có mốc thời gian) → bot hỏi lại đúng 1 câu về thời gian, không hỏi các câu khác chưa cần thiết.
- [ ] Nhân viên không nêu lý do → bot hỏi lý do; trả lời "không có" → lưu lý do rỗng, không hỏi lại lần 2.
- [ ] Toàn bộ 22 cột hiện có trong Sheet giữ nguyên vị trí; cột "Tin nhắn" là cột cuối cùng mới.
- [ ] AI proxy lỗi/timeout → không ghi Sheet, nhân viên nhận thông báo thử lại, log không chứa key.
- [ ] `node --test` chạy toàn bộ (bao gồm test resolver/adapter/bot mới) không cần mạng thật.

## 12. Open Questions (cần trả lời trước khi chuyển sang Phase Plan)

1. ~~Base URL và tên model thực tế của dịch vụ AI proxy~~ — **ĐÃ XÁC NHẬN**: nhà cung cấp là xKiro, base URL `https://api.xkiro.com/v1`, endpoint `/chat/completions`, model đã chọn `deepseek/deepseek-v4-pro` (free tier, đã smoke test tiếng Việt).
2. ~~Định dạng response~~ — **ĐÃ XÁC NHẬN**: đúng chuẩn OpenAI Chat Completions, JSON nằm trong `choices[0].message.content`.
3. Có giới hạn rate-limit/quota nào của xKiro cần tính đến cho model free đã chọn (số request/phút, có bị hạ ưu tiên khi dùng free tier không) — cần tra `xkiro.com` phần "Access tiers" hoặc dashboard sau khi đăng nhập.
4. Ngưỡng độ tin cậy 0.75 và số lần hỏi lại tối đa (đề xuất 3) có phù hợp hay cần điều chỉnh theo thực tế dùng thử — đặc biệt vì model DeepSeek free có thể kém chính xác hơn GPT/Gemini trả phí khi trích xuất tiếng Việt, nên thử nghiệm thực tế trước khi chốt ngưỡng.
5. Các đề xuất bổ sung ở mục 5 (dòng #7–#12) có cần cắt bớt để giảm phạm vi phase đầu tiên không, hay giữ đủ ngay từ đầu?
