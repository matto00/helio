# Evaluation Report — Cycle 3 (evaluation-3.md)

HEAD reviewed: `dc95ccc4`. Every number below is my own fresh measurement or my own
fresh command run; nothing is carried over from cycle 2, and the pre-scrub 3342/3342 I
recorded before the hold was discarded and re-run from scratch.

## Phase 1: Spec Review — PASS

Issues: none blocking.

- **Cycle-2 Critical Path item 1 (markdown-binding data loss) — CLOSED.** All five
  `text`/`markdown` call sites are symmetric, and I proved by mutation (below) that the
  fix is load-bearing.
- **Cycle-2 Critical Path item 2 (`pg_dump` fixture) — CLOSED.** design.md decision 3
  is now literally satisfied: the fixture is a real `pg_dump --data-only --inserts`
  snapshot, loaded verbatim, *replacing* the hand-built one.
- **Cycle-1 Critical Path items — remain closed** under the new fixture (re-proved by
  mutation, not assumed).
- **`tasks.md` bookkeeping is now honest.** Task 2.11 reads "(complete, cycle 3
  rewrite)"; task 2.13 no longer carries its expired deferral. `grep -E "^- \[x\].*\(partial"`
  returns only 2.5/2.7/2.8, which I assessed in cycle 2 and re-confirmed here: each is
  completed by a later section of the same migration, and I verified the end state
  directly. No task is marked done whose acceptance criterion is unmet.
- Remaining unchecked tasks are all correctly parked, not silently dropped: 0.1/0.2
  (tasks.md maintenance, superseded), 4.6 (HEL-689, deferred with justification), 5.5
  (`openspec archive` at delivery, by design), 6.5 (orchestrator at PR-merge).

### Required-shapes checklist — verified by me against the scrubbed fixture

I confirmed the fixture's migration-relevant tables are byte-identical to the
pre-scrub dump (per-table `md5sum` of every `INSERT` block: only `users` and one
`data_sources` row differ), and that the pre-scrub dump matched the live dev DB exactly
on all 11 tables. So these measurements are properties of the committed fixture:

| Required shape | Present |
| --- | --- |
| Every panel kind | 9 (`chart, collection, divider, image, markdown, metric, table, text, timeline`) |
| ≥1 HEL-292 `aggregation` panel | 14 (5 resolve to a pipeline) |
| ≥1 `metric_id` panel | 1 (resolves; 0 dangling) |
| ≥1 data-bound `text` panel | 2 |
| ≥1 data-bound `markdown` panel | **4** — the shape that was absent before |
| ≥1 unbound data panel | 28 |
| ≥1 orphan output type | 54 |
| ≥1 companion type | 139 |
| ≥1 computed field | 6 (5 pipeline-output, 1 on a pipeline-less type; 0 companion) |
| ≥1 alert rule | 0 in the dump; 2 seeded on top, **disclosed** in the spec header |
| ≥1 binary ref | 1 (does point at a pipeline-output type → `(pipeline_id, node_step_id)` keying correct) |
| ≥1 invalid `fieldMapping` slot | 1 (resolves, so it exercises the drop-and-log path) |
| ≥1 stranded panel | **88** |

The only two rows seeded on top of the dump (`alert_rules` ×2, `resource_permissions`
×1) are each justified in the spec header, and both are genuinely unavailable in the
dump — I confirmed the dev DB holds zero `alert_rules` and zero `alert_events`.

## Phase 2: Code Review — PASS

Gates, all re-run fresh by me at `dc95ccc4` in `WORKTREE_PATH` (`CLEAN_WORKTREE` unset):

| Gate | Result |
| --- | --- |
| `sbt 'set Test/parallelExecution := false' test` | **PASS** — `Total number of tests run: 3342`; `Suites: completed 225, aborted 0`; `Tests: succeeded 3342, failed 0`; `All tests passed`; exit 0 |
| `check:scala-quality` | PASS — "clean (130 soft warning(s))" |
| `check-schema-drift.mjs` | PASS — 60 checked across 46 protocol files; 7 panel-type surfaces in sync |
| `check-openspec-hygiene.mjs` | PASS — "openspec/ is clean" |
| `openspec validate --strict` | PASS — "Change 'outputs-model-migration' is valid" |
| `check:no-credential-leak` | PASS — "OK (12 files scanned, 0 violations)" — **but see the caveat below; this gate is not evidence for the fixture** |
| `grep -rnE "com\.helio\..*DataType" backend/src --include=*.scala` | PASS — 0 hits |

### 1. Credential scrub — VERIFIED by my own sweep

Row count and arity preserved, PII gone, FK integrity intact:

- `users` rows: **594** (unchanged).
- Real emails (`mattheworr018`, `mo@gmail.com`, `matt@helio.com`, `admin@helio.com`):
  **0**. All 594 addresses are now `user-N@example.invalid`; a filtered sweep for any
  address outside `example.invalid`/`test`/`.local`/`helio.internal` returns nothing.
- bcrypt hashes: **1 distinct value** (`$2a$12$0000…`), 593 occurrences — i.e. zero
  live hashes, matching the 594 rows minus one null-hash (OAuth) user.
- `"database": "helio"` connection JSON: **0** occurrences; the one `data_sources` row
  now reads `scrubbed.invalid` / `scrubbed`.
- **`users.id` values byte-identical to pre-scrub** — I compared the `md5sum` of the
  extracted id list across `7b044b1c` and `dc95ccc4`: identical. `owner_id` FKs and the
  RLS assertions therefore still resolve.
- Broad secret sweep (OpenAI/GitHub/Google/Slack key formats, PEM private keys, JWTs):
  **0 hits**.
- Scrub blast radius is exactly what was claimed: the fixture diff is 595 line-pairs,
  and per-table `md5sum` shows `data_types`, `panels`, `pipelines`, `pipeline_steps`,
  `data_type_rows`, `dashboards`, `metrics`, `binary_refs`, `patch_set_applications`
  all **IDENTICAL**. The scrub could not have weakened the fixture's detection power —
  and the mutation proofs below confirm it empirically rather than by inference.

**Caveat worth recording (non-blocking).** `check:no-credential-leak` is green, but its
green says nothing about this fixture: `scripts/check-no-credential-in-agent-surface.mjs`
is scoped entirely to `frontend/src/features/assistant/**` (hence "12 files scanned")
and checks for credential-carrying *component imports* and a `credential:` property
pattern. It never reads `backend/src/test/resources/`. I ran it as asked and it passes,
but the actual evidence for the scrub is my sweep above, not that gate. The practical
consequence is in Non-blocking Suggestions: nothing mechanically prevents a future
re-dump from re-committing live hashes.

### 2. Markdown-binding fix — VERIFIED complete, no sixth site

All five code sites symmetric (`:179` kind backfill, `:455` section-9 selection,
`:562` `out_kind`, `:822` and `:840` section-13 orphan checks), plus the `:195` CHECK
constraint listing all five legal kinds. `grep -nE "type *(=|IN) *\(?'text'\)?"` filtered
for lines lacking `markdown` returns **nothing** — there is no sixth asymmetric site.

I also checked the one place a naive fix would have broken: the `valid_slots` CASE at
`:476-483` routes `markdown` to `ELSE NULL` ("keep every `fieldMapping` key"), the same
branch as `text` and `table`. A data-bound markdown panel's `fieldMapping` is therefore
carried across intact rather than filtered to `{}`.

Every `out_kind` section 9 can produce against the real fixture is
`chart, collection, markdown, metric, table, timeline` — exactly the `outputs.kind`
CHECK set, so no Output insert can violate it.

### 3. Stale section-4 comment — VERIFIED fixed

`V94:162-165` now reads: "`markdown` follows the identical text/type_id rule (a
data-bound markdown row also collapses to 'output'; a literal one keeps
kind='markdown') -- only `image`/`divider` map straight through unconditionally". That
is an accurate description of the code at `:179`. The contradiction I raised in cycle 2
is gone, and I verified `image`/`divider` genuinely have `type_id IS NULL` throughout
the real data, so the narrowed claim is true rather than merely narrower.

### 4. Mutation proofs — I reproduced both myself

Backed each fix out in turn against the **scrubbed** fixture, ran
`testOnly …V94OutputsMigrationSpec`, then restored:

- **Mutation A — markdown-binding fix backed out** (all five sites reverted to
  `type = 'text'`): **RED**, exit 1, 3 of 23 tests failed — "collapse the real
  markdown-bound panel (type_id set) to 'output'", "give the real markdown-bound panel a
  real 'markdown'-kind Output … fieldMapping preserved", and "delete exactly the panels
  this migration's own broadened predicate identifies as stranded, and log that exact
  count".
- **Mutation B — section-10 predicate reverted to `type_id IS NULL`**: **stronger than
  red — the migration itself aborts.** `ERROR: check constraint
  "panels_output_kind_requires_output_id" of relation "panels" is violated by some row`;
  suite ABORTED, 0 tests run. The defect cannot reach a database at all, let alone ship
  silently.
- **Restored**: `git status --porcelain` empty (tree clean), 23/23 green.

The scrubbed fixture retains full detection power for both defects. This is the check
that mattered most, and it holds.

### 5. Test-code fixes from the executor's own cycle — sound

The orphan-type id selection and the `node_snapshots` equality check both hold up. The
equality assertion is now genuinely row-for-row and, importantly, **derived from the
data rather than hardcoded**: it groups the captured pre-migration `data_type_rows` by
`data_type_id`, filters to types that were still some live pipeline's output type,
resolves each to its owning pipeline and original trunk-last step, and asserts
`actualRows shouldBe expectedRows` on `(row_index, parsed JSON)` **for every such
pipeline**, not a hand-picked one or two. `expectedStrandedCount` is likewise computed
in Scala from the fixture rather than written as a literal — so these assertions cannot
silently drift out of agreement with the data the way a hardcoded count would.

### 6. Third-defect hunt — none found

I applied the same "query the real data, don't trust the predicate" discipline that
found the first two, partitioning every table the migration touches and looking for rows
that fall through every branch:

- **`panels` (190)** — fully partitioned, no residue: 145 bound (57 → Outputs, 88 →
  deleted) + 45 content retained.
- **`data_types` (289)** — fully partitioned: 139 companion + 73 pipeline-output + 77
  with no owning pipeline (skipped **and counted** via `orphan_data_types_no_pipeline_skipped`).
- **`data_type_rows` (7169)** — 3284 migrate; 3885 belong to the 28 types with no
  pipeline and are dropped, consistent with their panels being deleted (no node exists
  to hold them).
- **`binary_refs` / `metrics` / `alert_rules` / `outputs.kind` CHECK** — all clean.
- **Patch-set journal** — I verified the predicate against the *real* JSON shape rather
  than trusting it: all 14 entries do carry a top-level `targetKind`, so the
  `targetKind IN ('dataType','metric')` filter is genuinely correct and the documented
  "0 match" is a real finding, not an accidental no-op on a key that doesn't exist.

Two candidates I chased far enough to rule out, both recorded so nobody has to re-chase
them:

- **Dangling `dashboards.layout` entries.** V94 deletes 88 panels but does not prune
  `layout`, leaving 104 of 252 layout items pointing at deleted panels. Not a new
  failure mode: **4 such dangling items already exist today** on 1 dashboard, and
  `validateDashboardLayoutItems` only requires a non-empty `panelId` — it never checks
  panel existence — so dashboards stay editable. Pre-existing tolerated behaviour,
  amplified in scale. Noted below, not a blocker.
- **Legacy `priorState` in the patch-set journal.** 7 of 14 entries store a
  `priorState.config` in the old bound-panel shape (`dataTypeId`/`aggregation`/
  `fieldMapping`) and survive the migration because their `targetKind` is `panel`. I
  traced the undo path: `PanelResponse` still carries `type: String` + raw
  `config: JsValue`, so deserialization succeeds, and `PanelConfigCodec.decodeCreateConfig`
  returns a typed `Left("Unknown panel type: 'metric'…")` rather than throwing. `/undo`
  on those entries degrades to a clean per-edit "restore failed", not a 500 and not
  corruption. Correct behaviour — the old panel shape genuinely no longer exists.

## Phase 3: UI Review — N/A

Backend-only row; UI gate explicitly N/A per spec decision 17 and ticket.md.

## Overall: PASS

Both data-loss defects found in cycles 1 and 2 are closed and proven closed by
mutation; the fixture is the real dump the design gate demanded; the credential scrub is
clean and provably non-destructive to the fixture's detection power; all gates are green
on my own fresh runs; and a deliberate third-defect hunt across every table the
migration touches turned up nothing of the same class.

## Non-blocking Suggestions

None of these blocks merge. The first three are worth doing in the PR; the rest are
follow-ups.

1. **State the real deletion scale in the PR body, and fix the stale figure in the
   migration comment.** `V94:614` still carries my cycle-1 approximation, "58 real
   panels across ~30 dashboards". With the markdown fix now in place the measured truth
   is **88 panels across 39 dashboards deleted, 57 migrated to Outputs**. The code and
   the test are both correct (the test derives the count from the fixture rather than
   hardcoding it) — only the comment is stale. This is an irreversible, user-visible
   deletion and a human should see the real number before merge.
2. **Add a mechanical guard for the fixture's credentials.** The scrub was manual and
   `check:no-credential-leak` does not cover `backend/src/test/resources/`. A future
   re-dump would silently re-commit 592 live bcrypt hashes with nothing to stop it.
   Cheapest sufficient fix: extend that script (or add a sibling) with a fixture-scoped
   check that fails on any `$2[aby]$` value other than the fixed dummy, and on any email
   outside `example.invalid`.
3. **Finish the cycle-2 stale-reference sweep.** Still stale:
   `api/routes/pipelines/README.md` ("DataType HTTP routes", lists `DataTypeRoutes`),
   `api/protocols/pipelines/README.md` (lists `DataTypeProtocol`), and
   `domain/panels/README.md` (lists `MetricPanel`/`TablePanel`, omits `OutputPanel`) —
   all naming deleted classes. Plus the four comment-level dangling references
   (`RequestValidation.scala:140` is the one that actively misleads, describing the
   helper as being for `MetricService.create`).
4. **Two sections of `V94` are both numbered 15** (`:896` patch-set journal, `:928`
   `alert_rules` NULLable). Cosmetic, but this file is long enough that the numbering is
   load-bearing for navigation.
5. **Consider pruning `dashboards.layout`** of items whose `panelId` no longer exists,
   as a final step in V94 (104 of 252 items will dangle). Genuinely optional — the
   condition already exists today and is tolerated — and there is a real argument for
   *not* adding new DML to a heavily-tested migration in the final cycle. Recording it
   so the decision is deliberate rather than overlooked.
6. **Delivery-time follow-ups for the orchestrator** (executor has no Linear access):
   re-open or re-file **HEL-689** (task 4.6 — absorbed into this ticket but not
   delivered; the deferral is well-justified, but it must not be closed as "absorbed"),
   and post the `openspec-coverage-checklist.md` pointers on **HEL-907 / HEL-908 /
   HEL-909** for the 49 deferred capabilities (task 6.5).
7. **Carry the method forward into P1.2–P1.7.** Three cycles produced two real
   data-loss defects, both found by querying the real database and neither by a green
   test suite. The generalisable habit is the one that closed this out: enumerate the
   real table against the migration's own predicates and diff the two, rather than
   asserting the predicates are exhaustive. The `panels_output_kind_requires_output_id`
   CHECK is the other half — an invariant that makes the failure abort the migration
   instead of corrupting rows — and mutation B showed it is worth more than any number
   of assertions.

## Verification hygiene

The working tree is clean at `dc95ccc4` (`git status --porcelain` empty) — both
mutations were reverted from the original file copy and verified restored, with the
migration spec re-run green afterward. The shared dev database was left untouched:
`flyway_schema_history` head is still V93, so V94 has not been applied there, and every
dev-DB query I ran was read-only.
