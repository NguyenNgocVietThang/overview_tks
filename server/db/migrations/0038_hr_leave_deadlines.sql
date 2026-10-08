-- No historical reclassification or event backfill. Apply before deploying new web.
CREATE TABLE hr_leave_work_schedules (
 employee_id BIGINT NOT NULL REFERENCES hr_employees(id),
 work_date DATE NOT NULL,
 morning_start TIME,
 afternoon_start TIME,
 version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(employee_id,work_date),
 CHECK (morning_start IS NULL OR (morning_start < time '24:00' AND extract(second FROM morning_start)=0)),
 CHECK (afternoon_start IS NULL OR (afternoon_start < time '24:00' AND extract(second FROM afternoon_start)=0))
);
CREATE FUNCTION hr_leave_schedule_version() RETURNS trigger AS $$
BEGIN
 NEW.version := CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.version+1 END;
 NEW.updated_at := clock_timestamp();
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER hr_leave_schedule_version BEFORE INSERT OR UPDATE ON hr_leave_work_schedules FOR EACH ROW EXECUTE FUNCTION hr_leave_schedule_version();

ALTER TABLE hr_leave_requests
 ADD COLUMN leave_sessions JSONB,
 ADD COLUMN submission_nonce UUID,
 ADD COLUMN timing_status TEXT CHECK(timing_status IN ('Đúng hạn','Xin muộn','Vi phạm')),
 ADD COLUMN registration_deadline_date DATE,
 ADD COLUMN registration_deadline_exclusive_at TIMESTAMPTZ,
 ADD COLUMN first_session_start_at TIMESTAMPTZ,
 ADD COLUMN schedule_version BIGINT,
 ADD COLUMN schedule_start TIME,
 ADD COLUMN submission_revision INTEGER NOT NULL DEFAULT 0 CHECK(submission_revision >= 0);

CREATE TABLE hr_leave_submissions (
 request_id TEXT NOT NULL REFERENCES hr_leave_requests(request_id),
 submission_revision INTEGER NOT NULL,
 hr_employee_id BIGINT NOT NULL,
 thoi_gian_gui TIMESTAMPTZ NOT NULL,
 leave_sessions JSONB NOT NULL,
 tong_buoi_nghi INTEGER NOT NULL,
 registration_deadline_date DATE NOT NULL,
 registration_deadline_exclusive_at TIMESTAMPTZ NOT NULL,
 first_session_start_at TIMESTAMPTZ NOT NULL,
 schedule_version BIGINT NOT NULL,
 schedule_start TIME NOT NULL,
 timing_status TEXT NOT NULL,
 ly_do TEXT NOT NULL,
 nguoi_ban_giao TEXT NOT NULL,
 PRIMARY KEY(request_id,submission_revision)
);

CREATE FUNCTION hr_leave_calculate_timing(first_date DATE, session_start TIME, total INTEGER, submitted TIMESTAMPTZ)
RETURNS TABLE(deadline_date DATE,deadline_exclusive_at TIMESTAMPTZ,first_start_at TIMESTAMPTZ,timing TEXT) AS $$
BEGIN
 deadline_date := first_date - CASE WHEN total<=2 THEN 2 ELSE 3 END;
 deadline_exclusive_at := (deadline_date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
 first_start_at := (first_date+session_start) AT TIME ZONE 'Asia/Ho_Chi_Minh';
 timing := CASE WHEN submitted>=first_start_at THEN 'Vi phạm' WHEN submitted>=deadline_exclusive_at THEN 'Xin muộn' ELSE 'Đúng hạn' END;
 RETURN NEXT;
END; $$ LANGUAGE plpgsql;

CREATE FUNCTION hr_leave_submission_snapshot() RETURNS trigger AS $$
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
 IF NEW.hr_employee_id IS NULL OR employee_branch IS NULL THEN RAISE EXCEPTION 'LEAVE_SCHEDULE_REQUIRED: link an active employee and configure work schedule'; END IF;
 IF employee_branch<>NEW.branch THEN RAISE EXCEPTION 'LEAVE_IDENTITY_MISMATCH: employee branch mismatch'; END IF;
 IF TG_OP='INSERT' THEN SELECT COALESCE(e.bo_phan,'') INTO NEW.bo_phan FROM hr_employees e WHERE e.id=NEW.hr_employee_id; END IF;
 SELECT * INTO schedule_row FROM hr_leave_work_schedules WHERE employee_id=NEW.hr_employee_id AND work_date=NEW.start_date FOR SHARE;
 start_time:=CASE WHEN NEW.start_session='Sáng' THEN schedule_row.morning_start ELSE schedule_row.afternoon_start END;
 IF start_time IS NULL THEN RAISE EXCEPTION 'LEAVE_SCHEDULE_REQUIRED: configure employee % schedule on % for %',NEW.hr_employee_id,NEW.start_date,NEW.start_session; END IF;
 NEW.thoi_gian_gui:=clock_timestamp();NEW.schedule_version:=schedule_row.version;NEW.schedule_start:=start_time;
 SELECT deadline_date,deadline_exclusive_at,first_start_at,timing INTO NEW.registration_deadline_date,NEW.registration_deadline_exclusive_at,NEW.first_session_start_at,NEW.timing_status FROM hr_leave_calculate_timing(NEW.start_date,start_time,NEW.tong_buoi_nghi,NEW.thoi_gian_gui);
 IF TG_OP='INSERT' THEN
   NEW.submission_revision:=1;NEW.decision_version:=0;
   IF NEW.loai_yeu_cau='Xin nghỉ phép' THEN NEW.trang_thai:='Chưa duyệt';NEW.nguoi_duyet:='';NEW.approver_user_id:=NULL;NEW.thoi_diem_duyet:=NULL;NEW.ghi_chu_duyet:='';NEW.decision_notified_at:=NULL; END IF;
 ELSE
   NEW.submission_revision:=OLD.submission_revision+1;NEW.trang_thai:='Chưa duyệt';NEW.nguoi_duyet:='';NEW.approver_user_id:=NULL;NEW.thoi_diem_duyet:=NULL;NEW.ghi_chu_duyet:='';NEW.decision_notified_at:=NULL;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
-- PostgreSQL sorts triggers by name: snapshot precedes decision version and department.
CREATE TRIGGER hr_leave_00_submission BEFORE INSERT OR UPDATE ON hr_leave_requests FOR EACH ROW EXECUTE FUNCTION hr_leave_submission_snapshot();

CREATE OR REPLACE FUNCTION hr_leave_requests_before_update() RETURNS trigger AS $$
BEGIN
 NEW.updated_at:=now();
 IF NEW.trang_thai IS DISTINCT FROM OLD.trang_thai AND NEW.decision_notified_at IS NOT DISTINCT FROM OLD.decision_notified_at THEN NEW.decision_notified_at:=NULL; END IF;
 IF NEW.submission_revision IS DISTINCT FROM OLD.submission_revision OR ROW(NEW.trang_thai,NEW.nguoi_duyet,NEW.approver_user_id,NEW.thoi_diem_duyet,NEW.ghi_chu_duyet) IS DISTINCT FROM ROW(OLD.trang_thai,OLD.nguoi_duyet,OLD.approver_user_id,OLD.thoi_diem_duyet,OLD.ghi_chu_duyet) THEN NEW.decision_version:=OLD.decision_version+1;
 ELSE NEW.decision_version:=OLD.decision_version; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE FUNCTION hr_leave_submission_history() RETURNS trigger AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.submission_revision IS DISTINCT FROM OLD.submission_revision THEN
   INSERT INTO hr_leave_submissions(request_id,submission_revision,hr_employee_id,thoi_gian_gui,leave_sessions,tong_buoi_nghi,registration_deadline_date,registration_deadline_exclusive_at,first_session_start_at,schedule_version,schedule_start,timing_status,ly_do,nguoi_ban_giao)
   VALUES(NEW.request_id,NEW.submission_revision,NEW.hr_employee_id,NEW.thoi_gian_gui,NEW.leave_sessions,NEW.tong_buoi_nghi,NEW.registration_deadline_date,NEW.registration_deadline_exclusive_at,NEW.first_session_start_at,NEW.schedule_version,NEW.schedule_start,NEW.timing_status,NEW.ly_do,NEW.nguoi_ban_giao);
 END IF;
 RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER hr_leave_submission_history AFTER INSERT OR UPDATE ON hr_leave_requests FOR EACH ROW EXECUTE FUNCTION hr_leave_submission_history();
CREATE FUNCTION hr_leave_history_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP<>'INSERT' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Leave submission history is immutable'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER hr_leave_history_guard BEFORE INSERT OR UPDATE OR DELETE ON hr_leave_submissions FOR EACH ROW EXECUTE FUNCTION hr_leave_history_guard();
REVOKE SELECT ON hr_leave_work_schedules,hr_leave_submissions FROM reporting_readonly;
