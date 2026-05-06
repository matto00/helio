CREATE TABLE pipelines (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    source_data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    output_data_type_id   TEXT NOT NULL REFERENCES data_types(id)   ON DELETE CASCADE,
    last_run_status       TEXT CHECK (last_run_status IN ('succeeded', 'failed')),
    last_run_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
