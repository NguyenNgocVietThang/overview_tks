CREATE TABLE webhook_events_raw (
  id          BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload     JSONB NOT NULL
);

CREATE INDEX idx_webhook_events_raw_received_at ON webhook_events_raw (received_at);
