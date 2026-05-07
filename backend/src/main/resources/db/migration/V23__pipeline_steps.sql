CREATE TABLE pipeline_steps (
  id          TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  position    INT  NOT NULL,
  op          TEXT NOT NULL CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast')),
  config      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX pipeline_steps_pipeline_id_idx ON pipeline_steps(pipeline_id);
