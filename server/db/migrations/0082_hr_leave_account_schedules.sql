-- Lịch làm việc dùng định danh tài khoản cho các đơn nghỉ mới.
-- employee_id được giữ nguyên để đọc lịch sử và đối chiếu dữ liệu cũ.
ALTER TABLE hr_leave_work_schedules
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id);

-- Khóa chính cũ bắt employee_id luôn có giá trị. Chuyển thành hai khóa duy nhất
-- riêng để hỗ trợ cả lịch lịch sử theo nhân sự và lịch mới theo tài khoản.
ALTER TABLE hr_leave_work_schedules
  DROP CONSTRAINT IF EXISTS hr_leave_work_schedules_pkey;
ALTER TABLE hr_leave_work_schedules
  ALTER COLUMN employee_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hr_leave_work_schedules_employee_date_idx
  ON hr_leave_work_schedules (employee_id, work_date)
  WHERE employee_id IS NOT NULL;

-- Một hồ sơ HR có thể đã có lịch riêng. Sao chép lịch đó sang TỪNG tài khoản
-- liên kết đang hoạt động; employee_id của dòng cũ giữ nguyên để đối chiếu lịch sử.
-- Tắt trigger tăng version trong lúc sao chép để version/updated_at giữ đúng như bản gốc
-- (đơn cũ đã lưu schedule_version theo các dòng này).
ALTER TABLE hr_leave_work_schedules DISABLE TRIGGER hr_leave_schedule_version;

-- Dòng gốc gắn với tài khoản liên kết đầu tiên (thứ tự ổn định theo id).
UPDATE hr_leave_work_schedules s
SET user_id = u.id
FROM app_users u
WHERE u.hr_employee_id = s.employee_id
  AND u.trang_thai = 'Đang hoạt động'
  AND NOT u.is_deleted
  AND s.user_id IS NULL
  AND u.id = (
    SELECT min(x.id::text)::uuid FROM app_users x
    WHERE x.hr_employee_id = s.employee_id AND x.trang_thai = 'Đang hoạt động' AND NOT x.is_deleted
  );

CREATE UNIQUE INDEX IF NOT EXISTS hr_leave_work_schedules_user_date_idx
  ON hr_leave_work_schedules (user_id, work_date)
  WHERE user_id IS NOT NULL;

-- Các tài khoản liên kết còn lại của cùng hồ sơ nhận bản sao (employee_id để trống).
INSERT INTO hr_leave_work_schedules (user_id, work_date, morning_start, afternoon_start, version, updated_at)
SELECT u.id, s.work_date, s.morning_start, s.afternoon_start, s.version, s.updated_at
FROM hr_leave_work_schedules s
JOIN app_users u ON u.hr_employee_id = s.employee_id AND u.trang_thai = 'Đang hoạt động' AND NOT u.is_deleted
WHERE s.employee_id IS NOT NULL
  AND s.user_id IS DISTINCT FROM u.id
  AND NOT EXISTS (SELECT 1 FROM hr_leave_work_schedules x WHERE x.user_id = u.id AND x.work_date = s.work_date);

ALTER TABLE hr_leave_work_schedules ENABLE TRIGGER hr_leave_schedule_version;

-- Lịch sử nộp đơn ghi thêm tài khoản; hr_employee_id chỉ còn để đọc đơn cũ.
-- Không gắn khóa ngoại: bảng lịch sử bất biến (hr_leave_history_guard) nên không thể SET NULL.
ALTER TABLE hr_leave_submissions ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE OR REPLACE FUNCTION hr_leave_submission_history() RETURNS trigger AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.submission_revision IS DISTINCT FROM OLD.submission_revision THEN
   INSERT INTO hr_leave_submissions(request_id,submission_revision,hr_employee_id,user_id,thoi_gian_gui,leave_sessions,tong_buoi_nghi,registration_deadline_date,registration_deadline_exclusive_at,first_session_start_at,schedule_version,schedule_start,timing_status,ly_do,nguoi_ban_giao)
   VALUES(NEW.request_id,NEW.submission_revision,NEW.hr_employee_id,NEW.user_id,NEW.thoi_gian_gui,NEW.leave_sessions,NEW.tong_buoi_nghi,NEW.registration_deadline_date,NEW.registration_deadline_exclusive_at,NEW.first_session_start_at,NEW.schedule_version,NEW.schedule_start,NEW.timing_status,NEW.ly_do,NEW.nguoi_ban_giao);
 END IF;
 RETURN NULL;
END; $$ LANGUAGE plpgsql;

-- Đơn mới/sửa đơn: định danh là tài khoản (app_users), không suy phạm vi từ hồ sơ HR.
--  * tài khoản phải đang hoạt động, chưa xóa, có cơ sở công tác (u.work_branch) trùng cơ sở của đơn;
--  * bộ phận snapshot lấy từ u.bo_phan khi tạo đơn (sửa đơn giữ snapshot cũ);
--  * giờ bắt đầu tra hr_leave_work_schedules theo user_id + ngày (không có thì giờ mặc định);
--  * bot ngoài repo gửi telegram_chat_id hoặc hr_employee_id cũ: quy về đúng MỘT tài khoản đang hoạt động;
--  * hr_employee_id bot gửi (nếu có) được giữ nguyên để đối chiếu, đơn web mới không tự điền.
CREATE OR REPLACE FUNCTION hr_leave_submission_snapshot() RETURNS trigger AS $$
DECLARE
 selected JSONB; canonical JSONB; first_item JSONB; last_item JSONB;
 schedule_row hr_leave_work_schedules%ROWTYPE;
 start_time TIME; account_branch TEXT; account_department TEXT; account_employee BIGINT;
 resolved_user UUID; candidates INTEGER;
 new_submission BOOLEAN; range_changed BOOLEAN := false;
BEGIN
 IF TG_OP='UPDATE' THEN
   range_changed := ROW(NEW.start_date,NEW.start_session,NEW.end_date,NEW.end_session) IS DISTINCT FROM ROW(OLD.start_date,OLD.start_session,OLD.end_date,OLD.end_session);
   new_submission := range_changed OR NEW.leave_sessions IS DISTINCT FROM OLD.leave_sessions OR NEW.submission_nonce IS DISTINCT FROM OLD.submission_nonce;
   -- Định danh bất biến khi sửa; hr_employee_id cũ giữ cho lịch sử.
   NEW.user_id:=OLD.user_id; NEW.hr_employee_id:=OLD.hr_employee_id;
   NEW.branch:=OLD.branch; NEW.source:=OLD.source;
   IF NOT new_submission THEN
     NEW.leave_sessions:=OLD.leave_sessions; NEW.tong_buoi_nghi:=OLD.tong_buoi_nghi;
     NEW.thoi_gian_gui:=OLD.thoi_gian_gui; NEW.timing_status:=OLD.timing_status;
     NEW.registration_deadline_date:=OLD.registration_deadline_date;
     NEW.registration_deadline_exclusive_at:=OLD.registration_deadline_exclusive_at;
     NEW.first_session_start_at:=OLD.first_session_start_at; NEW.schedule_version:=OLD.schedule_version;
     NEW.schedule_start:=OLD.schedule_start; NEW.submission_revision:=OLD.submission_revision;
     RETURN NEW;
   END IF;
 ELSE new_submission:=true;
 END IF;

 -- A range-only bot update must replace the old explicit calendar.
 selected := NEW.leave_sessions;
 IF TG_OP='UPDATE' AND range_changed AND NEW.leave_sessions IS NOT DISTINCT FROM OLD.leave_sessions THEN selected:=NULL; END IF;
 IF selected IS NULL THEN
   IF NEW.end_date<NEW.start_date OR NEW.start_session NOT IN ('Sáng','Chiều') OR NEW.end_session NOT IN ('Sáng','Chiều') OR (NEW.start_date=NEW.end_date AND NEW.start_session='Chiều' AND NEW.end_session='Sáng') OR NEW.end_date-NEW.start_date>10000 THEN
     RAISE EXCEPTION 'INVALID_LEAVE_SESSIONS: invalid calendar range' USING ERRCODE='P0001';
   END IF;
   SELECT jsonb_agg(jsonb_build_object('date',to_char(day,'YYYY-MM-DD'),'session',s) ORDER BY day,CASE s WHEN 'Sáng' THEN 0 ELSE 1 END) INTO selected
   FROM generate_series(NEW.start_date::timestamp,NEW.end_date::timestamp,interval '1 day') day CROSS JOIN unnest(ARRAY['Sáng','Chiều']) s
   WHERE NOT(day::date=NEW.start_date AND NEW.start_session='Chiều' AND s='Sáng') AND NOT(day::date=NEW.end_date AND NEW.end_session='Sáng' AND s='Chiều');
 END IF;
 IF jsonb_typeof(selected)<>'array' OR jsonb_array_length(selected)=0 OR jsonb_array_length(selected)>20001 THEN RAISE EXCEPTION 'INVALID_LEAVE_SESSIONS: select sessions'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(selected) item WHERE jsonb_typeof(item)<>'object' OR COALESCE(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' OR COALESCE(item->>'session','') NOT IN ('Sáng','Chiều')) THEN RAISE EXCEPTION 'INVALID_LEAVE_SESSIONS: invalid date/session'; END IF;
 -- DATE cast validates impossible dates and canonicalizes any accepted SQL input.
 SELECT jsonb_agg(jsonb_build_object('date',to_char((item->>'date')::date,'YYYY-MM-DD'),'session',item->>'session') ORDER BY (item->>'date')::date,CASE item->>'session' WHEN 'Sáng' THEN 0 ELSE 1 END) INTO canonical FROM jsonb_array_elements(selected) item;
 IF (SELECT count(DISTINCT item) FROM jsonb_array_elements(canonical) item)<>jsonb_array_length(canonical) THEN RAISE EXCEPTION 'INVALID_LEAVE_SESSIONS: duplicate'; END IF;
 first_item:=canonical->0;last_item:=canonical->(jsonb_array_length(canonical)-1);
 NEW.leave_sessions:=canonical;NEW.start_date:=(first_item->>'date')::date;NEW.start_session:=first_item->>'session';NEW.end_date:=(last_item->>'date')::date;NEW.end_session:=last_item->>'session';NEW.tong_buoi_nghi:=jsonb_array_length(canonical);

 -- Xác định tài khoản gửi đơn.
 resolved_user:=NEW.user_id;
 IF resolved_user IS NULL AND NEW.telegram_chat_id<>'' THEN
   SELECT l.user_id INTO resolved_user FROM hr_telegram_links l WHERE l.status='linked' AND l.telegram_chat_id=NEW.telegram_chat_id;
 END IF;
 IF resolved_user IS NULL AND NEW.hr_employee_id IS NOT NULL THEN
   SELECT count(*)::int,min(u.id::text)::uuid INTO candidates,resolved_user FROM app_users u
   WHERE u.hr_employee_id=NEW.hr_employee_id AND NOT u.is_deleted AND u.trang_thai='Đang hoạt động';
   IF candidates<>1 THEN resolved_user:=NULL; END IF;
 END IF;
 IF resolved_user IS NULL THEN RAISE EXCEPTION 'LEAVE_IDENTITY_MISMATCH: active account required' USING ERRCODE='P0001'; END IF;

 SELECT u.work_branch,u.bo_phan,u.hr_employee_id INTO account_branch,account_department,account_employee
 FROM app_users u WHERE u.id=resolved_user AND NOT u.is_deleted AND u.trang_thai='Đang hoạt động';
 IF NOT FOUND OR COALESCE(account_branch,'') NOT IN ('hanoi','saigon') THEN
   RAISE EXCEPTION 'LEAVE_IDENTITY_MISMATCH: active account with work branch required' USING ERRCODE='P0001';
 END IF;
 IF account_branch<>NEW.branch THEN RAISE EXCEPTION 'LEAVE_IDENTITY_MISMATCH: account work branch mismatch' USING ERRCODE='P0001'; END IF;
 IF TG_OP='INSERT' AND NEW.hr_employee_id IS NOT NULL AND account_employee IS NOT NULL AND NEW.hr_employee_id<>account_employee THEN
   RAISE EXCEPTION 'LEAVE_IDENTITY_MISMATCH: employee/account mismatch' USING ERRCODE='P0001';
 END IF;
 NEW.user_id:=resolved_user;
 IF TG_OP='INSERT' THEN NEW.bo_phan:=COALESCE(account_department,''); END IF;

 SELECT * INTO schedule_row FROM hr_leave_work_schedules WHERE user_id = NEW.user_id AND work_date = NEW.start_date FOR SHARE;
 -- Giờ cố định cho mọi nhân viên: sáng 07:45, chiều 12:30; dòng lịch riêng của tài khoản (nếu có) ghi đè.
 start_time:=CASE WHEN NEW.start_session='Sáng' THEN COALESCE(schedule_row.morning_start,time '07:45') ELSE COALESCE(schedule_row.afternoon_start,time '12:30') END;
 NEW.thoi_gian_gui:=clock_timestamp();NEW.schedule_version:=COALESCE(schedule_row.version,0);NEW.schedule_start:=start_time;
 SELECT deadline_date,deadline_exclusive_at,first_start_at,timing INTO NEW.registration_deadline_date,NEW.registration_deadline_exclusive_at,NEW.first_session_start_at,NEW.timing_status FROM hr_leave_calculate_timing(NEW.start_date,start_time,NEW.tong_buoi_nghi,NEW.thoi_gian_gui);
 IF TG_OP='INSERT' THEN
   NEW.submission_revision:=1;NEW.decision_version:=0;
   IF NEW.loai_yeu_cau='Xin nghỉ phép' THEN NEW.trang_thai:='Chưa duyệt';NEW.nguoi_duyet:='';NEW.approver_user_id:=NULL;NEW.thoi_diem_duyet:=NULL;NEW.ghi_chu_duyet:='';NEW.decision_notified_at:=NULL; END IF;
 ELSE
   NEW.submission_revision:=OLD.submission_revision+1;NEW.trang_thai:='Chưa duyệt';NEW.nguoi_duyet:='';NEW.approver_user_id:=NULL;NEW.thoi_diem_duyet:=NULL;NEW.ghi_chu_duyet:='';NEW.decision_notified_at:=NULL;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Snapshot bộ phận dự phòng (khi trigger trên chưa điền): đọc bộ phận của tài khoản, không đọc HR.
CREATE OR REPLACE FUNCTION hr_leave_department_snapshot() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.bo_phan := OLD.bo_phan;
  ELSIF NEW.bo_phan = '' THEN
    SELECT COALESCE(u.bo_phan, '') INTO NEW.bo_phan FROM app_users u WHERE u.id = NEW.user_id;
    NEW.bo_phan := COALESCE(NEW.bo_phan, '');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS hr_leave_requests_user_pending_idx ON hr_leave_requests (user_id, start_date) WHERE user_id IS NOT NULL;
