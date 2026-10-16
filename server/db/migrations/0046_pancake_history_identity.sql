-- Provenance linking Sheets history rows to Pancake message IDs. Many history rows (different
-- credited dates / phone keys) may belong to one message, and one row may be equivalent to several
-- messages; nothing is merged and every historical row stays intact.
CREATE TABLE marketing_history_identities (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES marketing_import_batches(id),
  history_row_id BIGINT NOT NULL REFERENCES marketing_history_rows(id),
  page_id TEXT NOT NULL REFERENCES marketing_pages(page_id),
  message_id TEXT NOT NULL CHECK (btrim(message_id) <> ''),
  conversation_id TEXT NOT NULL DEFAULT '',
  resolution TEXT NOT NULL CHECK (resolution IN ('unique','verified-notation','equivalent')),
  group_key TEXT,
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  UNIQUE(history_row_id,message_id)
);
CREATE INDEX marketing_history_identity_message_idx ON marketing_history_identities(page_id,message_id);

-- Messages present in the authoritative full export, inside the period the Sheets history covers,
-- that the Sheets baseline never counted. Recorded explicitly so sync can tell them from unknown ones.
CREATE TABLE marketing_baseline_messages (
  page_id TEXT NOT NULL REFERENCES marketing_pages(page_id),
  message_id TEXT NOT NULL CHECK (btrim(message_id) <> ''),
  batch_id BIGINT NOT NULL REFERENCES marketing_import_batches(id),
  conversation_id TEXT NOT NULL DEFAULT '',
  source_created_at TIMESTAMPTZ NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('in-window-not-in-sheets')),
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  PRIMARY KEY(page_id,message_id)
);

-- Equivalent-message pairs share one anchor row, so the anchor is no longer unique per fact.
ALTER TABLE marketing_pancake_facts DROP CONSTRAINT IF EXISTS marketing_pancake_facts_historical_row_id_key;

CREATE TRIGGER marketing_identity_guard BEFORE UPDATE OR DELETE ON marketing_history_identities
 FOR EACH ROW EXECUTE FUNCTION marketing_immutable_guard();
CREATE TRIGGER marketing_baseline_guard BEFORE UPDATE OR DELETE ON marketing_baseline_messages
 FOR EACH ROW EXECUTE FUNCTION marketing_immutable_guard();

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='reporting_readonly') THEN
  REVOKE SELECT ON marketing_history_identities,marketing_baseline_messages FROM reporting_readonly;
 END IF;
END $$;
