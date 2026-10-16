-- 0042: cho phep don xin nghi phep cua tai khoan noi bo chua gan ho so nhan su (hr_employee_id NULL).
ALTER TABLE hr_leave_submissions ALTER COLUMN hr_employee_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION hr_leave_submission_snapshot() RETURNS trigger AS $$
DECLARE
 selected JSONB; canonical JSONB; first_item JSONB; last_item JSONB;
 schedule_row hr_leave_work_schedules%ROWTYPE;
 start_time TIME; employee_branch TEXT; linked_employee BIGINT; linked_user UUID;
 new_submission BOOLEAN; range_changed BOOLEAN := false;
BEGIN
 IF TG_OP='UPDATE' THEN
   range_changed := ROW(NEW.start_date,NEW.start_session,NEW.end_date,NEW.end_session) IS DISTINCT FROM ROW(OLD.start_date,OLD.start_session,OLD.end_date,OLD.end_session);
   new_submission := range_changed OR NEW.leave_sessions IS DISTINCT FROM OLD.leave_sessions OR NEW.submission_nonce IS DISTINCT FROM OLD.submission_nonce;
   -- Identity is immutable on edits; current app service separately checks active linkage.
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

 IF NEW.user_id IS NOT NULL THEN SELECT u.hr_employee_id INTO linked_employee FROM app_users u WHERE u.id=NEW.user_id AND NOT u.is_deleted AND u.trang_thai='Đang hoạt động'; END IF;
 IF NEW.hr_employee_id IS NOT NULL AND linked_employee IS NOT NULL AND NEW.hr_employee_id<>linked_employee THEN RAISE EXCEPTION 'LEAVE_IDENTITY_MISMATCH: employee/account mismatch'; END IF;
 NEW.hr_employee_id:=COALESCE(NEW.hr_employee_id,linked_employee);
 IF NEW.hr_employee_id IS NULL AND NEW.telegram_chat_id<>'' THEN
   SELECT u.hr_employee_id,u.id INTO linked_employee,linked_user FROM hr_telegram_links l JOIN app_users u ON u.id=l.user_id WHERE l.status='linked' AND l.telegram_chat_id=NEW.telegram_chat_id AND NOT u.is_deleted AND u.trang_thai='Đang hoạt động';
   NEW.hr_employee_id:=linked_employee;NEW.user_id:=COALESCE(NEW.user_id,linked_user);
 END IF;
 SELECT e.branch INTO employee_branch FROM hr_employees e WHERE e.id=NEW.hr_employee_id AND e.is_active;
 -- 0042: tai khoan noi bo chua gan ho so nhan su van xin nghi duoc (khong co nhan su => co so lay tu don, lich mac dinh).
 IF NEW.hr_employee_id IS NULL AND NEW.user_id IS NOT NULL AND NEW.source='web' THEN employee_branch:=NEW.branch;
 ELSIF NEW.hr_employee_id IS NULL OR employee_branch IS NULL THEN RAISE EXCEPTION 'LEAVE_SCHEDULE_REQUIRED: link an active employee and configure work schedule'; END IF;
 IF employee_branch<>NEW.branch THEN RAISE EXCEPTION 'LEAVE_IDENTITY_MISMATCH: employee branch mismatch'; END IF;
 IF TG_OP='INSERT' AND NEW.hr_employee_id IS NOT NULL THEN SELECT COALESCE(e.bo_phan,'') INTO NEW.bo_phan FROM hr_employees e WHERE e.id=NEW.hr_employee_id; END IF;
 SELECT * INTO schedule_row FROM hr_leave_work_schedules WHERE employee_id=NEW.hr_employee_id AND work_date=NEW.start_date FOR SHARE;
 -- Giờ cố định cho mọi nhân viên: sáng 07:45, chiều 12:30; dòng lịch riêng (nếu có) ghi đè.
 start_time:=CASE WHEN NEW.start_session='Sáng' THEN COALESCE(schedule_row.morning_start,time '07:45') ELSE COALESCE(schedule_row.afternoon_start,time '12:30') END;
 IF start_time IS NULL THEN RAISE EXCEPTION 'LEAVE_SCHEDULE_REQUIRED: configure employee % schedule on % for %',NEW.hr_employee_id,NEW.start_date,NEW.start_session; END IF;
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
