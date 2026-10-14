-- Immutable monthly results, independent of the seven-day debt snapshot retention.
CREATE TABLE debt_reward_months (
  month DATE PRIMARY KEY CHECK (EXTRACT(DAY FROM month) = 1),
  rule_version TEXT NOT NULL,
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object')
);
