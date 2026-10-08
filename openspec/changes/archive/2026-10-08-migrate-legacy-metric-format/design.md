## Context

V75 `metrics.format` is JSONB written from HEL-446 `MetricFormat(unit: Option[String], decimals: Option[Int],
prefix: Option[String], suffix: Option[String])` (spray omits `None`). V94 §9 (`V94__outputs_model.sql` ~L705) did
`out_config || jsonb_build_object('format', metric_row.format)` for every `metric_id` panel, of any kind, then dropped
`metrics`. V117 removed `format` from every kind except metric/collection, so after V117 the only object-valued
`format` left is on metric/collection Outputs.

Readers (`outputConfigTypes.ts`): `readMetricConfig`/`readCollectionConfig` keep `format` only if
`isMetricFormat` (`"number"|"integer"|"currency"|"percent"`), else `null`. `formatMetricValue` (`MetricRenderer.tsx`):
`integer` = 0 fraction digits, grouped; `currency` = USD, fixed 2; `percent` = ×100; `number`/null = max 2, ungrouped.
`unit` is metric-only (`OutputConfigValidation.KnownKeys`), read only as a string, rendered after the value
(`MetricOutputPanel.tsx` L105). Collection has no `unit` key. Backend validation checks key names only, not the
`format` value.

`outputs` has FORCE RLS with `missing_ok` policies: an unbracketed UPDATE by Flyway's `helio` role matches zero rows
silently (V117 header, `FlywayNonSuperuserMigrationSpec`).

Measurement (read-only, 2026-10-08): dev DB has 0 metric/collection Outputs with an object `format` (0 of 2212 at
V116; re-measured by the design skeptic at V117: 0 of 2286); 13 metric Outputs hold valid strings. `hel904-real-dump.sql` holds three `metrics` rows:
`{"unit":"pts","prefix":"~","suffix":"/10","decimals":2}` and two `{}`. Prod count: owner-only.

## Goals / Non-Goals

**Goals:** apply the owner's map-approximate ruling exactly; never overwrite a non-null `unit`; record every original
and every approximation; idempotent; proven under the prod role shape (same standard as V117).

**Non-Goals:** see proposal.md. No Scala/TS production change; no new format strings.

## Decisions

**D1 — Mapping table (owner ruling map-approximate; copied verbatim into the migration header).** Applies only to
rows with `kind IN ('metric','collection')` and `jsonb_typeof(config->'format') = 'object'`. Field reads:
- `decimals` is *valid* iff a JSON number that is a non-negative integer (`2` and `2.0` are 2). Absent or JSON null is
  plain absent (no code). Any other value is treated as absent and `decimals-ignored` is recorded.
- `prefix`/`unit`/`suffix` count iff a JSON string; each is trimmed with `btrim(v, E' \t\r\n')` (spaces, tabs, CR, LF; named in the header) and an empty result is absent. Absent or JSON
  null is plain absent (no code). Any other non-string records `text-ignored-non-string`.
- Any other key in the object records `unknown-keys-ignored`.

| Condition (first match) | `format` | prefix consumed |
|---|---|---|
| valid `decimals` = 0 | `integer` | no |
| trimmed `prefix` = `$` and `decimals` absent or 2 | `currency` | yes |
| anything else (incl. `{}`) | `number` | no |

`percent` is never produced (it multiplies by 100; a legacy `%` stays text). Unit text (metric only) = the
non-empty parts `[prefix unless consumed, unit, suffix]`, in that order, joined by one space.
- metric, text non-empty, live `unit` absent or JSON null → write `unit` (`unit_action = written`);
- metric, text non-empty, live `unit` non-null (any type) → untouched (`shadowed-by-live`, records `text-shadowed`);
- metric, no text → `no-text`;
- collection → `kind-has-no-unit`; non-empty text records `text-dropped-collection`.

**D2 — Approximation codes** (`approximations TEXT[]`, CHECK `<@` this set, in this order, each at most once):
`decimals-capped` (valid decimals ≥ 3, format `number`), `decimals-not-fixed` (valid decimals 1 or 2, format
`number`), `decimals-ignored`, `prefix-after-value` (an unconsumed prefix was written into `unit`), `text-joined` (≥2
parts written), `text-shadowed`, `text-dropped-collection`, `text-ignored-non-string`, `unknown-keys-ignored`. Example:
the real dump object on a metric with no unit → `number`, `unit "~ pts /10"`,
`{decimals-not-fixed, prefix-after-value, text-joined}`.

**D3 — Audit table** `hel1410_migrated_output_formats(output_id TEXT NOT NULL, output_kind TEXT NOT NULL,
original_format JSONB NOT NULL, new_format TEXT NOT NULL CHECK (new_format IN ('number','integer','currency')),
prior_unit JSONB NULL, unit_action TEXT NOT NULL CHECK (IN ('written','shadowed-by-live','no-text',
'kind-has-no-unit')), unit_written TEXT NULL, approximations TEXT[] NOT NULL, logged_at TIMESTAMPTZ NOT NULL DEFAULT
now())`. One row per rewritten Output. `prior_unit` is SQL NULL when the key was absent and `'null'::jsonb` when it was
JSON null, so a rollback can restore absent-vs-null exactly. A sibling, not V117's table: V117's `action` CHECK and
one-row-per-key shape do not fit, and altering a prior migration's table from V118 is worse (owner-approved). RLS is
V117's exactly: ENABLE + FORCE, `hel1410_migrated_output_formats_deny_all USING (false)`, explicit `GRANT SELECT ...
TO helio_privileged`; `RlsPolicyGuardSpec.rlsTables` gains the entry.

**D4 — RLS bracket and order** (mirrors V117 D5): `outputs` NO FORCE → CREATE TABLE IF NOT EXISTS → audit NO FORCE →
DO block (loop, INSERT audit, UPDATE config) → guard → audit ENABLE/FORCE/policy/grant → `outputs` FORCE. No
`app.current_user_id`, no BYPASSRLS. `updated_at` untouched (storage repair; V117 D2 rationale).

**D5 — Idempotency.** Every statement is re-runnable; the DO block only selects rows still holding an object
`format` on metric/collection, so a re-run on clean data writes nothing; a re-run after an object is put back (e.g.
patch-set rollback) maps it and appends one audit row.

**D6 — Guard.** RAISE if any metric/collection Output still has an object `format`. Cannot see a missing bracket (same
RLS state); the spec's superuser-side count is the backstop.

**D7 — Test `V118LegacyMetricFormatMigrationSpec`** (mirror `V117DeadOutputConfigKeysMigrationSpec`'s harness):
- NOSUPERUSER NOBYPASSRLS schema-owning role with `helio_privileged` pre-seeded; migrate to V93; load
  `hel904-real-dump.sql`; bind one metric panel to the real `6df6f851…` metrics row, one metric panel to a `{}` row, and
  one real collection panel (the dump has 9; same `outputPanel` selection as V117's spec) to `6df6f851…`, so V94
  itself produces all three objects (no post-V94 insert for these); migrate to V117 as the role.
- Superuser-insert post-V117 edge Outputs covering every D1 row/branch and D2 code: `$`+2, `$`+absent, `$`+0, `$`+1,
  `€` prefix, decimals 3, decimals 1, decimals `"2"` (string), JSON-null `decimals`/`prefix`/`unit`/`suffix`, `%` suffix + decimals 0 + `unit: null`, non-null live
  unit, numeric live unit, non-string `unit`, unknown key, whitespace-only text, collection with text, plus controls
  that must stay byte-identical: a metric with string `format`, a table Output with an object `format` (out of scope),
  a metric with no `format`, and a metric whose `config` is not a JSON object (V117 had the same control).
- Count object formats over a superuser connection before (>0) and after (0). Migrate to V118 as the role.
- Assert exact per-Output configs, exact audit rows (all columns except `logged_at`), unchanged `updated_at`.
- Validity, non-vacuous. Scope: every metric/collection Output that held an object `format` pre-V118 (the rewritten
  set) plus the string-format metric control; the table/non-object controls are asserted byte-identical only, never
  validated. Post-V118 each scoped `format` is a JSON string in the `isMetricFormat` set — this is the red/green
  proof, shown false on the same rows pre-V118. Keys ⊆ `KnownKeys(kind)` and `OutputConfigValidation.validate(kind,
  cfg,{})`/`validate(kind,cfg,cfg)` are `Right` post-V118; note `validate` checks key names only, so it is `Right`
  before V118 too — it guards against V118 introducing a bad key, it is not the format proof.
- Seam: the spec asserts the migrated configs equal `backend/src/test/resources/db/fixtures/hel1410-v118-expected-
  configs.json`; a frontend Jest test reads that same file and asserts `readMetricConfig`/`readCollectionConfig` return
  exactly the fixture's `format` and (metric) the fixture's `unit` value for every entry (equality, not non-null), and also return `format: null` for the original object
  from the real dump (shows the reader is the defect, and the test can fail).
- Idempotency: re-execute the V118 file as the role → unchanged; re-insert one object, re-run → mapped, +1 audit row.
- Audit posture: 0 rows as `helio` with app context; N under `SET ROLE helio_privileged` and superuser.
- Mutation: remove the `outputs` NO FORCE bracket → spec red; transcript in the executor report.

**D8 — Existing specs (contract changes, each named in `files-modified.md`).**
- `V117DeadOutputConfigKeysMigrationSpec` L175 migrates to latest then asserts the metric `format` byte-identical
  (L199): pin that migrate to target `117`; it is V117's own spec.
- `persistence/pipelines/V94OutputsMigrationSpec` migrates to latest (L237-242) and, at L705-711, asserts metric/
  collection Outputs keep V94's `format` byte-identically. Today only a chart is `metric_id`-bound so the branch is
  never hit, but it is now wrong. Do NOT pin it (its repository tests need the latest schema). Change the metric/
  collection branch to assert `format` is a JSON string in the `isMetricFormat` set and that the
  `hel1410_migrated_output_formats` row for that Output has `original_format` = V94's object; fix the comment, and
  state in it that this dump never exercises the branch (V118's own spec is the coverage).
- Grep every other spec that migrates to latest and reads `format` on outputs; any further hit is fixed the same way
  and named.

## Risks / Trade-offs

- [Approximation is lossy by design] → owner-ruled; every loss is a named code in the audit row, originals kept.
- [Prod count unknown] → audit table makes every change recoverable; owner can query it post-deploy.
- [Patch-set rollback restores a pre-V118 object] → still readable (renders unformatted, as today); a V118 re-run
  repairs it (D5). Same posture as V117.
- [Shared dev DB] → never migrated by this lane; EmbeddedPostgres only.

## Migration Plan

Applies on next backend boot after merge (driver warns other lanes). Rollback: from the audit table, restore
`format = original_format` and `unit` per `prior_unit`/`unit_action = written`.

## Planner Notes

- Owner ruling map-approximate (escalation `HEL-1410-1791498651450-895c84`, 2026-10-08), D1 table as proposed.
- Owner-approved: sibling audit table, V117 spec pinned to 117.
- Self-approved: decimals validity rule, whitespace trimming, D2 code set, `prior_unit` column, seam fixture.
- Flyway version V118 is driver-assigned; if taken at execution time, stop and escalate.
