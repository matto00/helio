# HEL-1410: V94 copied metrics.format as a JSON object onto metric Outputs; the reader accepts only a string, so number format is silently lost

## Description

origin_kind: followup
origin_ticket: HEL-1387

Found by HEL-1387's design-gate skeptic, and left outside the owner's rulings for that ticket.

V75 stores `metrics.format` as a JSON object. For `metric_id` panels, V94 §9 (`V94__outputs_model.sql` ~L707) copied that object verbatim onto the Output as `config.format`. The frontend's `isMetricFormat` (`outputConfigTypes.ts` `readMetricConfig`/`readCollectionConfig`) accepts only a string format, so those metric Outputs render with no format. Their unit, prefix, suffix and decimals are silently lost, which is the same class of bug as HEL-1387.

V117 (HEL-1387) leaves `format` untouched on metric and collection Outputs, because `format` is a live key there.

Needs a product decision: should the object be mapped to the closest string format, or should those settings be surfaced some other way? Measure first: count metric and collection Outputs where `jsonb_typeof(config->'format') = 'object'`. The read-only dev query can run in-lane; the prod count is owner-only.

## Owner ruling (Matt, 2026-10-08, on the ticket; relayed by the driver)

**Measure, then map.** Count metric/collection Outputs where `jsonb_typeof(config->'format') = 'object'` (dev in-lane, read-only; prod is owner-only). Then a V118 migration maps each legacy format object to the closest supported string format, and moves unit/prefix/suffix into the live `unit` field where that is absent or null (V117's null-is-absent rule) — never overwriting a live non-null value. Every original goes into an audit table following V117's `hel1387_dropped_output_config_keys` pattern (reuse it if its shape fits, else a sibling with the same RLS setup). Same proof standard as V117.

## Acceptance criteria (derived from the ruling)

1. Measurement recorded: dev count (read-only) of metric/collection Outputs with an object `format`; prod count flagged owner-only.
2. A V118 Flyway migration rewrites every Output whose `config.format` is a JSON object (metric/collection) to a supported string format (`number|integer|currency|percent`) per a mapping table stated in the migration header, or removes it where the table says so.
3. unit/prefix/suffix text moves into the live `unit` key on metric Outputs only where `unit` is absent or JSON null; a live non-null `unit` is never overwritten.
4. Every original `format` value is recorded in an admin-only audit table (V117 pattern), one row per rewritten Output, with the action taken.
5. Post-migration configs pass `OutputConfigValidation` for their kind, and the frontend readers (`isMetricFormat`) accept the new `format`.
6. Same proof standard as V117: real `hel904-real-dump.sql` fixture, NOSUPERUSER NOBYPASSRLS schema-owning role, NO FORCE/FORCE bracket (with mutation proof), idempotency, exact audit rows, superuser-side residual count, non-vacuous validator check.
