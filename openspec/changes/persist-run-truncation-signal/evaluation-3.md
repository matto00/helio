# Evaluation Report — Cycle 3 (evaluation-3.md)

Commit reviewed: `e237f322` on top of `2f7e13b8`. Final cycle (`workflow-state.md`:
`EXECUTION_CYCLES: 3`). Every gate below was re-run by me; nothing is taken from the executor's
report.

## Cycle-2 change requests — verified against the tree

| Item | Claim | Verdict |
| --- | --- | --- |
| 1 — numeric `font-weight` | replaced with `var(--weight-semibold)` | **Confirmed fixed** |
| 2 — stale bare-array doc/test literals | comments rewritten, ~12 literals replaced, guard added | **Confirmed fixed** (one cosmetic remnant, non-blocking) |
| 3 — mis-stated red-arm comment | corrected | **Confirmed fixed** |

- **Item 1.** `TruncatedRowCountBadge.css:11` now reads `font-weight: var(--weight-semibold);`.
  Independently re-run: `grep -rn "font-weight: *[0-9]" frontend/src --include=*.css` returns **zero
  hits repo-wide**, matching the claim. Every other property in the file was already tokenised.
- **Item 2.** Both comments are now true of the code. `PipelineRunRepository.scala:114` names
  `PipelineRunService.EmptyTruncationJson` (which is what `SparkJobSubmitter` actually passes), and
  the column doc (:344-355) now describes the object encoding, states that a bare `"[]"` is *not*
  that shape, and names the exact consequence (decodes to NOT-RECORDED via CR4's `Try`). I verified
  the claim rather than trusting it: `grep -rn '"\[\]"' backend/src/{main,test}/scala` returns only
  prose occurrences inside comments plus two unrelated hits (`AssistantService.scala:208`,
  `PipelineAnalyzeRoutesSpec.scala:316`'s schema seed). No stale bare-array literal survives as a
  value for this column. The three semantic assertions now compare `_.parseJson` against
  `EmptyTruncationJson.parseJson` rather than a raw string, which is also the right call given JSONB
  does not preserve key order.
- **Item 3.** The comment now states the test is genuinely red pre-fix and names the exact two
  assertions that fail, which matches my own reading of the test.

### The incidental finding, scrutinised as asked

The executor's claim is **substantively correct and does not imply a three-state gap**, with one
overstatement worth recording:

- *Is it true?* Yes for the REST path. `truncatedReadsToJson` receives `truncationFields`'
  `availableRowCount`, which is `primaryStats.availableRowCount` — the REST stub reports it whether
  or not the source was truncated, so a complete REST run persists
  `{"primaryAvailableRowCount":1,"reads":[]}`, not the null-scalar literal. Retargeting the guard at
  a failed run (which persists no row count and no read stats) is therefore the correct call site.
- *Overstatement.* The new comment says `EmptyTruncationJson` is used "ONLY by the paths where no
  source read was attempted or completed at all … NOT by an ordinary successful run". That is
  source-kind dependent, not universal: a successful run over a source kind that reports no
  `availableRowCount` produces a byte-identical string via `truncatedReadsToJson(None,
  Vector.empty)`. Harmless — both decode to the same recorded-and-complete record — but the absolute
  phrasing is stronger than the code supports. Non-blocking suggestion below.
- *Does it imply a gap for complete runs?* **No.** A complete run persists a present object with
  `reads` empty, so it decodes to a present `RunTruncationRecord` with `truncated = false` — the
  recorded-and-complete state, distinct from NULL/not-recorded. This is not inferred: the
  "a complete run persists a recorded-and-empty signal (never NULL)" test drives the real success
  path end to end and asserts `truncation shouldBe defined`, `truncated shouldBe false`,
  `reads shouldBe empty`. The scalar's presence or absence is orthogonal to the three-state
  discriminator, which is the *nullability of the column*, exactly as design.md Decision 2 specifies.
- *Is the guard real?* Partly. It runs against a real call site (a genuine `service.submit` failure),
  reads the actual persisted column by SQL, and round-trips through real JSONB — so it does catch a
  failure path that stops writing the constant. But since both sides of the comparison are the same
  constant, it cannot catch the drift my cycle-2 suggestion actually named (the constant diverging
  from `truncatedReadsToJson`'s object shape). That drift is caught elsewhere — a constant that no
  longer decoded would fail the "failed run persists a recorded signal" service test — so coverage
  exists; the new test is simply weaker than its comment implies. Non-blocking.

### The unprompted `asInstanceOf` → `case JsArray` change

Degrade behaviour is unchanged. The match's fallthrough arm throws an `IllegalArgumentException`
inside the same `Try`, so a non-array `reads` still resolves to `Failure` → `None` → not-recorded,
never `[]`. The CR4 test's second payload (`{"reads":"not-an-array"}`) exercises exactly this arm and
still passes; the exception type changed, the outcome did not.

## Phase 1: Spec Review — PASS

Unchanged from cycles 1 and 2. All five acceptance criteria met; the three-state model holds across
every enumerated terminal write (`insertRunInternal`'s queued row remains the one decided NULL
exception); the notice is recomposed, not stored; V104 is still the only migration added and no
applied migration is edited; no forbidden file is touched (re-checked over the full `main...HEAD`
file list).

## Phase 2: Code Review — PASS

Gates, all run by me in the worktree:

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 261 suites / 2683 tests, plus 25 / 248 helio-mcp |
| `npm --prefix frontend run build` | PASS |
| `node scripts/check-schema-drift.mjs` | PASS |
| `cd backend && sbt -batch test` | PASS — 3965 tests, 0 failed (+1 vs cycle 2: the new guard) |

No outstanding change requests. All three cycle-2 items and all four cycle-1 items are genuinely
resolved in the code, not merely claimed.

## Phase 3: UI Review — BLOCKER (carried forward; not this change's defect)

Re-checked rather than assumed: the highest applied `flyway_schema_history` version is still `103`
and `V103__pending_connectors.sql` does not exist on this branch, so the backend still dies with
`FlywayValidateException: Detected applied migration not resolved locally: 103` before binding a
port. This is HEL-955's concurrent branch against the shared dev database. As instructed I did not
run `flyway repair`, and I am not failing the change for it.

**Carried forward — what remains unverified by live measurement in all three cycles:**

1. No browser-level render of the truncated badge on any of the three surfaces (pipeline detail
   footer, run history modal, pipeline list table). All frontend evidence is Jest + code review.
2. No live reload round trip: the persisted banner path is proven by component test with a
   hand-built store, and I confirmed `fetchPipelineRunHistory` is dispatched on mount
   (`usePipelineDetailPage.ts:430-434`) so the data is genuinely present, but the trip through a real
   `GET /api/pipelines/:id/run-history` has never been observed.
3. No light/dark parity check on the badge (it now uses `--app-warning` and `--weight-semibold`, so
   it inherits the theme's own token values, but that inheritance is unobserved).
4. No console-error check during any flow.
5. No breakpoint check (1440 / 1100 / 768 / 430) on the three surfaces the badge was added to — the
   badge is `white-space: nowrap` inside table cells and a meta bar, which is precisely the kind of
   thing a narrow viewport exercises.

Items 1, 3 and 5 are the ones a reviewer with a working dev server would most plausibly turn up
something on; 2 and 4 are lower risk given the test coverage. Recommend the skeptic or a human run
Phase 3 once V103 is resolvable from this branch, before merge.

**Shared-DB hygiene:** my run created nothing, for the third cycle running. The backend never applied
a migration; `sbt test` uses embedded Postgres. Confirmed by query — top `flyway_schema_history` rank
still 103 (V104 unapplied), `pipeline_runs` still 853 rows, identical to cycles 1 and 2. Nothing to
delete.

## Overall: PASS

Passing with the Phase-3 blocker documented rather than silently absorbed: the code review is clean,
and the one gap is environmental, externally caused, and explicitly out of scope for this verdict.

## Non-blocking Suggestions

- `PipelineRunRepositorySpec`'s two "non-empty" payload fixtures (the
  `[{"dataSourceName":"ds","rowsRead":1000,"availableRowCount":3303}]` literals at :421 and :470)
  are still the **old bare-array** encoding — a shape no write path can now produce. These are
  repository-level round-trip tests where the payload's internal shape is genuinely irrelevant
  (they assert Slick writes and reads the column verbatim), so nothing is wrong; but for the same
  fixture-fidelity reason item 2 gave, consider wrapping them in the object shape so no fixture in
  the tree models a dead encoding.
- The new guard test's comment claims `EmptyTruncationJson` is used "ONLY" by paths where no source
  read completed. Source-kind dependent — a successful run over a source reporting no
  `availableRowCount` produces the identical string. Soften to "not by an ordinary successful REST
  run" or state the dependency.
- The same guard cannot detect the drift it was written for (both sides are the same constant); the
  real protection is the service-level "failed run reads back recorded" test. Worth saying so in its
  comment, so a future reader does not over-trust it.
