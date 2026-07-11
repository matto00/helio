-- Allow 'image' as a valid source_type value in data_sources (HEL-216: image
-- connector, third content connector of the v1.4 Unstructured Data release).
-- Additive on top of V48 (HEL-214, which added 'pdf').
ALTER TABLE data_sources
  DROP CONSTRAINT IF EXISTS data_sources_source_type_check;

ALTER TABLE data_sources
  ADD CONSTRAINT data_sources_source_type_check
    CHECK (source_type IN ('rest_api', 'csv', 'static', 'sql', 'text', 'pdf', 'image'));
