CREATE TABLE marketing_pancake_independent_page_state (
 page_id text PRIMARY KEY REFERENCES marketing_pages(page_id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','success','error')),
 last_success_at timestamptz, last_attempt_at timestamptz, error_code text,
 coverage jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO marketing_pancake_independent_page_state(page_id) SELECT page_id FROM marketing_pages;
CREATE TABLE marketing_pancake_independent_facts (
 id bigserial PRIMARY KEY, page_id text NOT NULL REFERENCES marketing_pages(page_id),
 source_key text NOT NULL, source_created_at timestamptz NOT NULL,
 latest_hash text NOT NULL, current_input jsonb NOT NULL,
 UNIQUE(page_id,source_key)
);
CREATE TABLE marketing_pancake_independent_observations (
 id bigserial PRIMARY KEY, fact_id bigint NOT NULL REFERENCES marketing_pancake_independent_facts(id),
 run_id bigint NOT NULL REFERENCES marketing_sync_runs(id),
 source_order bigserial UNIQUE, observed_at timestamptz NOT NULL,
 credited_date date NOT NULL, input jsonb NOT NULL,
 UNIQUE(fact_id,run_id)
);
CREATE INDEX marketing_independent_observation_fact_idx ON marketing_pancake_independent_observations(fact_id,source_order);
COMMENT ON TABLE marketing_pancake_independent_observations IS 'Pancake-only immutable observations. No imported history or Sheets baseline is consulted.';

CREATE TRIGGER marketing_independent_observation_guard BEFORE UPDATE OR DELETE ON marketing_pancake_independent_observations
 FOR EACH ROW EXECUTE FUNCTION marketing_immutable_guard();
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='reporting_readonly') THEN
  REVOKE SELECT ON marketing_pancake_independent_page_state,marketing_pancake_independent_facts,
   marketing_pancake_independent_observations FROM reporting_readonly;
 END IF;
END $$;
