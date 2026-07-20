-- HEL-318 — Persist optional caption (image) / annotation (chart) text.
--
-- Image panels gain an optional static `caption` (rendered as a strip beneath
-- the image); chart panels gain an optional static `annotation` (rendered as a
-- subtitle/footnote beneath the chart title). Both are plain, static literal
-- text — NOT a DataType-field binding.
--
-- Persisted as two dedicated nullable TEXT columns following the
-- scalar-per-column idiom already used by `image_url` / `image_fit` /
-- `divider_color` — image has no JSONB column, so a column per field keeps the
-- image/chart config surfaces symmetric.
--
--   image_caption    — set only on `type='image'` rows; NULL otherwise.
--   chart_annotation — set only on `type='chart'` rows; NULL otherwise.
--
-- NULL means "no caption/annotation" = exactly the pre-change behavior, so
-- existing rows require zero data migration. Rollback = drop the columns.

ALTER TABLE panels ADD COLUMN image_caption TEXT;
ALTER TABLE panels ADD COLUMN chart_annotation TEXT;
