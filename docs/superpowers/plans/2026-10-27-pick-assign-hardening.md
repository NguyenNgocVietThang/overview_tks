# Pick Assignment Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa bốn lỗi Chỉ định hàng theo spec đã duyệt: đúng vị trí/quy cách, số chiếc nguyên, tiền in chính xác và phục hồi sau lỗi mạng.

**Architecture:** Service là nơi kiểm tra cuối cùng trong giao dịch khóa theo cơ sở; lưu riêng snapshot vị trí lúc chỉ định và snapshot tiền của dòng gốc. Frontend đọc snapshot khi in và đồng bộ trạng thái máy chủ trước khi ghi tiếp sau lỗi mạng.

**Tech Stack:** Node.js 22, CommonJS, Express, PostgreSQL NUMERIC/JSONB, JavaScript thuần, node:test, PGlite và JSDOM hiện có; tiền tính bằng hệ số BigInt/thang thập phân, không thêm dependency.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-27-pick-assign-hardening-design.md`, đã được người dùng duyệt ngày 2026-10-27.
- “số lượng nhặt không có số lẻ”. Số thùng quy đổi vẫn được lẻ.
- “Không dùng dữ liệu giá hoặc tồn gửi từ trình duyệt làm nguồn tin cậy.”
- “Giữ advisory lock theo cơ sở, khóa dòng theo thứ tự ID, version chỉ định, lịch sử trong cùng giao dịch và quyền hiện hành.”
- “Không mở rộng sang giao hàng, nhặt một phần, đối soát Kiot, nhập/chuyển kho hoặc thiết kế lại giao diện.”
- Giữ luật lấy dư tròn thùng hiện hành trong `PickingRules.validate` (dư ít hơn một thùng); yêu cầu số nguyên không thay luật này.
- “Không tự gửi lại lệnh ghi.” Không tự áp migration hoặc ghi DB thật trong quá trình kiểm thử.
- Mọi đường dẫn dưới đây tính từ gốc repository; lệnh test chạy trong `server` trừ khi ghi khác.

## File map và hợp đồng dùng chung

| File | Trách nhiệm |
|---|---|
| `server/public/shared/carton.js`, `carton.test.js` | Chặn lượng chiếc lẻ khi trừ/hoàn; giữ các phép nguyên hiện hành |
| `server/public/shared/pick-rules.js`, `pick-rules.test.js` (mới) | Kiểm lượng nguyên và tổng an toàn, giữ luật tròn thùng |
| `server/pickAssignments/pickAssignmentSnapshot.js`, `.test.js` (mới) | Hàm thuần tạo/kiểm dấu vết vị trí và snapshot tiền |
| `server/db/migrations/0097_order_pick_assignment_snapshots.sql` (mới nếu số còn trống) | Thêm `allocation_snapshot JSONB` nullable vào `order_pick_lines` |
| `server/pickAssignments/pickAssignmentsService.js`, `.test.js` | Tích hợp kiểm tra, snapshot, kiểm hoàn tác dữ liệu cũ |
| `server/pickAssignments/pickAssignmentsRoutes.test.js` | Kiểm hợp đồng lỗi/quyền và giữ tương thích API |
| `server/public/shipment/lifecycle/pick/invoice.js` | Phiếu đọc tiền gốc; phân bổ của mã xuất hiện một lần |
| `server/public/shipment/lifecycle/pick/pick-assign.js`, `pick-assign.css` | Lượng nguyên; trạng thái bận/đồng bộ; nút tải lại |
| `server/test/frontend/lifecycle-pick.test.js` | JSDOM trang thật, phiếu và lỗi mạng |
| Tài liệu cuối Task 6 | Đồng bộ schema/API/nghiệp vụ, kết quả kiểm tra thực tế |

Module snapshot xuất các hàm sau, mọi task sau dùng đúng tên:

```js
// makeAllocationSnapshot(row, plannedQty) -> Object, throws on invalid input
// {schemaVersion:1, codeKey, locationKey, positionVersion, notes,
//  terms:[{perCarton, cartons}], loose, plannedQty, stText, stCartons,
//  pickTerms:[{perCarton, cartons}], excess}
// allocationMatches(snapshot, row) -> boolean
// makeOrderSnapshot(order) -> Object, throws on invalid quantity/money
// {schemaVersion:2, customerName, saleName, saleTelegramId, orderDate,
//  lines:[{productCode, productName, quantity, price, discount, note, amount}],
//  invoiceDiscount, goodsTotal, payable}
// amount / invoiceDiscount / goodsTotal / payable là chuỗi thập phân chuẩn.
// price và discount giữ kiểu nguồn để không phá các consumer cũ.
```

Tạo `pickTerms` và `excess` bằng cách phân tích `carton.pickText(spec, plannedQty)` (cú pháp thùng nguyên nối `+`, phần dư `-N`), không dùng số thùng thập phân làm số chiếc. Tái dùng `tx.lower`/`tx.normalizeLocation` khi tích hợp; module thuần nhận giá trị hoặc dùng cùng phép chuẩn hóa đã đối chiếu.

## Task 1: Bảo toàn số chiếc nguyên

**Files:** sửa `server/public/shared/carton.js`, `server/public/shared/carton.test.js`, `server/public/shared/pick-rules.js`; tạo `server/public/shared/pick-rules.test.js`; sửa validation trong service và test service.

**Interfaces:** giữ export cũ của carton/rules. `deduct` và `restore` trả `null` cho lượng không nguyên/âm/không an toàn; 0 vẫn có kết quả không đổi. Service chuyển kết quả không hợp lệ thành lỗi `VALIDATION` khi tạo, `STOCK_CHANGED` khi dữ liệu cũ không thể ghi an toàn.

- [ ] Thêm regression thuần và service: từng đầu vào 0.4, 0.6, âm, Infinity, NaN, vượt MAX_SAFE_INTEGER; dòng gốc 0.4 + 0.6 cùng mã phải bị chặn trước gộp. Với nguồn không hợp lệ, candidates vẫn cho xem bản ghi đang có nhưng trả `eligible:false` và `validationErrors` để UI không gợi ý ghi mới.

```js
test('carton refuses fractional pieces without rounding', () => {
  const spec = C.parseSpec('1Tx100');
  for (const qty of [0.4, 0.6, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(C.deduct(spec, qty), null);
    assert.equal(C.restore(spec, qty), null);
  }
  assert.equal(C.deduct(spec, 30).spec.quantity, 70);
  assert.equal(C.restore(C.parseSpec('1Tx100-30'), 30).spec.quantity, 100);
});
```

- [ ] Chạy `node --test public/shared/carton.test.js public/shared/pick-rules.test.js pickAssignments/pickAssignmentsService.test.js`; xác nhận test mới đỏ vì hành vi đang làm tròn.
- [ ] Thêm guard `Number.isSafeInteger(quantity) && quantity >= 0` trước phép trừ/hoàn; kiểm từng dòng gốc đủ điều kiện nhặt trước gộp và từng allocation trước cộng. Kiểm tổng sau cộng bằng `Number.isSafeInteger(total)`; kiểm mã cần nhặt trước gộp để không bỏ âm/0/lẻ một cách âm thầm. Giữ cách loại VAT/dịch vụ.
- [ ] Trong rules kiểm lượng dòng nguyên dương, pick nguyên không âm (0 là ô chưa chọn), tổng an toàn; giữ kiểm `roundedUp` hiện hành. Rà mọi nơi gọi `restore` và xử lý null trước `.text`.
- [ ] Chạy lại test và `node --test "public/prototypes/order-picking/*.test.js"`; xác nhận các ca nhặt tròn thùng, ST lẻ và lượng 0 không hồi quy. Commit riêng các file Task 1 với message `fix: reject fractional pick quantities`.

## Task 2: Snapshot vị trí và xác nhận theo phiếu

**Files:** tạo module snapshot/test và migration trong file map; sửa service/test, fixture migration của test route nếu dùng DB.

**Interfaces:** `makeAllocationSnapshot(row, plannedQty)` và `allocationMatches(snapshot,row)` như hợp đồng trên; API tiếp tục nhận assignment version cũ, không bắt client gửi dấu vết tồn.

- [ ] Kiểm migration mới nhất trước khi chọn số; nếu 0097 đã tồn tại, chọn số kế tiếp và sửa các tham chiếu kế hoạch/fixture. Thêm SQL tối thiểu:

```sql
ALTER TABLE order_pick_lines ADD COLUMN allocation_snapshot JSONB;
COMMENT ON COLUMN order_pick_lines.allocation_snapshot IS
  'Vi tri va cach lay hang tai thoi diem chi dinh; khac position_snapshot luc xac nhan';
```

- [ ] Thêm test bằng `fixture`, `order`, `assignBody`, `ctx` hiện có; fixture nạp migration mới. Test thiếu cột đỏ ở baseline, đổi vị trí/quy cách đỏ ở service cũ.

```js
test('confirm rejects changed location atomically', async () => {
  const { db, service, notesOf } = await fixture();
  try {
    const { assignment } = await service.assign(ctx(), assignBody([
      { productCode: 'AAA1', positionId: 1, qty: 250 }
    ]));
    await db.query("UPDATE stock_positions SET location='B99', version=version+1 WHERE id=1");
    await assert.rejects(() => service.confirm(ctx(), assignment.id, { version: 1 }),
      { code: 'STOCK_CHANGED', statusCode: 409 });
    assert.equal(await notesOf(1), '3T x 100');
    assert.equal((await service.get(ctx(), { branch:'HN', orderCode:'DH001' })).assignment.status, 'picking');
  } finally { await db.close(); }
});
```

- [ ] Viết module thuần tạo snapshot: lưu cách lấy đã in, nhóm quy cách theo chiếc/thùng, số dư và phiên bản. Matching kiểm identity chuẩn hóa, tồn đủ, từng `pickTerms` còn đủ thùng, tổng chiếc lấy trừ excess bằng plannedQty. Với phần trừ lẻ hiện tại, dùng tổng còn lại và công suất các thùng được chọn để chứng minh lượng in vẫn lấy được; không bắt kết quả gợi ý mới giống chuỗi cũ.
- [ ] Thêm ca `3Tx200+1Tx50`, chỉ định 200 rồi đơn khác lấy hết thùng 50: vẫn hợp lệ. Ca `3Tx100` còn `2Tx100-30`, phiếu lấy 100: vẫn hợp lệ. Đổi 100 thành 50 khi phiếu lấy `1Tx100`: bị chặn. Chuẩn hóa `a 01`/`A01`, dấu nhân/hậu tố không chặn nhầm. Thêm nhiều vị trí, dòng cuối lỗi: tất cả tồn/lịch sử/status không đổi.
- [ ] Service assign lưu `allocation_snapshot` dưới khóa; confirm kiểm snapshot trước deduct, thiếu snapshot trả STOCK_CHANGED và hướng dẫn hủy/chỉ định lại. Không backfill dữ liệu cũ. Giữ lock/version hiện hành.
- [ ] Chạy `node --test pickAssignments/pickAssignmentSnapshot.test.js pickAssignments/pickAssignmentsService.test.js pickAssignments/pickAssignmentsRoutes.test.js`; xác nhận xanh rồi commit `fix: validate pick position snapshots under lock`.

## Task 3: Hoàn tác dữ liệu cũ an toàn

**Files:** `server/pickAssignments/pickAssignmentsService.js`, `.test.js`.

**Interfaces:** `cancel` giữ payload/response; lỗi `STOCK_CHANGED` với thông báo cần đối soát khi `picked_qty` sai hoặc không khớp chênh lệch `spec_before`/`spec_after`.

- [ ] Tạo test bản ghi picking cũ thiếu snapshot: xem/in qua dữ liệu hiện có được, hủy giữ chỗ được, confirm bị chặn. Tạo bản confirmed cũ với picked_qty=0.4/0.6 bằng sửa fixture DB trong bộ nhớ; cancel bị chặn và không cộng tồn.
- [ ] Thêm test confirmed có picked_qty nguyên nhưng không khớp biến động trước/sau, và trường hợp nguyên hợp lệ thiếu snapshot mới. Dữ liệu gốc được giữ sau mọi lần từ chối.

```js
const before = carton.parseSpec(job.spec_before);
const after = carton.parseSpec(job.spec_after);
const picked = Number(job.picked_qty);
if (!Number.isSafeInteger(picked) || picked <= 0 || !before || !after ||
    before.quantity - after.quantity !== picked) {
  throw stockChanged(job, 'cần đối soát số đã nhặt trước khi hoàn tồn');
}
```

- [ ] Chạy test mới xác nhận đỏ, thêm guard trên trước mọi nhánh hoàn (kể cả khôi phục nguyên chuỗi, dòng bị xóa hoặc nhập lại). Kiểm kết quả `restore` không null.
- [ ] Chạy `node --test pickAssignments/pickAssignmentsService.test.js` bao gồm hoàn sau sửa ghi chú, auto-delete/tạo lại, gọi lặp, HN/SG; commit `fix: verify recorded stock delta before pick reversal`.

## Task 4: Snapshot tiền gốc và phiếu không lặp ST

**Files:** module snapshot/test, service/test, `invoice.js`, `server/test/frontend/lifecycle-pick.test.js`.

**Interfaces:** `makeOrderSnapshot(order)` lưu `schemaVersion:2`, `lines` gốc và chuỗi tiền chuẩn; invoice dùng `goodsTotal`, `payable`, `line.amount` cho v2. Legacy thiếu schemaVersion tiếp tục phép tính cũ kèm cảnh báo thiếu dòng gốc.

- [ ] Viết test thuần với dữ liệu sau và ca giá thập phân/chiết khấu khác nhau, dữ liệu tiền không hữu hạn phải trả validation thay vì biến thành 0:

```js
const snap = makeOrderSnapshot({
  invoiceDiscount: 0,
  lines: [
    {productCode:'A', productName:'A', quantity:10000, price:10, discount:0},
    {productCode:'a', productName:'A', quantity:1, price:11, discount:0}
  ]
});
assert.equal(snap.lines.length, 2);
assert.equal(snap.goodsTotal, '100011');
assert.equal(snap.payable, '100011');
```

- [ ] Chạy snapshot test để thấy đỏ. Viết bộ chuyển decimal nội bộ: tách dấu/hệ số/thang từ chuỗi số (hỗ trợ ký pháp mũ Number.toString), căn thang bằng BigInt; tính `(price-discount)*quantity`, cộng tổng và trừ chiết khấu hóa đơn; serialize chuỗi thập phân chuẩn, không đưa BigInt vào JSON.
- [ ] Service tạo snapshot từ `order.lines` nguồn trước gộp; `mergeOrderLines` vẫn phục vụ nhu cầu và UI gợi ý. Không lấy amount/tổng từ body client. Cập nhật expectation cũ về snapshot trong test service; kiểm in lại sau sửa `loadOrder` vẫn tiền cũ.
- [ ] Invoice v2 đọc chuỗi tiền; formatter chấp nhận decimal canonical, hiển thị theo quy tắc tiền nguyên hiện tại, chỉ làm tròn lúc trình bày. Không chuyển sang Number rồi cộng tổng lại. Dùng Set mã đã in: dòng đầu có vị trí/ST, dòng trùng ghi `Vị trí/ST: xem dòng N`, ST để trống. Phiếu cancelled tiếp tục không có ST.
- [ ] Thêm JSDOM dùng `makeAssignment` v2 và `renderPage` hiện có: 2 dòng cùng mã có giá khác, tổng text `100,011`, ST chỉ xuất hiện ở dòng đầu; v1 có cảnh báo; nguồn thay đổi không làm đổi phiếu. Chạy `node --test pickAssignments/pickAssignmentSnapshot.test.js pickAssignments/pickAssignmentsService.test.js test/frontend/lifecycle-pick.test.js`; commit `fix: print original pick order amounts and lines`.

## Task 5: Popup phục hồi khi mạng lỗi

**Files:** `pick-assign.js`, CSS chỉ khi cần trạng thái thông báo/nút tải lại, `server/test/frontend/lifecycle-pick.test.js`.

**Interfaces:** giữ API công khai hiện có; state thêm `needsSync:boolean` và `requestEpoch:number`; khóa ghi khi `busy || needsSync`. Tạo `reloadCurrent(epoch)` đọc candidates/assignment rồi render và cập nhật callback danh sách hiện hành; chỉ áp phản hồi nếu epoch còn khớp.

- [ ] Mở rộng mock `fetchImpl` của `renderPage` để mô phỏng reject trước ghi, commit vào store rồi reject phản hồi, GET đồng bộ reject, JSON hỏng, phản hồi chậm khi đổi đơn. Giữ phân biệt GET với POST để đếm không có POST tự lặp.

```js
// Đặt trong fetchImpl của test, dùng store.posted để kiểm số lần gửi.
if (options.method === 'POST') {
  store.posted.push({url, body: JSON.parse(options.body)});
  store.assignment = makeAssignment('confirmed', {version:2});
  throw new TypeError('Failed to fetch');
}
```

- [ ] Chạy test frontend thấy lỗi bận chưa được giải phóng. Bọc thao tác tạo/xác nhận/hủy/chỉ định lại và tải ban đầu bằng try/catch/finally; chỉ finalizer của epoch hiện tại được sửa state. Lỗi mạng/JSON/5xx khi ghi coi kết quả chưa rõ, bật needsSync và GET trước cho ghi tiếp. HTTP 409 giữ cách tải mới nhất nhưng cũng không kẹt khi GET reject.
- [ ] `api` không nuốt lỗi JSON thành thành công rỗng; thông báo kết nối bằng textContent. Tạo nút `Tải lại` chỉ đọc, cho đóng popup kể cả needsSync. Mở/đóng tăng epoch, đặt busy phù hợp; dữ liệu cũ không ghi đè đơn mới.
- [ ] Mọi ô SL dùng `step=1`; nhập tay kiểm safe integer, không parseInt/làm tròn; giữ bước nút +/- theo thùng hiện có. Hiển thị `validationErrors` từ candidates và khóa tạo mới, vẫn cho xem/hủy bản ghi cũ.
- [ ] Chạy `node --test test/frontend/lifecycle-pick.test.js`: tạo/confirm/cancel/reassign đều hết bận sau reject; GET lỗi thì còn khóa ghi nhưng đóng/tải lại được; commit thành công rồi mất phản hồi hiển thị version mới; không tự lặp POST; đổi đơn chống phản hồi cũ. Commit `fix: recover pick dialog after uncertain network writes`.

## Task 6: Kiểm chứng tích hợp và tài liệu

**Files:** `server/pickAssignments/pickAssignmentsRoutes.test.js`, fixture nếu cần; `README.md`, `server/README.md`, `server/db/SCHEMA.md`, `CURRENT.md`, BRD/SRS, `docs/04-planning/implementation_plan.md`, spec và plan này.

- [ ] Route test dùng migration mới, kiểm API từ chối số lẻ (400 VALIDATION), xác nhận snapshot sai (409 STOCK_CHANGED), quyền cũ và scope cơ sở; bảo đảm readAssignment trả các trường legacy tương thích và snapshot v2 đầy đủ.
- [ ] Chạy kiểm tra tập trung:

```powershell
node --test public/shared/carton.test.js public/shared/pick-rules.test.js
node --test "pickAssignments/*.test.js" test/frontend/lifecycle-pick.test.js
node --test "shipment/orderLifecycle*.test.js" "stockPositions/*.test.js"
node prototype-build.cjs
node --test "public/prototypes/order-picking/*.test.js"
```

- [ ] Dùng browser thật qua công cụ có sẵn với backend fixture không ghi DB thật: popup tạo/confirm/hủy/in lại, Light/Dark, 375px và desktop; kiểm phiếu 2 dòng cùng mã, text lỗi, tải lại, đóng/mở. Đọc skill browser-testing-with-devtools trước bước này. Không gọi thao tác ghi vào hệ thống thật để kiểm thử.
- [ ] Nếu có PostgreSQL thử nghiệm riêng, kiểm hai kết nối giữ cùng vị trí và xác nhận đồng thời; cả hai đơn hợp lệ không trừ quá tồn, lỗi giữa giao dịch rollback. Nếu không có, ghi rõ chưa xác minh đa kết nối; không lấy PGlite thay bằng chứng.
- [ ] Cập nhật schema với cột/migration mới, API với `validationErrors`/snapshot v2 và hành vi lỗi, tài liệu nghiệp vụ với nguyên chiếc/phiếu gốc và legacy; cập nhật CURRENT theo kết quả thực. Xem diff từng file vốn đã bẩn để không commit công việc khác.
- [ ] Chạy `npm test` toàn server, ghi số đạt/lỗi/bỏ qua; lỗi localhost EACCES phải ghi là giới hạn môi trường, không tuyên bố suite xanh. Chạy `graphify update .` tại gốc theo quy tắc repository; kiểm output và thay đổi phát sinh trước stage.
- [ ] Chạy `git diff --check`; đọc diff và kiểm từng hàng nghiệm thu spec, sửa lỗi phát hiện rồi chạy lại nhóm liên quan. Stage bằng đường dẫn cụ thể, commit phần task với message `test: verify pick assignment hardening integration`.
- [ ] Báo người dùng những thay đổi, test đã chạy và giới hạn; nêu áp migration mới trước backend/frontend. Không chạy migration thật, push hoặc deploy như một phần kiểm chứng.

## Tự rà soát kế hoạch

Mục 3 spec -> Task 2; mục 4 -> Task 1 và 3; mục 5 -> Task 4; mục 6 -> Task 5; mục 7 -> Task 2/3/4/6; mọi hàng nghiệm thu -> test tương ứng và Task 6. Đã kiểm tên hàm, schemaVersion, trường tiền và giá trị legacy xuyên các task. File mới đều có trách nhiệm và test cụ thể. Task thực hiện theo thứ tự 1–6, mỗi task có vòng đỏ/xanh và commit riêng.

## Bàn giao thực thi

Kế hoạch đã ghi và tự rà soát; chưa sửa nguồn. Hai lựa chọn theo skill writing-plans: thực thi bằng subagent theo task hoặc thực thi trực tiếp trong chat với executing-plans. Chỉ dùng subagent sau khi người dùng chọn phương án đó.
