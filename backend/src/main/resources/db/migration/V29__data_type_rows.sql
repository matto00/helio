CREATE TABLE data_type_rows (
    id          BIGSERIAL PRIMARY KEY,
    data_type_id TEXT NOT NULL,
    row_index   INT NOT NULL,
    data        JSONB NOT NULL,
    UNIQUE (data_type_id, row_index)
);

CREATE INDEX idx_data_type_rows_data_type_id ON data_type_rows (data_type_id);
