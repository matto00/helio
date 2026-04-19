-- Allow 'sql' as a valid source_type value in data_sources
ALTER TABLE data_sources
  DROP CONSTRAINT IF EXISTS data_sources_source_type_check;

ALTER TABLE data_sources
  ADD CONSTRAINT data_sources_source_type_check
    CHECK (source_type IN ('rest_api', 'csv', 'static', 'sql'));
