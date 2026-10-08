## Context

V94 §9 (`V94__outputs_model.sql` L746-757) built each migrated Output's config with `jsonb_strip_nulls` from the dropped
panel columns. It wrote these keys whatever the Output's kind:

- `metricLabel` and `metricUnit` (TEXT, V44);
- `columnWidths` (object, V53);
- `tableDensity` (TEXT, V55) and `columnOrder` (array, V55);
- `chartOptions` (object, V56);
- `collectionOptions` (`{baseType, layout, itemOptions}`, V57);
- `timelineOptions` (`{sort}`, V58);
- `chartAnnotation` (TEXT, V59);
- `format` (from `metrics.format` on `metric_id` panels, including chart panels).

HEL-877's deep merge left `legend`, `tooltip`, `seriesColors` and `axisLabels` on Output config. Live keys per kind are
`OutputConfigValidation.KnownKeys` (HEL-1313). Renderers read config through `outputConfigTypes.ts` `read*Config`, which
accepts `label`/`unit` only as strings, `annotation` as a string or null, `layout` as `"list"` (anything else becomes
grid), and `sort` as `"desc"` (anything else becomes asc). `CollectionRenderer`'s `metricOptions` prop is never passed by
`PanelContent`, so `collectionOptions.itemOptions` has no reader. Table widths have been local-only since HEL-909.

`outputs` has FORCE ROW LEVEL SECURITY, and its policies are `missing_ok` (V94 §2/§22, `helio_can_access_pipeline`). An
UPDATE by Flyway's `helio` connection without a bracket matches zero rows **silently**. This is the fail-silent class
described in `FlywayNonSuperuserMigrationSpec`'s header.

Dev measurement (read-only, 2026-10-08): `hel904-output-dd3362d1…` (timeline, `timelineOptions {sort: asc}`) and
`hel904-output-143500a9…` (chart, `format: {}`). That is 2 of 2212 Outputs.

## Goals / Non-Goals

**Goals:** do the owner-ruled rename/drop (Q1-Q4, 2026-10-08), make it idempotent, never overwrite a non-null live key,
prove it under the prod role shape, and make it reversible via the audit table.

**Non-Goals:** see proposal.md. No Scala/TS production code changes. Out of scope (follow-up): V94 copies
`metrics.format` as a JSON object onto metric Outputs, but `isMetricFormat` accepts only a string, so those Outputs
lose their format at render. That is the same class of bug but outside the rulings.

## Decisions

**D1 — Mapping table (copied verbatim into the migration header).**

| Dead key | Kinds where renamed | Live key | Rename only if the value is | Otherwise |
|---|---|---|---|---|
| `metricLabel` | metric | `label` | a JSON string | drop |
| `metricUnit` | metric | `unit` | a JSON string | drop |
| `chartAnnotation` | chart | `annotation` | a JSON string | drop |
| `collectionOptions.layout` | collection | `layout` | `"grid"` or `"list"` | drop |
| `timelineOptions.sort` | timeline | `sort` | `"asc"` or `"desc"` | drop |
| `collectionOptions` (whole, incl. `baseType`/`itemOptions`) | — | none | — | drop |
| `timelineOptions` (whole) | — | none | — | drop |
| `columnWidths`, `tableDensity` | — | none | — | drop |
| `legend`, `tooltip`, `seriesColors`, `axisLabels` | — | none (chart styling lives on panel `appearance.chart`) | — | drop |
| `format` on chart/table/timeline/markdown | — | none | — | drop (Q3) |
| `columnOrder` on non-table, `chartOptions` on non-chart | — | none | — | drop (Q3) |

The "renamed" cases apply to all Outputs, not only `hel904-output-*` ids: a dead key is dead regardless of origin, and
every change is audited. On a kind outside the rename column (e.g. `metricLabel` on a chart), the key is dropped.

**D2 — Live-key precedence and the audit-row contract (owner Q1/Q2).** If a live key is absent or JSON `null`, it is
filled from the dead key. A non-null live key wins. The audit table gets **exactly one row per removed top-level key**
(`config_value = config -> key`, the full original JSON). Its `action` column is the first match in this order:

1. `kind-inapplicable` — only two cases: a rename source (`metricLabel`, `metricUnit`, `chartAnnotation`,
   `collectionOptions`, `timelineOptions`) on a kind other than its D1 rename kind, or `format`/`columnOrder`/
   `chartOptions` on a kind whose `KnownKeys` lacks it. No other key is ever `kind-inapplicable`.
2. `no-live-equivalent` — `columnWidths`, `tableDensity`, `legend`, `tooltip`, `seriesColors` or `axisLabels`, on
   any kind.
3. `null-value` — the rename source is JSON null, or the nested `layout`/`sort` field is absent or null.
4. `invalid-value` — the rename source fails the D1 shape guard.
5. `shadowed-by-live` — the live key is present and non-null.
6. `renamed` — the live key was written; `live_key` holds its name.

For `collectionOptions`/`timelineOptions` the single row stores the whole original object, so `baseType`/`itemOptions`
are kept in `config_value` even though only `layout`/`sort` is carried over. `live_key` is NULL except for `renamed`.
V117 does **not** touch `updated_at`: this is a storage repair with no visible change except the restored rendering, and
bumping it would reorder "recently updated" lists.

**D3 — Value-shape guard.** A value that fails the D1 shape guard (e.g. a numeric `metricLabel`) is dropped as
`invalid-value`. Renaming it would not change the render, because the readers' type checks ignore it. Self-approved.

**D4 — Audit table (owner Q4).** `hel1387_dropped_output_config_keys(output_id TEXT NOT NULL, output_kind TEXT NOT NULL,
config_key TEXT NOT NULL, config_value JSONB NOT NULL, action TEXT NOT NULL CHECK (action IN (...six values...)),
live_key TEXT NULL, logged_at TIMESTAMPTZ NOT NULL DEFAULT now())`. Naming follows `hel904_dropped_field_mapping_slots`.
Unlike that table, this one holds user config values, so it is **admin-only**, mirroring V105 `oauth_states` exactly:

- `ENABLE` + `FORCE ROW LEVEL SECURITY`;
- `DROP POLICY IF EXISTS` + `CREATE POLICY hel1387_dropped_output_config_keys_deny_all ... USING (false)`;
- an explicit `GRANT SELECT ON hel1387_dropped_output_config_keys TO helio_privileged`. Default privileges are not
  trusted (V102/V105, HEL-974).

`RlsPolicyGuardSpec`'s `rlsTables` gains
`"hel1387_dropped_output_config_keys" -> Some(Set("hel1387_dropped_output_config_keys_deny_all"))`.

**D5 — RLS bracket.**
1. `NO FORCE ROW LEVEL SECURITY` on `outputs`.
2. `CREATE TABLE IF NOT EXISTS` the audit table.
3. `NO FORCE` on the audit table. The table already exists on a re-run.
4. One PL/pgSQL DO block that loops over the affected rows, inserts audit rows and UPDATEs the configs.
5. The D7 guard.
6. `ENABLE`/`FORCE` RLS, the policy and the grant on the audit table.
7. `FORCE` on `outputs`.

This mirrors V94 §0/§22 and V112. `outputs` has no triggers, so it needs no other bracket. Do not set
`app.current_user_id` and do not use BYPASSRLS; V94's header rules both out.

**D6 — Idempotency.** Every statement is re-runnable (IF NOT EXISTS, DROP POLICY IF EXISTS, GRANT, the FORCE toggles).
The DO block only touches rows that still carry a dead key. Re-running on clean data writes nothing. A re-run that does
find work, because a dead key was put back as a patch-set rollback could do, succeeds and appends new audit rows.

**D7 — In-migration guard.** After the UPDATE, `RAISE EXCEPTION` if any `outputs` row still carries a dead key. The guard
alone is not trusted: RLS makes a missing bracket fail silently. The spec's superuser-side count in D8 is the backstop.

**D8 — Test: `V117DeadOutputConfigKeysMigrationSpec`.**

Setup:
- As a NOBYPASSRLS, schema-owning role with `helio_privileged` pre-seeded (the `FlywayNonSuperuserMigrationSpec`
  recipe), migrate to V93, then load `hel904-real-dump.sql`.
- On real dump panels of each kind, set the legacy columns (`metric_label`, `metric_unit`, `chart_annotation`,
  `column_widths`, `table_density`, `collection_options`, `timeline_options`, `column_order`, `chart_options`), so V94
  itself produces the dead keys.
- Q3 `format` comes only from `metric_id` panels. Bind one **chart** panel and one **metric** panel to a real
  `metrics` row. After V117 the chart's `format` must be dropped as `kind-inapplicable`, and the metric's `format` must
  be byte-identical.
- Migrate to V116 as the role.
- Add post-V94 Outputs for the edge cases: a null live key, a non-null live key (`layout: grid` + `list`), an invalid
  shape, a dead key on the wrong kind, `legend`/`tooltip`, a non-hel904 id, and a clean control Output that must stay
  byte-identical.
- Count dead keys **over a superuser connection** before and after.

Assertions:
- Migrate to V117 as the role. Assert exact per-Output configs, exact audit rows (key, action, live_key, value), zero
  remaining dead keys, and unchanged `updated_at`.
- **Validation (AC7, made non-vacuous).** For every migrated config:
  - `config.keys ⊆ KnownKeys(kind)`;
  - `OutputConfigValidation.validate(kind, cfg, JsObject.empty)` is `Right`;
  - `validate(kind, cfg, cfg)` is also `Right`, which is the AC's literal wording.

  Show that both of the first two checks are `Left`/false on the pre-V117 configs, so they can fail.
- **Idempotency.**
  - Re-execute the V117 file as the role: configs and audit rows are unchanged.
  - Then put a dead key back on one Output (superuser) and re-execute as the role. It succeeds, renames or drops the
    key, and appends exactly one audit row.
- **Audit-table posture.**
  - Under `helio`, with the migration role and app context set, `SELECT count(*)` = 0.
  - Under `SET ROLE helio_privileged` and under the superuser it is N.
- **Mutation.** Removing the `outputs` NO FORCE bracket turns the spec red. The transcript goes in the executor report.

**D9 — Existing specs.** `V94OutputsMigrationSpec` and others pinned to a target version are unaffected. Any spec that
migrates to latest and then asserts a dead key fails as a contract change, not a symptom. Each such edit is named in
`files-modified.md` with this reason.

## Risks / Trade-offs

- **Patch-set rollback (decision: accept and file a follow-up).** `PatchSetUndoService` restores a journaled pre-V117
  config with `OutputConfigWritePolicy.RestorePriorStored`, so rolling back a patch set applied before V117 can
  reintroduce dead keys and lose the renamed live key. Journals are point-in-time records, and rewriting history to
  match a later migration would falsify them. The restored state is still readable (HEL-1313 tolerance), so nothing
  breaks. Follow-up (task 3.1): normalise dead keys on
  `RestorePriorStored`. A V117 re-run would also repair them (D6).
- Prod count unknown (owner-only read). The audit table makes every change recoverable.
- The shared dev DB is never migrated by this lane before merge. Tests use EmbeddedPostgres only.

## Planner Notes

- Self-approved: D3 shape guard, D4 admin-only via FORCE RLS + deny-all policy + explicit helio_privileged grant (the
  driver asked for "RLS or admin-only"), D1 applying to all Outputs, D9.
- Owner rulings (2026-10-08): option 1, Q1 null-is-absent-fill, Q2 drop-it, Q3 include-in-V117, Q4 audit-table.
- Flyway version V117 is assigned by the driver. If it is taken at execution time, stop and escalate.
