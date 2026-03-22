CREATE TABLE data_sources (
    id          TEXT        NOT NULL PRIMARY KEY,
    name        TEXT        NOT NULL,
    source_type TEXT        NOT NULL CHECK (source_type IN ('rest_api', 'csv', 'static')),
    config      TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE data_types (
    id          TEXT        NOT NULL PRIMARY KEY,
    source_id   TEXT        REFERENCES data_sources(id) ON DELETE SET NULL,
    name        TEXT        NOT NULL,
    fields      TEXT        NOT NULL,
    version     INT         NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX data_types_source_id_idx ON data_types(source_id);
