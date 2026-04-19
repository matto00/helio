-- Add computed_fields JSONB column to data_types (HEL-58).
-- Existing rows default to an empty array; no data migration needed.
ALTER TABLE data_types ADD COLUMN computed_fields TEXT NOT NULL DEFAULT '[]';
