# Evaluation Report — Cycle 2 (evaluation-2.md)

HEAD reviewed: `971608e5` (one commit on top of cycle 1's `4c86e658`). All gates
re-run fresh by me; every dev-DB number below is my own measurement, not the
executor's.

## Verdict on the orchestrator's explicit question (Critical Path item 2)

**Full `pg_dump --data-only` fixture replacement remains a genuine merge-blocker.
The targeted regression case is not sufficient.**

This is not a process preference — it is now an empirical result. The scoreboard for
finding real, silent, irreversible data-loss defects in V94:

| Method | Defects found |
| --- | --- |
| Hand-built ~800-line fixture + 3365 passing tests | **0** |
| Querying the actual dev DB | **2** (cycle 1's 58 stranded panels; cycle 2's data-bound markdown panels, below) |

design.md decision 3's stated rationale was "a hand-authored fixture could miss a real
shape the migration doesn't yet handle." That has now happened **twice**, on the same
migration, in consecutive cycles, and the second one was still there *after* a cycle
specifically spent hardening this file. Each time, the fixture was extended to cover
exactly the shape that had just been pointed out — which fixes the instance and leaves
the class untouched. That loop does not terminate by adding one more hand-written
`INSERT` per review round; it terminates by loading the real data once.

The counter-argument the executor could make — "the new case *is* real-dev-DB-derived"
— I checked, and it is genuinely true (see Phase 2, item 1). It just does not
generalize: a fixture derived from the one row an evaluator happened to name is still
a fixture shaped by what someone already knew to look for.

## Phase 1: Spec Review — FAIL

Issues:

1. **(BLOCKING) Data-bound `markdown` panels are silently stripped of their binding —
   the same defect class as cycle 1's stranded panels, still open.** See Phase 2 item
   2 for the full evidence. In spec terms: the source-of-truth spec
   (`docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:76`) defines
   the `markdown` Output kind as covering "today's data-bound text **and** markdown
   panels", and states outright that "`TextPanel` carries `dataTypeId`/`fieldMapping`
   **exactly like** `MarkdownPanel`". V94 migrates data-bound `text` panels and does
   not migrate data-bound `markdown` panels. Since the spec "wins over this ticket
   wherever they disagree" (ticket.md), this is a spec violation regardless of how
   ticket.md scope item 10(b)'s shorter phrasing is read.

2. Critical Path item 1 (stranded panels) — **genuinely resolved** for the shape it
   names. Verified in Phase 2.

3. Critical Path item 3 (RLS AC) — **genuinely resolved and complete**. Verified in
   Phase 2; the grantee proof is real, not vacuous.

4. Change requests 4 and 5 (hygiene) — **done**, with a small residue I under-
   enumerated in cycle 1 (Phase 2 item 5). My omission, not a regression.

5. Change request 6 / task 6.5 (HEL-689 re-open, deferred-capability pointers on
   HEL-907/908/909) — correctly parked for the orchestrator at Delivery. **Recorded
   here as a Delivery-time follow-up; not a reason to fail this cycle**, per the
   orchestrator's own instruction.

6. **A user-visible consequence that must reach a human before merge, not a defect.**
   Section 10 now deletes the 58 stranded panels. I measured what those panels are
   today: **35 of the 58 still have rows in `data_type_rows` and therefore still render
   real (frozen, unrefreshable) data**, across **18 distinct dashboards**; `panels` has
   no soft-delete column. I accept deletion as the right call — an Output requires a
   `pipeline_id` FK, so these panels are structurally unrepresentable in the new model
   without inventing synthetic pipelines, and decision 11 forbids shims. But this is a
   materially larger and more visible deletion than ticket.md anticipated ("DemoData
   seeds four"), and the migration comment (`V94:606-608`) reproduces my cycle-1
   approximation "~30 dashboards" verbatim rather than re-measuring — the real figure
   is 18 dashboards, 35 of them live-rendering. Correct the comment and state the real
   numbers in the PR body.

## Phase 2: Code Review — FAIL

Gates, all re-run fresh by me in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set):

| Gate | Result |
| --- | --- |
| `sbt 'set Test/parallelExecution := false' test` | **PASS** — `Total number of tests run: 3365`; `Suites: completed 225, aborted 0`; `Tests: succeeded 3365, failed 0`; `All tests passed`; exit 0. (+5 vs cycle 1's 3360, matching the 5 tests added.) My own run. |
| `check:scala-quality` | PASS — "clean (130 soft warning(s))" |
| `check-schema-drift.mjs` | PASS — 60 checked across 46 protocol files; 7 panel-type surfaces in sync |
| `check-openspec-hygiene.mjs` | PASS — "openspec/ is clean" |
| `openspec validate ... --strict` | PASS — "Change 'outputs-model-migration' is valid" |
| `grep -rnE "com\.helio\..*DataType" backend/src --include=*.scala` | PASS — zero hits |

### 1. Critical Path item 1 — VERIFIED FIXED (for the shape it names)

- Section 10's predicate is now `kind = 'output' AND output_id IS NULL`
  (`V94:630-641`), evaluated after sections 9/9a have had their only chance to populate
  `output_id` and before section 17's `SET NOT NULL` / section 18's column drops. The
  comment's claim that this is a strict superset of the old `type_id IS NULL` predicate
  is correct.
- `ALTER TABLE panels ADD CONSTRAINT panels_output_kind_requires_output_id CHECK (kind
  IS DISTINCT FROM 'output' OR output_id IS NOT NULL)` (`V94:644-646`). `IS DISTINCT
  FROM` is the right choice — it stays correct while `kind` is still nullable between
  sections 10 and 17.
- Section 13's mirror count (`orphan_data_types_no_pipeline_skipped`) is added and
  logged rather than silently skipped.
- **Fixture provenance independently verified against the dev DB.** The comment claims
  `dt-stranded`/`panel-stranded` are literal `pg_dump` output for
  `data_types.id = 'e262207b-8f11-4d91-8cdd-90bf1d57caca'`. I queried that row: `name`
  = "Netflix Data" ✓, `source_id` genuinely NULL ✓, `version` 3 ✓, owning pipelines = 0
  ✓; and its real bound panel titled "Panel One", `type = 'metric'`, `field_mapping =
  {"unit": "rating", "label": "rating", "value": "title"}` ✓ — all verbatim. This is
  **not** another hand-invented shape. (One overstatement: the comment says "every
  other column is verbatim", but `fields` is truncated to 3 of the real row's 7 fields.
  Harmless — nothing on this path reads `fields` — but the comment should say so.)
- The three new tests are real: the count assertion moved 1 → 2 and names both causes;
  `panel-stranded` is asserted deleted specifically; and a constraint-independent
  `SELECT count(*) ... WHERE kind = 'output' AND output_id IS NULL` → 0 sweep.

### 2. (BLOCKING) Data-bound `markdown` panels lose their binding silently

The fix above closes the instance I named. It does not close the class, and the class
still has a live member.

`V94:162-163` asserts, as fact: "markdown/image/divider map straight through (content
panels, **never data-bound**)." **That claim is false on the dev DB.** My measurement:

```
markdown panels with type_id (data-bound)                 | 4
markdown panels with type_id AND non-empty field_mapping  | 3
markdown data-bound whose type resolves to a pipeline     | 2
```

Trace, exactly parallel to cycle 1's finding:

- **Section 4** (`V94:174-179`): `WHEN type = 'text' AND type_id IS NOT NULL THEN
  'output'` … `ELSE type`. A `markdown` row falls to `ELSE` → `kind = 'markdown'`.
- **Section 9** (`V94:449-450`): `WHERE p.type IN ('metric','chart','table',
  'collection','timeline') OR (p.type = 'text' AND p.type_id IS NOT NULL)` — `markdown`
  is not selected. No Output is created.
- **Section 10**: the new predicate is `kind = 'output' AND output_id IS NULL`. These
  rows have `kind = 'markdown'`, so they are not caught.
- **The new CHECK constraint**: scoped to `kind = 'output'`. Not caught.
- **Section 18** then drops `type_id` and `field_mapping`.

Net effect: 4 panels (3 with a real `field_mapping`, 2 of which resolve to a **live**
pipeline and therefore render interpolated data today) silently degrade to literal
markdown panels, losing their binding permanently, with **no row in
`hel904_migration_counts` and no row in `hel904_dropped_field_mapping_slots`** — the
migration reports nothing at all. This is quieter than cycle 1's defect, not louder:
there, at least the panel visibly vanished.

Note this is the *only* remaining `kind`-collapse path that is not either migrated or
counted; `image`/`divider` genuinely are never data-bound (`type_id` is NULL for all of
them). So the class is small and closable — but it must be closed by construction and
proven, not by another single-shape fixture row.

### 3. Critical Path item 3 (RLS) — VERIFIED FIXED, not vacuous

- `node_snapshots` owner-read / other-tenant-denial now asserted on the **same real
  migrated rows** (`{"profit": 10}` / `{"profit": 20}`) that the 2.9(e) group checks
  row-for-row, plus its own drop-`node_snapshots_select` red proof with restore.
- The grantee test genuinely exercises the **sharing** branch of
  `helio_can_access_pipeline`, and is structured to prove it: it asserts the grantee is
  denied on both tables *before* the grant exists, then inserts a real
  `resource_permissions ('pipeline', pipelineId, granteeId, 'viewer')` row through the
  privileged pool, then asserts reads succeed on both. The before/after pairing is what
  makes it non-vacuous — access is attributable to the grant and to nothing else. This
  is exactly what the AC asked for and what was missing in cycle 1.

### 4. The CHECK-constraint test-fixture fallout (item 6) — semantically sound

The 5 suites / 27 tests were fixed by changing raw-SQL panel fixtures from
`kind = 'output'` to `kind = 'text'`. I read all five diffs. In every case the panel's
`kind` is incidental to what the test asserts — `ApiRoutesSpec` (cross-owner PATCH /
DELETE / duplicate → 403), `DashboardPanelAclSpec` (ACL helper), `PaginationSpec` (page
counts), `RlsPrivilegedDmlSpec` (privileged DML), `RlsSharingAwareTablesSpec` (sharing
RLS). None of them asserts on `kind`, `output_id`, or any Output-bound behavior, and
`text` is a valid content kind that legitimately requires no `output_id`. **The tests
still test what they were testing; this is not papering over the constraint.** Worth
knowing going forward: any future test that genuinely needs a `kind = 'output'` panel
must now seed a real `outputs` row first — that is the constraint working as intended.

### 5. Hygiene (change requests 4 & 5) — done, with a residue I missed in cycle 1

Verified done: all three orphan directories
(`infrastructure/persistence/metrics/`, `services/metrics/`, `api/routes/metrics/`) are
gone; `persistence/pipelines/README.md` now lists `OutputRepository` /
`NodeSnapshotRepository`; `services/pipelines/README.md` no longer lists
`DataTypeService`; `OutputPanel.scala`'s false second scaladoc paragraph is deleted.

Three stale READMEs of the identical class that I failed to enumerate in cycle 1 (my
omission — they were in the same grep output and I cited only five):

- `api/routes/pipelines/README.md:3,5` — "and DataType HTTP routes"; still lists
  `DataTypeRoutes` (deleted).
- `api/protocols/pipelines/README.md:3,5` — "the DataType family's request/response
  protocol types"; still lists `DataTypeProtocol` (deleted).
- `domain/panels/README.md:4` — still lists `MetricPanel`, `TablePanel` (deleted);
  does not list `OutputPanel`.

And four comment-level dangling references to deleted classes:
`RequestValidation.scala:140` (describes the helper as being for `MetricService.create`
— actively misleading about its callers), `AlertRuleService.scala:14`,
`DashboardService.scala:58`, `DataSourceService.scala:87,89`. Non-blocking.

## Phase 3: UI Review — N/A

Backend-only row; UI gate explicitly N/A per spec decision 17 and ticket.md.

## Overall: FAIL

## Change Requests

1. **Migrate data-bound `markdown` panels to `markdown` Outputs.** In `V94`:
   section 4 (`:174-179`) — extend the `'output'` arm to `type IN ('text','markdown')
   AND type_id IS NOT NULL`; section 9 (`:449-450`) — extend the selection predicate to
   match; `out_kind` (`:557`) already yields `markdown` for `text` and maps `markdown`
   straight through, so it needs no change. Correct the false claim at `V94:162-163`
   ("markdown/image/divider … never data-bound") to state the measured truth: 4
   data-bound markdown panels exist on the dev DB; `image`/`divider` genuinely have
   `type_id IS NULL` throughout. Any data-bound markdown panel that cannot be resolved
   to a pipeline is then caught by section 10's existing predicate for free.

2. **Close the class, not the instance — add a whole-table exhaustiveness assertion.**
   Immediately before section 17, log to `hel904_migration_counts` (and assert in
   `V94OutputsMigrationSpec`) the count of panels that carried a non-NULL `type_id`
   into the migration and came out with no `output_id`. That number should be exactly
   the section-10 deletion count and nothing more. This is the check that would have
   caught **both** cycle 1's and cycle 2's defects without either of them having to be
   guessed in advance, and it is what makes the third instance of this class impossible
   to ship silently.

3. **Replace the hand-built fixture with a real `pg_dump --data-only` fixture.**
   Restated from cycle 1 and, per the orchestrator's explicit request, ruled on above:
   this remains a merge-blocker. `pg_dump`/`psql` are confirmed available. Dump the
   affected tables (`data_sources`, `data_types`, `data_type_rows`, `pipelines`,
   `pipeline_steps`, `panels`, `dashboards`, `metrics`, `alert_rules`, `alert_events`,
   `binary_refs`, `resource_permissions`) restricted to what the migration touches,
   remap owner/dashboard ids onto the test's own users as the `dt-stranded` fixture
   already does, load it in `beforeAll`, and re-point the existing assertions at it.
   The specific assertions to carry over unchanged are the AC's own list plus the two
   defects found by hand: ≥1 bound panel whose `type_id` resolves to no pipeline, and
   ≥1 data-bound `markdown` panel. Un-tick task 2.11 until this lands.
   If this is judged genuinely out of reach, that is a reversal of a design-gate-
   confirmed decision and belongs in an escalation with an explicit ruling — not in a
   tasks.md note.

4. **Correct the deletion-scale numbers and surface them.** `V94:606-608` currently
   repeats my cycle-1 approximation "~30 dashboards". Measured truth: **58 panels
   across 18 distinct dashboards, of which 35 still have rows in `data_type_rows` and
   render (frozen) data today.** Fix the comment and state these figures explicitly in
   the PR body — this is a user-visible, irreversible deletion and a human should see
   the real number before merge.

5. **(Non-blocking) Finish the stale-reference sweep** — the three READMEs and four
   comment references in Phase 2 item 5. Also note `OutputPanel.scala`'s remaining
   `[[MetricPanelConfig]]` / `[[ChartPanelConfig]]` / `[[TablePanelConfig]]` /
   `[[CollectionPanelConfig]]` / `[[TimelinePanelConfig]]` scaladoc links now point at
   deleted types; the prose is legitimate history, but the `[[...]]` link syntax should
   become plain backticks.

## Critical Path

1 and 2 together are the merge gate, and 2 is the one that matters more: **1 fixes the
defect I found, 2 makes the next one findable.** Do 2 first and watch it come out
non-zero — that is the red proof for 1, exactly as the `dt-stranded` case was for cycle
1's fix. Then 3, which is what stops this loop needing a fourth cycle. 4 is a two-line
comment fix plus a PR sentence. 5 rides along.

For the orchestrator: this is an ordinary implementation fix, **not** a design
reopening. The spec already settles what data-bound markdown panels should become
(line 76); the migration simply does not do it.

## Non-blocking Suggestions

- Two cycles, two defects of the same class, both found by `psql` and neither by 3365
  green tests, is worth carrying into P1.2–P1.7 as a standing habit: for any migration
  in this remodel, enumerate the real table against the migration's predicates and
  diff the two, rather than asserting the predicates are exhaustive.
- Delivery-time follow-ups for the orchestrator (executor has no Linear access; not
  cycle-failing): re-open or re-file **HEL-689** (task 4.6, absorbed but not
  delivered), and post the `openspec-coverage-checklist.md` pointers on **HEL-907 /
  HEL-908 / HEL-909** for the 49 deferred capabilities (task 6.5).
- The section-10 rewrite is a good piece of migration writing — it states what the old
  predicate was, what it missed, the measured scale, why the new predicate is a strict
  superset, and adds a constraint so the gap cannot silently reopen. That is the shape
  the markdown fix should take too.
- Shared dev DB hygiene re-verified: `flyway_schema_history` head is still V93; V94 has
  not been applied to the shared dev database.
