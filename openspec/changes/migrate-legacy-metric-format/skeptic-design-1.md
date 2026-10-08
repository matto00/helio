## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `67f96f5c27e3a483b351f6bad2673ae1df87f0c8` (planning artifacts are untracked in the change dir).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/migrate-legacy-metric-format/HEL-1410`.

### What I verified (with evidence)

- **Owner ruling is real and matches D1.** Main checkout `.concertino/runs/HEL-1410/events.jsonl` L4-5:
  `escalation.raised` proposes "TABLE (A): decimals=0 -> integer; prefix exactly "$" and decimals absent/2 ->
  currency (prefix consumed); everything else incl {} -> number. unit (metric only, only if live unit absent/null) =
  space-join of non-empty [unconsumed prefix, unit, suffix]"; `escalation.answered` `answer: map-approximate`,
  `answer_source: human`. D1's table and unit rule state it faithfully. Product choice not reviewed (out of scope).
- **V94 §9 claim true.** `V94__outputs_model.sql` L703-707: `SELECT ... format INTO metric_row FROM metrics` then
  `out_config := out_config || jsonb_build_object('format', metric_row.format)` for every `metric_id` panel, any kind.
- **V75 shape true.** `V75` L27 `format JSONB NOT NULL`.
- **V117 leaves metric/collection `format` alone.** `V117__...sql` DO block: `ELSIF k = 'format' THEN CONTINUE WHEN
  r.kind IN ('metric','collection')`. V117 also renames `metricUnit` → `unit` (so real V94 metric Outputs may already
  carry a live `unit`; D1's shadowed branch covers this).
- **Readers/renderer claims true.** `outputConfigTypes.ts` L111-113 `isMetricFormat` = the four strings; L264-287
  `readMetricConfig`/`readCollectionConfig` use it, `unit` read only `typeof === "string"`. `MetricRenderer.tsx`
  L26-50 `formatMetricValue` behaviour matches design's description. `MetricOutputPanel.tsx` L105/L113/`MetricRenderer`
  L123: `cfg.unit` rendered after the value.
- **KnownKeys / validator claims true.** `OutputConfigValidation.scala` L23/L25: metric has `unit`+`format`,
  collection has `format` (no `unit`). `validate` checks key names, chartType and aggregation only — never the
  `format` value or `unit` type.
- **Real-dump fixture contents true.** `hel904-real-dump.sql` L8815-8817: three `metrics` rows, `{}`, `{}`, and
  `6df6f851…` `{"unit": "pts", "prefix": "~", "suffix": "/10", "decimals": 2}`. Only one dump panel has a
  `metric_id` (chart `143500a9…` → `a6c406ce…` `{}`), so the spec must bind metric/collection panels itself (D7 does).
- **Dev measurement re-run (read-only, `default_transaction_read_only=on`, role `matt` is superuser so RLS hides
  nothing):** `0|2286|13|0` = 0 metric/collection object formats, 2286 outputs, 13 metric string formats, 0 object
  formats on any kind. Dev is now at V117 (`max(version)=117`). The 0 claim holds; design's "V116, of 2212" is stale.
- **V117 spec contract break (D8) true.** `V117DeadOutputConfigKeysMigrationSpec.scala` L175
  `flyway(None).migrate()`; L199 asserts the metric Output's `format` equals the pre value — V118 rewrites it.
- **RLS pattern.** `RlsPolicyGuardSpec.scala` L157-158 lists `hel1387_dropped_output_config_keys` — D3's entry plan
  matches. `FlywayNonSuperuserMigrationSpec` pre-seeds `helio_privileged` (L110-111) and migrates to latest, so V118's
  GRANT will run there (task 2.9 includes it).
- **Seam-fixture mechanism has precedent.** `frontend/src/utils/aggregate.fixture.test.ts` reads a backend-shared
  fixture via `fs.readFileSync` (HEL-1271).
- **Other latest-migrating specs scanned.** Real-dump specs: `SchemaFieldRealDumpInvariantSpec` (target 93),
  `V96…` (95), `DatasetRowsReaderBehaviorPreservingSpec` (93/105), `V106…` (105) — unaffected.
  `V94OutputsMigrationSpec` migrates to latest (L238-243) and has a format assertion — see CR 1.
- **Main spec.** `openspec/specs/outputs-model/spec.md` V117 requirement (L51+) does not claim metric `format` is
  preserved, so an ADDED requirement (not MODIFIED) is correct.
- D4 bracket order, D5 idempotency, D6 guard, D7 mutation/posture/superuser-count plan mirror V117's proven harness.

### Verdict: REFUTE

Two small, concrete revisions. Both are places where an implementer following the text literally gets a wrong
or failing result.

### Change Requests

1. **D8 / task 2.8 misses `V94OutputsMigrationSpec` and prescribes the wrong fix for it.**
   `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala` migrates to
   latest (L238-243). At L705-711 it asserts `if (Set("metric","collection").contains(kind)) ...fields("format")
   shouldBe fmt.parseJson`, and its comment says "metric and collection Outputs keep it byte-identically". After V118
   that is false. It does not fail today only because the dump's single `metric_id` panel is a chart, so the branch
   never runs. D8's catch-all ("gets the same treatment", meaning pin to 117) is the wrong fix here. This suite runs
   repository tests against the latest schema, and pinning it would freeze it out of every future migration. Name this
   spec in D8/tasks 2.8 and state the fix. Either (a) change the metric/collection branch to assert V118's mapped
   string format and correct the comment, or (b) remove the branch and comment that V94-produced metric/collection
   formats are now covered by `V118LegacyMetricFormatMigrationSpec`. Either way, do not pin.
2. **The scope of D7's validity loop conflicts with its own table control.** D7 asks for a byte-identical control
   "a table Output with an object `format` (out of scope)". It then asserts "keys ⊆ `KnownKeys(kind)`, and
   `validate(kind,cfg,{})` / `validate(kind,cfg,cfg)` are `Right`" without saying which Outputs that covers. V117's
   spec ran this over every Output (`for ((id,(kind,cfg)) <- post)`). Run that way here, `format` is not a table key,
   so `keysOk` is false and `validate(table, cfg, {})` is `Left` for that control. The test would go red, or an
   executor would quietly delete the control to make it green. State the scope in D7/task 2.3. Either the loop covers
   only metric/collection Outputs plus the other controls, with the table control excluded and the reason given, or
   the out-of-scope control is made one that still validates.

### Non-blocking notes

- Refresh the measurement line: dev is now V117 with 2286 outputs, and the count is still 0 (re-measured above).
- AC6 "non-vacuous validator check": `OutputConfigValidation.validate` never inspects the `format` value, so it passes
  both before and after V118. The non-vacuous evidence is the `isMetricFormat`-set check shown false before V118. Say
  so explicitly in D7 so the evaluator does not count `validate` as the red/green proof.
- Seam Jest test: also assert that the reader returns `format: null` for at least one original object. That shows the
  test can go red, not just that post-V118 configs read.
- D1 "a present non-string records `text-ignored-non-string`" and "decimals otherwise ... `decimals-ignored`" both
  apply to JSON `null` values inside the object (`{"unit": null}`, `{"decimals": null}`). That is deterministic, but
  the planner should confirm it is intended. Add a `null`-inside-object edge Output either way.
- Add a non-object `config` control (V117 had `e-array-config`): `config->'format'` on an array is NULL, so it
  should be untouched with no audit row.
- Collection panel from the dump: the dump has 9 collection panels. Reuse V117's `outputPanel("collection")` join so
  V94 itself produces the collection object, and fall back to a post-V94 insert only if that query is empty. State
  which path was taken in the executor report.
