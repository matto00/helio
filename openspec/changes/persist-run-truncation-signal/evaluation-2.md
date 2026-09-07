# Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `2f7e13b8` on top of `ff79ebe2`. Every gate below was re-run by me in the
worktree; nothing is taken from the executor's report.

## Cycle-1 change requests — verified against the tree

| CR | Claim | Verdict |
| --- | --- | --- |
| CR1 `primaryAvailableRowCount` inference | fixed | **Confirmed fixed** |
| CR2 at-cap boundary test | real fixture added | **Confirmed fixed** |
| CR3 shared badge + token CSS | extracted | **Fixed, but introduced a new [mechanical] violation — CR1 below** |
| CR4 total decode → not-recorded | fixed | **Confirmed fixed** |

- **CR1.** `truncatedReadsToJson` now writes `{"primaryAvailableRowCount": …, "reads": […]}` and
  `parseTruncationRecord` reads the scalar verbatim from `obj.fields.get("primaryAvailableRowCount")`
  — `reads.headOption` appears nowhere in the read path any more (grep confirms). The scalar is
  threaded from `truncationFields`' `availableRowCount` through `onDryRunSuccess`/`onRunSuccess`/
  `onUnblockedRunSuccess`, i.e. the same value the live `RunResultResponse.sourceAvailableRowCount`
  carries. The `RunTruncationRecord` doc comment is now **true of the code**: it no longer claims a
  recovery rule the code did not implement, and instead states the inference is gone. No NULL-vs-`[]`
  ambiguity is reintroduced: `EmptyTruncationJson` decodes to a *present* record with `reads` empty
  and `primaryAvailableRowCount = None`, while a NULL column still short-circuits at
  `r.truncatedReads.flatMap(...)` and never constructs a record.
- **CR2.** `RestAtCapUrl` returns exactly `InProcessPipelineEngine.MaxRunRows` rows, derived from the
  constant rather than a literal `1000`. The test asserts `sourceRowCount == MaxRunRows`,
  `sourceTruncated == false` on the live result, and `reads` empty / `truncated == false` on the
  persisted read. Its red arm is real: a `>=`-instead-of-`>` boundary regression makes the source
  truncated, which fails three of its four assertions. This is genuine boundary evidence, unlike the
  duplicate it replaced.
- **CR4.** `parseTruncationRecord` returns `Option`, the whole decode is inside a `Try`, the call site
  is `.flatMap`, and the failure branch returns `None`. Degrade target is genuinely **not-recorded**,
  never `[]` — verified in code and asserted by the new test, which inserts three malformed payloads
  plus one well-formed run in the same response and checks the well-formed record still decodes
  (so one bad row cannot fail the request).

Non-blocking items from cycle 1 are all addressed: `updateLastRunInternal`'s `truncated` default is
gone and both `SparkJobSubmitter` sites pass explicitly; the `RunHistoryModal` fixture now carries a
non-empty `reads` consistent with `truncated: true`; the two vacuous assertions are gone (with an
honest comment explaining why no independent weaker assertion exists); `check-schema-drift.mjs` has
the warning comment. Per the orchestrator, the regex fix itself is a filed spinoff and is **not**
treated as an outstanding defect here.

## Phase 1: Spec Review — PASS

No change to the cycle-1 conclusion. All five acceptance criteria remain met, the three-state model
still holds across every enumerated terminal write, no forbidden file is touched (re-checked over the
full `main...HEAD` file list), V104 is still the only migration added and no applied migration is
edited.

## Phase 2: Code Review — FAIL

Gates, all run by me:

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 261 suites / 2683 tests, plus 25 / 248 helio-mcp |
| `npm --prefix frontend run build` | PASS |
| `node scripts/check-schema-drift.mjs` | PASS |
| `cd backend && sbt -batch test` | PASS — 3964 tests, 0 failed |

Issues: CR1–CR3 below. All three are small and mechanical; none is a functional defect, and the
cycle-1 defects are genuinely gone.

## Phase 3: UI Review — BLOCKER (unchanged, not caused by this change)

Re-checked, not assumed: `flyway_schema_history`'s highest applied version is still `103`, and
`V103__pending_connectors.sql` does not exist in this branch's migration directory (0 matches). The
backend therefore still fails `FlywayValidateException: Detected applied migration not resolved
locally: 103` before it can bind a port, exactly as in cycle 1. That is HEL-955's concurrent branch
against the shared dev database, **not a defect of this change**. As instructed I did not run
`flyway repair`.

**What this leaves unverified, stated plainly:** no browser-level verification of any of the three
rendered surfaces has been possible in either cycle. Specifically unverified by live measurement:

- that the footer / run-history / list-table badge visually renders as intended against real backend
  data (all frontend evidence is Jest + code review only);
- that the reload path shows the persisted banner end to end against a real truncated run — the Jest
  test proves the component logic with a hand-built store, and I confirmed `fetchPipelineRunHistory`
  is dispatched on mount (`usePipelineDetailPage.ts:430-434`) so the data is actually there, but the
  round trip through a live `GET /api/pipelines/:id/run-history` has not been observed;
- the badge's rendered appearance in light and dark themes (CR1 below is exactly the kind of thing
  a live look would also have surfaced);
- console-error freedom during those flows.

Required: human intervention, or a re-run of Phase 3 once V103 is resolvable from this branch. This
does not, on its own, fail the change.

**Shared-DB hygiene:** my run created nothing again. The backend never applied a migration; `sbt test`
uses embedded Postgres. Confirmed by query — top `flyway_schema_history` rank still 103 (V104 not
applied), `pipeline_runs` still 853 rows, identical to cycle 1. Nothing to delete.

## Overall: FAIL

## Change Requests

1. **`TruncatedRowCountBadge.css:11` uses a numeric `font-weight` literal — a DESIGN.md
   [mechanical] violation, introduced by the CR3 fix.** DESIGN.md §"Weights": "`--weight-regular/
   medium/semibold/bold` (400/500/600/700). **[mechanical]** No numeric `font-weight` literals."
   `--weight-semibold: 600` already exists (`frontend/src/theme/theme.css:34`), and this new file is
   the **only** CSS file under `frontend/src` containing a numeric `font-weight`
   (`grep -rln 'font-weight: *[0-9]' frontend/src --include=*.css` → one hit, this file). Replace with
   `font-weight: var(--weight-semibold);`. Everything else in the file is correctly tokenised
   (`--space-1`, `--app-warning`, `--text-xs`), and the className now matches a real rule in all three
   consumers, so this is the one remaining item on CR3.

2. **The `truncated_reads` column's own doc comment now describes the *old* encoding, and ~12 test
   call sites persist a value the read path rejects.** The shape changed from a bare array to an
   object, but two comments in `PipelineRunRepository.scala` were not updated and are now false:
   - `:114` — "`SparkJobSubmitter`'s two call sites pass `Some("[]")` explicitly". They pass
     `PipelineRunService.EmptyTruncationJson`.
   - `:344-346` — "A present, empty JSON array (`"[]"`) means recorded-and-complete; a present,
     non-empty array means truncated … decoded to `Vector[TruncatedReadResponse]`". This is the
     authoritative doc on the column, and it is now **wrong in the specific way this ticket exists to
     prevent**: under the new read side a bare `"[]"` fails `.asJsObject`, is caught by CR4's `Try`,
     and decodes to **not-recorded**, not to recorded-and-complete. Anyone who follows this comment
     writes a terminal row that silently reads as "no signal recorded".

   That is not hypothetical — the specs already do it. `PipelineRunRepositorySpec` (:102, :111, :124,
   :140, :196, :213, :239, :273, :282, :310), `OutputRoutesSpec` (:671, :1010, :1023) and
   `PipelineRunRoutesSpec` (:369) still pass a literal `"[]"`, so each of those tests now creates a
   **terminal** run row that violates the very invariant task 2.7 asserts. No current assertion reads
   `truncation` off those rows, so the suite stays green — which is precisely why this needs fixing by
   hand rather than being left for a gate to catch. Update both comments to describe the object
   encoding and the not-recorded consequence of a non-object value, and replace the test literals with
   `PipelineRunService.EmptyTruncationJson` (or a test-local constant referencing it).

3. **The new CR1 test's own comment misdescribes its red arm.**
   `PipelineRunServiceSpec.scala` (the "complete-primary run with a truncated secondary" test)
   states: "Before the CR1 fix, `reads.headOption.flatMap(_.availableRowCount)` would read `None`
   here too (an empty `reads` has no head), so this test alone would not have caught the original
   defect." That is not true of the test as written: the secondary *is* truncated, so `reads` is
   non-empty and `reads.head` is `ds-secondary` with `availableRowCount = Some(3303)` — the pre-fix
   code would have returned `Some(3303)`, failing both
   `primaryAvailableRowCount shouldBe livePrimaryAvailable` and the explicit
   `should not be Some(RestBigTotalRows.toLong)` anchor at the end of the same test. The test is
   genuinely red pre-fix and is the strongest evidence in this cycle; the comment understates it to
   "a companion boundary check" and would invite a future reader to delete it as redundant. Correct
   the comment to state what the test actually proves.

## Non-blocking Suggestions

- `parseTruncationRecord` uses `obj.fields("reads").asInstanceOf[JsArray]`. It is safe (the
  `ClassCastException` is inside the `Try`, and a test covers it), but a `case JsArray(elements)`
  match would express the same intent without a cast.
- `PipelineRunService.EmptyTruncationJson` is a hand-written literal that must stay consistent with
  `truncatedReadsToJson(None, Vector.empty)`. Correctness does not depend on it (the read side is
  key-order-insensitive and both forms decode identically), but a one-line test asserting the two are
  equal would keep the constant from drifting into a shape that no longer round-trips.
