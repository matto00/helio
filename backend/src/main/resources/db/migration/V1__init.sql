CREATE TABLE dashboards (
    id          TEXT        NOT NULL PRIMARY KEY,
    name        TEXT        NOT NULL,
    created_by  TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    last_updated TIMESTAMPTZ NOT NULL,
    appearance  TEXT        NOT NULL,
    layout      TEXT        NOT NULL
);

CREATE TABLE panels (
    id           TEXT        NOT NULL PRIMARY KEY,
    dashboard_id TEXT        NOT NULL REFERENCES dashboards(id),
    title        TEXT        NOT NULL,
    created_by   TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL,
    last_updated TIMESTAMPTZ NOT NULL,
    appearance   TEXT        NOT NULL
);

CREATE INDEX panels_dashboard_id_idx ON panels(dashboard_id);
