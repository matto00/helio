## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `67f96f5c27e3a483b351f6bad2673ae1df87f0c8` (planning artifacts untracked in the change dir).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/migrate-legacy-metric-format/HEL-1410`.

### What I verified (with evidence)

**Round-1 change requests**

- **CR1 (V94OutputsMigrationSpec) is resolved.** D8 now names `persistence/pipelines/V94OutputsMigrationSpec`, says
  "Do NOT pin it", and gives the fix: the metric/collection branch asserts that `format` is an `isMetricFormat` string
  and that the `hel1410_migrated_output_formats` row's `original_format` equals V94's object. It also says to correct
  the comment. Task 2.8 matches. I confirmed the target exists at `V94OutputsMigrationSpec.scala` L705-711: the
  `Set("metric","collection").contains(kind)` branch, with the comment "keep it byte-identically". The fix can be
  implemented with the `superDb` handle the branch already uses.
- **CR2 (validity-loop scope) is resolved.** D7 scopes the validity check to the rewritten set plus the string-format
  metric control. The table and non-object controls are "asserted byte-identical only, never validated". Task 2.3
  matches. I confirmed this is necessary: `OutputConfigValidation.KnownKeys(Table)` does not contain `format`, so
  `validate(table, {format: ...}, {})` would be `Left`.
- **Round-1 non-blocking notes were absorbed.** D7 now says `validate` checks key names only and is not the format
  proof, and that the `isMetricFormat`-set check, false before V118, is the red/green proof. The Jest seam asserts
  `format: null` for the original dump object. D1 says a JSON-null field inside the object is plain absent (no code),
  and D7 has a JSON-null edge. There is a non-object `config` control. The collection panel comes from the real dump
  via V117's `outputPanel` selection, with no post-V94 insert. The measurement line was refreshed in design.md, but
  proposal.md was not (see notes).

**Independent review**

- **V118 is free.** `git ls-tree origin/main` (origin/main = `67f96f5c`) shows V117 as the highest migration. The
  only non-dependabot open PR is #865, and it touches no migration files.
- **V117 RLS/idempotency pattern exists to mirror.** `V117__…sql` L37 is `outputs NO FORCE`, L40 is
  `CREATE TABLE IF NOT EXISTS`, L52 is audit `NO FORCE`, L173-179 is FORCE + `DROP POLICY IF EXISTS` + CREATE POLICY +
  GRANT + `outputs FORCE`. D4's order is the same.
- **V117 spec harness supports D7.** L95 migrates to 93, L111-115 has `outputPanel(kind)` and the bind to
  `6df6f851…`, L118 migrates to 116, L127-129 is the superuser `ins` helper, and L252-255 is the validity loop.
  `outputPanel("collection")` is a straightforward reuse.
- **Every D2 code has an edge Output that triggers it:**
  - decimals-capped: decimals 3
  - decimals-not-fixed: decimals 1, or the real dump object
  - decimals-ignored: `"2"`
  - prefix-after-value: `€`, `$`+0, `$`+1
  - text-joined: the real dump object
  - text-shadowed: non-null live unit
  - text-dropped-collection: collection with text
  - text-ignored-non-string: non-string `unit` in the object
  - unknown-keys-ignored: unknown key

  Every D1 row and unit branch is also covered: integer, currency, number, written, shadowed (including a numeric live
  unit), no-text, and kind-has-no-unit.
- **D1 table is deterministic.** It is first-match, and the decimals validity rule, the string/trim rule and the
  null-is-absent rule are all stated. I walked through `$`+0 → integer with unit `$` (prefix-after-value), and `$`+1 →
  number with unit `$` and {decimals-not-fixed, prefix-after-value}. Each gives exactly one answer.
- **D1 matches the owner ruling.** D1 states the ruling recorded for escalation `HEL-1410-1791498651450-895c84`
  (round 1 checked this against events.jsonl). I did not review the product choice.
- **Validator claim.** `OutputConfigValidation.validate` checks unknown keys, chartType and aggregation only, so the
  rewritten metric/collection configs (`format`/`unit`, both in KnownKeys) will be `Right`. D7 states this correctly.
- **Other latest-migrating specs that mention `format`.** I grepped for specs that both migrate to latest and mention
  `format`. The hits are `OutputRoutesSpec`, the V117 spec (pinned per D8) and the V94 spec (fixed per D8).
  `OutputRoutesSpec` creates Outputs through the API after migration, so V118 has nothing to rewrite there. D8's
  "grep every other spec" step covers it.
- **Spec delta.** It is an ADDED requirement. Its six scenarios match D1 exactly (real object → `number` +
  `"~ pts /10"`; `$`+2 → currency with no unit; decimals 0 + `%` + `unit: null` → integer + `%`; shadowed; collection;
  re-run).
- **ACs are covered.** AC1 is the measurement in design.md, with prod flagged owner-only. AC2 is tasks 1.1/1.3. AC3 is
  the D1 unit rule. AC4 is D3 and task 1.2. AC5 is D7 validity plus the Jest seam. AC6 is D7: real dump, the role,
  bracket mutation, idempotency, exact audit rows, superuser count, and the non-vacuous format proof.

### Verdict: CONFIRM

### Non-blocking notes

- proposal.md "Impact" still says "0 affected of 2212". design.md was refreshed to 2286 at V117. Sync the proposal.
- D1 says "`btrim`med". Postgres `btrim(x)` strips only spaces, not tabs or newlines. The "whitespace-only text" edge
  should use spaces only, or the migration should use a regex trim. Either way, record which in the header so the
  test and the SQL agree.
- D8's V94-spec branch is still never executed against that dump, because the only `metric_id` panel is a chart. Add
  a short comment saying so, so no one counts it as coverage. V118's own spec is the real proof.
- In the seam Jest, "(and metric unit)" should compare `unit` to the fixture's value. For rows where `unit` is
  numeric (the shadowed numeric live unit) or absent, the reader returns `undefined`/`null`. Do not assert non-null
  there.
