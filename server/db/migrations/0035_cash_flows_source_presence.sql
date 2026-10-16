-- Keep historical vouchers whose source IDs have been replaced/removed.
-- Full reconciliation flags them; a subsequent upsert restores source presence.
ALTER TABLE cash_flows ADD COLUMN source_missing_at TIMESTAMPTZ;
