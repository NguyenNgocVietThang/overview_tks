-- Cancellation delivery survives deletion of the request. No copy of reason/history is retained.
CREATE TABLE hr_leave_cancellation_jobs (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 request_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('card','notify')),
 telegram_chat_id TEXT NOT NULL,
 message_id TEXT NOT NULL DEFAULT '',
 text TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 lease_token UUID,
 lease_until TIMESTAMPTZ,
 last_error TEXT,
 UNIQUE(request_id,kind,telegram_chat_id,message_id)
);
CREATE INDEX hr_leave_cancellation_jobs_ready ON hr_leave_cancellation_jobs(available_at,id);
REVOKE ALL ON hr_leave_cancellation_jobs FROM reporting_readonly;

-- Keep recipient identities (not decision content) until the request is deleted.
CREATE TABLE hr_leave_approver_recipients (
 request_id TEXT NOT NULL REFERENCES hr_leave_requests(request_id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,
 PRIMARY KEY(request_id,user_id)
);
REVOKE ALL ON hr_leave_approver_recipients FROM reporting_readonly;
INSERT INTO hr_leave_approver_recipients SELECT request_id,approver_user_id::text FROM hr_leave_requests WHERE approver_user_id IS NOT NULL;
CREATE FUNCTION hr_leave_remember_approver() RETURNS trigger AS $$
BEGIN
 IF NEW.approver_user_id IS NOT NULL THEN INSERT INTO hr_leave_approver_recipients VALUES(NEW.request_id,NEW.approver_user_id::text) ON CONFLICT DO NOTHING; END IF;
 RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER hr_leave_remember_approver AFTER INSERT OR UPDATE ON hr_leave_requests FOR EACH ROW EXECUTE FUNCTION hr_leave_remember_approver();

-- Reject delayed creation/decision notifications after a cancellation committed.
CREATE FUNCTION hr_leave_notification_guard() RETURNS trigger AS $$
BEGIN
 IF NEW.related_type='leaveRequest' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('leave:'||NEW.related_id,0));
   IF NOT EXISTS(SELECT 1 FROM hr_leave_requests WHERE request_id=NEW.related_id) THEN RETURN NULL; END IF;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER hr_leave_notification_guard BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION hr_leave_notification_guard();

-- Cascading history deletion is permitted only after a validated parent deletion.
ALTER TABLE hr_leave_submissions DROP CONSTRAINT hr_leave_submissions_request_id_fkey;
ALTER TABLE hr_leave_submissions ADD CONSTRAINT hr_leave_submissions_request_id_fkey
 FOREIGN KEY(request_id) REFERENCES hr_leave_requests(request_id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION hr_leave_history_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND NOT EXISTS(SELECT 1 FROM hr_leave_requests WHERE request_id=OLD.request_id) THEN RETURN OLD; END IF;
 IF TG_OP<>'INSERT' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Leave submission history is immutable'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE FUNCTION hr_leave_cancel_delete_guard() RETURNS trigger AS $$
BEGIN
 IF OLD.first_session_start_at IS NOT NULL AND clock_timestamp()>=OLD.first_session_start_at THEN RAISE EXCEPTION 'LEAVE_CANCEL_EXPIRED'; END IF;
 IF current_setting('app.leave_cancel_id',true) IS DISTINCT FROM OLD.request_id
   OR current_setting('app.leave_cancel_actor',true) IS DISTINCT FROM OLD.user_id::text
   OR OLD.loai_yeu_cau<>'Xin nghỉ phép' OR OLD.first_session_start_at IS NULL
   OR NOT EXISTS(SELECT 1 FROM app_users WHERE id=OLD.user_id AND trang_thai='Đang hoạt động' AND NOT is_deleted)
 THEN RAISE EXCEPTION 'Leave deletion requires validated owner cancellation'; END IF;
 RETURN OLD;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER hr_leave_cancel_delete_guard BEFORE DELETE ON hr_leave_requests FOR EACH ROW EXECUTE FUNCTION hr_leave_cancel_delete_guard();

CREATE FUNCTION hr_cancel_own_leave(p_id TEXT,p_actor TEXT,p_version BIGINT,p_recipients TEXT[])
RETURNS TABLE(outcome TEXT,branch TEXT) AS $$
DECLARE r hr_leave_requests%ROWTYPE; recipient RECORD; card RECORD; summary TEXT;
BEGIN
 -- The Telegram sender holds this same transaction lock during card send + persistence.
 PERFORM pg_advisory_xact_lock(hashtextextended('leave:'||p_id,0));
 SELECT * INTO r FROM hr_leave_requests WHERE request_id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text,NULL::text; RETURN; END IF;
 IF r.user_id::text IS DISTINCT FROM p_actor OR NOT EXISTS(SELECT 1 FROM app_users u WHERE u.id=r.user_id AND u.trang_thai='Đang hoạt động' AND NOT u.is_deleted)
 THEN RETURN QUERY SELECT 'FORBIDDEN'::text,r.branch; RETURN; END IF;
 IF r.loai_yeu_cau<>'Xin nghỉ phép' THEN RETURN QUERY SELECT 'TYPE'::text,r.branch; RETURN; END IF;
 IF p_version IS NULL OR r.decision_version<>p_version THEN RETURN QUERY SELECT 'CONFLICT'::text,r.branch; RETURN; END IF;
 IF r.first_session_start_at IS NULL OR NOT isfinite(r.first_session_start_at) THEN RETURN QUERY SELECT 'MISSING_START'::text,r.branch; RETURN; END IF;
 IF clock_timestamp()>=r.first_session_start_at THEN RETURN QUERY SELECT 'EXPIRED'::text,r.branch; RETURN; END IF;
 summary := 'Đã hủy bởi người xin nghỉ: '||left(r.request_id,100)||' · '||left(r.ho_ten,200)||' · '||r.start_date::text||' '||r.start_session||' → '||r.end_date::text||' '||r.end_session;

 FOR recipient IN
   SELECT DISTINCT u.id,u.telegram_id FROM app_users u JOIN (
     SELECT unnest(p_recipients) AS id
     UNION SELECT r.approver_user_id::text
     UNION SELECT a.user_id FROM hr_leave_approver_recipients a WHERE a.request_id=p_id
     UNION SELECT c.user_id::text FROM hr_manager_telegram_cards c WHERE c.request_id=p_id
     UNION SELECT m.user_id::text FROM hr_leave_manager_messages m WHERE m.request_id=p_id
     UNION SELECT n.recipient_user_id FROM notifications n WHERE n.related_type='leaveRequest' AND n.related_id=p_id AND n.recipient_user_id<>p_actor
   ) recipients ON recipients.id=u.id::text WHERE u.trang_thai='Đang hoạt động' AND NOT u.is_deleted
 LOOP
   INSERT INTO notifications(id,recipient_user_id,type,title,message)
     VALUES(gen_random_uuid(),recipient.id::text,'hr_leave_cancelled','Đơn nghỉ phép đã hủy',summary);
   IF COALESCE(recipient.telegram_id,'')<>'' THEN
     INSERT INTO hr_leave_cancellation_jobs(request_id,kind,telegram_chat_id,text) VALUES(p_id,'notify',recipient.telegram_id,summary) ON CONFLICT DO NOTHING;
   END IF;
 END LOOP;
 FOR card IN
   SELECT c.telegram_chat_id,c.message_id::text FROM hr_manager_telegram_cards c WHERE c.request_id=p_id
   UNION SELECT m.telegram_chat_id,m.message_id::text FROM hr_leave_manager_messages m WHERE m.request_id=p_id AND m.message_id IS NOT NULL
 LOOP
   INSERT INTO hr_leave_cancellation_jobs(request_id,kind,telegram_chat_id,message_id,text) VALUES(p_id,'card',card.telegram_chat_id,card.message_id,summary) ON CONFLICT DO NOTHING;
 END LOOP;
 DELETE FROM notifications WHERE related_type='leaveRequest' AND related_id=p_id;
 -- Retain inbox deduplication IDs, but remove request snapshots and obsolete effects.
 -- An inbox transaction may hold its job before locking the request; never wait on it here.
 WITH obsolete AS (
   SELECT update_id FROM hr_manager_telegram_updates
   WHERE effects @> jsonb_build_array(jsonb_build_object('request',jsonb_build_object('request_id',p_id)))
      OR effects @> jsonb_build_array(jsonb_build_object('delivery',jsonb_build_object('requestId',p_id)))
      OR split_part(payload #>> '{callback_query,data}','|',2)=p_id
   FOR UPDATE SKIP LOCKED
 ) UPDATE hr_manager_telegram_updates u SET payload='{}'::jsonb,effects='[]'::jsonb,effects_done=0,
     handled_at=COALESCE(handled_at,now()),completed_at=now(),lease_token=NULL,lease_until=NULL,last_error=NULL
   FROM obsolete WHERE u.update_id=obsolete.update_id;
 PERFORM set_config('app.leave_cancel_id',p_id,true);
 PERFORM set_config('app.leave_cancel_actor',p_actor,true);
 DELETE FROM hr_leave_requests WHERE request_id=p_id;
 PERFORM set_config('app.leave_cancel_id','',true);
 PERFORM set_config('app.leave_cancel_actor','',true);
 RETURN QUERY SELECT 'DELETED'::text,r.branch;
END; $$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION hr_cancel_own_leave(TEXT,TEXT,BIGINT,TEXT[]) FROM PUBLIC;
