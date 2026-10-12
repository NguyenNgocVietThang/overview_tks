-- Latest API canonical metadata supports historical adoption without fabricating an observation.
-- Existing facts remain compatible through nullable input; sync surfaces unresolved legacy metadata.
ALTER TABLE marketing_pancake_facts ADD COLUMN current_input JSONB;
ALTER TABLE marketing_pancake_facts ADD CONSTRAINT marketing_fact_current_input_object
  CHECK (current_input IS NULL OR jsonb_typeof(current_input) = 'object');
COMMENT ON COLUMN marketing_pancake_facts.current_input IS
  'Latest canonical API fields and raw provenance; not a countable source observation.';
