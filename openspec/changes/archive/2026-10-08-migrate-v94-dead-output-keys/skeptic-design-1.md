## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed the uncommitted change dir at HEAD 76816d406e15f10ee1c53431fea801cb18637062 (the artifacts are untracked).
I did not relitigate the owner rulings Q1-Q4. Everything below is about whether the design implements them soundly.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/migrate-v94-dead-output-keys/HEL-1387`.
- **V117 is free:** `git ls-tree origin/main .../db/migration/` tops out at `V116__node_payload_history.sql`.
- **The V94 key list is accurate.** `V94__outputs_model.sql` L746-757 writes `metricLabel`, `metricUnit`,
  `columnWidths`, `tableDensity`, `columnOrder`, `chartOptions`, `collectionOptions`, `timelineOptions` and
  `chartAnnotation` with `jsonb_strip_nulls` for every kind. L707 adds `format` from `metrics.format`, with no strip,
  for any `metric_id` panel. `out_config` starts as `'{}'` (L696). The design's Context matches this.
- **The D1 mapping matches the live readers.**
  - `OutputConfigValidation.KnownKeys`: chart has `chartOptions` and `annotation`. Metric has `label`, `unit` and
    `format`. Table has `columnOrder`. Collection has `layout` and `format`. Timeline has `sort`.
  - So the Q3 set is exactly right: `format` is dropped on chart, table, timeline and markdown; `columnOrder` on
    non-table; `chartOptions` on non-chart.
  - The renderers read through `outputConfigTypes.ts`: `MetricOutputPanel` (`cfg.label`/`cfg.unit`), `ChartOutputPanel`
    L122 (`cfg.annotation`) and `PanelContent` L341-357 (`cfg.layout`/`cfg.sort`).
  - I grepped every dead key across `frontend/src`, `backend/src/main` and `helio-mcp/src`. The only hits are local
    props (`OutputPreviewPane`), panel-era types and comments. None reads them from Output config. The design's
    "dead" claim holds.
- **The dev measurement is reproduced.** I ran a read-only query (`default_transaction_read_only=on`) as a
  superuser/BYPASS role (`rolsuper or rolbypassrls = t`), so RLS did not hide any rows. It listed every config key
  outside KnownKeys and returned exactly `chart|format|1` and `timeline|timelineOptions|1` across 2212 outputs. This
  matches design.md.
- **The RLS premise is right.** `outputs` has `relforcerowsecurity = t`. V94 L29-110 documents the missing_ok,
  fail-silent policies. No trigger exists on `outputs` (grep `ON outputs` finds only indexes and policies), so
  `NO FORCE` on `outputs` alone covers the UPDATE.
- **The test recipe exists.** `FlywayNonSuperuserMigrationSpec`'s header documents the non-superuser plus real-dump
  recipe and the superuser-side backstop. The dump has collection (one with real `collection_options`), timeline,
  chart, metric, table and markdown/text panels.
- **Mutation logic holds.** If the `NO FORCE` bracket is removed, the DO block sees zero rows and the D7 guard
  passes vacuously. The superuser after-count then still shows dead keys, so the spec goes red. D8's mutation is
  sound.

### Verdict: REFUTE

Each item below is something an implementer would build wrong, or test vacuously, if they followed the artifacts as
written.

### Change Requests

1. **The D8 / task 2.4 AC7 assertion is vacuous: it passes on unmigrated data.**
   - The plan asserts `OutputConfigValidation.validate(kind, cfg, cfg)` is `Right`. By construction that is `Right`
     for every config, including one still full of dead keys:
     - `tolerated()` accepts any key whose written value equals the stored value.
     - `changed()` returns `None` for `chartType` and `aggregation` when written equals stored.
     - So there are no offending keys and no shape check runs (OutputConfigValidation.scala `validate`, `tolerated`,
       `changed`, `validateAggregation`).
   - Keep that assertion, because it is the AC's literal wording. Add a non-vacuous one alongside it: every migrated
     config's keyset ⊆ `KnownKeys(kind)`, and/or `validate(kind, cfg, JsObject.empty)` is `Right`.
   - Show it is **red against the same Outputs' pre-V117 configs**, which you capture before migrating to V117.
   - If the strict variant fails for a reason unrelated to V117, say why and fall back to the keyset check. Do not
     drop the check.

2. **D4's audit-table posture rests on a false precedent and leaves a decision open.**
   - D4 says "no policies … the same posture as `oauth_states`". But `V105__oauth_states.sql` L43 creates an
     explicit `oauth_states_deny_all` policy, and `RlsPolicyGuardSpec` encodes
     `"oauth_states" -> Some(Set("oauth_states_deny_all"))`.
   - D4 also says "BYPASSRLS `helio_privileged` … can still read it". That relies on V38's
     `ALTER DEFAULT PRIVILEGES`, which this repo has explicitly refused to rely on (V102 and V105 headers, HEL-974:
     three prod-only grant incidents).
   - On Cloud SQL there is no true superuser, so without a working grant the "reversible via the audit table" goal
     may be unreachable in prod.
   - Revise D4 and tasks 1.2/2.5:
     - mirror V105: an explicit deny-all policy, re-runnable as `DROP POLICY IF EXISTS` + `CREATE POLICY`;
     - add an explicit `GRANT SELECT ON hel1387_dropped_output_config_keys TO helio_privileged`;
     - state the exact `RlsPolicyGuardSpec` entry (`Some(Set("<name>_deny_all"))`) rather than "the executor checks
       how that spec encodes it".
   - In the test, define "app role cannot SELECT" precisely: `helio` sees **0 rows**, not a permission error, while
     the superuser sees N. Also assert that `helio_privileged` sees N.

3. **The D5 bracket breaks on any re-run that has work to do, and task 1.2 contradicts D5's ordering.**
   - D5 creates the audit table without FORCE and applies FORCE at the end. Task 1.2 says "IF NOT EXISTS,
     ENABLE+FORCE RLS" with no ordering.
   - On a re-execution, `CREATE TABLE IF NOT EXISTS` is a no-op and the table is already FORCE'd with deny-all. Any
     INSERT then fails with an RLS violation for the owner `helio`. For example, a dead key re-introduced by the
     `RestorePriorStored` rollback that the Risks section accepts would hit this.
   - D6's "whole file is re-runnable" holds only when there is nothing to do, and the D8 re-run (on fully migrated
     data) cannot detect this.
   - Fix it:
     - add `ALTER TABLE hel1387_dropped_output_config_keys NO FORCE ROW LEVEL SECURITY` immediately after the
       CREATE, inside the bracket;
     - reword task 1.2 to follow D5's order;
     - add a re-run case where one Output has had a dead key re-inserted (over the superuser connection) before the
       second execution. Assert it is migrated and audited, and that every other config and audit row is unchanged.

4. **The audit-row contract is under-specified, but the test asserts exact audit rows.** Specify deterministically,
   in D1/D4 and in the migration header:
   - a precedence order when several actions could apply (for example a JSON-null `format` on a chart: `null-value`
     or `kind-inapplicable`? A non-string `metricLabel` with a non-null `label`: `invalid-value` or
     `shadowed-by-live`?);
   - which action covers a renamable dead key on the wrong kind (`metricLabel` on a chart: `kind-inapplicable` or
     `no-live-equivalent`?);
   - how a nested rename is recorded: is `config_key` `collectionOptions.layout` or `collectionOptions`? Is it one row
     carrying the whole object with action `renamed`, or two rows (a `renamed` row for `.layout` plus a
     `no-live-equivalent` row for the remaining object)?
   - D2 uses `reason = '…'` while D4 names the column `action`. Use one name.

5. **The spec delta states an invariant the design knowingly breaks, and the promised follow-up has no task.**
   - `specs/outputs-model/spec.md` says "After migration V117, no `outputs.config` SHALL carry …". That is a
     standing invariant.
   - design.md Risks accepts that `PatchSetUndoService` with `RestorePriorStored` can reintroduce dead keys after
     V117.
   - Rescope the requirement to what V117 does: "migration V117 SHALL rename/drop … in every row existing when it
     runs".
   - Add a task to file the "normalise dead keys on `RestorePriorStored`" follow-up, labelled Follow-up and related
     to HEL-1387. The design says "decision: accept and file a follow-up", but no task owns the filing.

6. **Name the Q3 `format` case explicitly in the D8 fixture plan.**
   - The only real dev instance of Q3 is a V94-produced `format` on a **chart** that came from a `metric_id` panel
     (`hel904-output-143500a9…`, `format: {}`). D8's "set legacy columns" does not produce `format`: only a
     `metric_id` panel with a `metrics` row does (V94 L703-707).
   - Require in D8/task 2.1/2.2:
     - (a) a V94-produced `format` on a chart Output, from a dump `metric_id` chart panel, or by setting
       `metric_id` on one, which must be dropped as kind-inapplicable;
     - (b) a V94-produced `format` on a metric Output, which must be **retained untouched**. This is the
       never-overwrite and keep-live-key negative control.
   - Also state that `columnOrder` on a non-table and `chartOptions` on a non-chart are produced by V94 itself from
     the legacy columns, not only hand-inserted.

### Non-blocking notes

- **`format` on a metric Output can be silently lost.** V75 makes `metrics.format` a JSONB **object** (dump row
  `6df6f851…`: `{"unit":"pts","prefix":"~","suffix":"/10","decimals":2}`), and V94 L707 copies it onto metric
  Outputs as `format`. `readMetricConfig` honours only the strings `number | integer | currency | percent`, so such an
  Output silently loses its unit, prefix, suffix and decimals. This is the ticket's own defect class through a key
  that is "live" but has a dead value shape. It is outside the owner rulings, so do not fix it here. Do add a
  Non-goals line and file a follow-up. Dev today has only string-valued metric `format` (13 rows), so the prod count
  is unknown.
- **`outputs.updated_at` is unspecified.** The design does not say whether V117 bumps it. State the choice. Leaving
  it untouched, as HEL-1233's repair does with `lastUpdated`, seems right for a data-shape fix.
- **`config_value JSONB NOT NULL` needs `config -> key`, not `->>`.** That way a JSON-null value lands as
  `'null'::jsonb` and does not violate NOT NULL.
- **Minor Context inaccuracy:** `readChartConfig` does not type-check `annotation`; it casts. This is harmless to D3.

### Gate defects

None. The prior reports in this change dir make no mtime- or evidence-ordering claims.
