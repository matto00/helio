# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `b931b274` on `bug/surface-row-cap-truncation/hel-861`.
All gate runs below are my own fresh runs; the executor's reported results were not relied on.

## Priority concern: behavioural mutation testing (not red-on-revert)

The executor's task-7.7 evidence (56 compile errors after stashing production files) proves only
that the tests *reference* the new API. I replaced it with three behavioural mutations, each
applied to a clean tree, run, then reverted. Observed output:

**(a) `>` → `>=` in `RestApiConnectorDriver.fetch` (`RestApiConnectorDriver.scala:352`)**

```
[info] - should loadRowsWithStats: a REST source with exactly 1000 rows is NOT truncated — no false positives (task 7.2) *** FAILED ***
[info]   true was not equal to false (InProcessPipelineEngineSpec.scala:2426)
[info] Tests: succeeded 212, failed 1
```

RED, and exactly the intended test. Note the exactly-at-cap test lives in
`InProcessPipelineEngineSpec`, not in `PipelineRunServiceSpec` — the run-service "under the cap"
test uses a 1-row source and does **not** discriminate this mutation. The AC is nonetheless
verified, by the engine-spec test. **No-false-positives AC: verified.**

**(b) removing `truncationSink = truncationSink` from the step-preview `executeWithStepCounts`
call (`PipelineRunService.scala:239`)**

```
[info] - should previewStep over a union step reading a truncated secondary source reports sourceTruncated: true *** FAILED ***
[info]   false was not equal to true (PipelineRunServiceSpec.scala:802)
[info] Tests: succeeded 31, failed 1
```

RED. The exact trap the round-2 design gate identified (a defaulted parameter the preview site
silently forgets) is genuinely closed by test 7.6c. **Verified.**

**(c) `composeTruncationNotice` dropping the row counts (clause reduced to
`Source "<name>" truncated because of the <cap>-row run cap.`)**

```
[info] - should a real run over a REST source with more rows than the cap reports truncation, naming both 1000 and 3303 *** FAILED ***
[info]   "Source "ds-rest" truncated because of the 1000-row run cap. Results computed from this run
[info]    — ... not the full source." did not include substring "3303" (PipelineRunServiceSpec.scala:768)
[info] Tests: succeeded 31, failed 1
```

RED at the backend — but read the diagnostic carefully, because it exposes two real weaknesses:

1. Only the `include("3303")` assertion fired. `include("1000")` **stayed green**, because the
   mutated notice still says "1000-row run cap". So the *rows-actually-read* number is not
   independently pinned by any test: a notice that names the cap but never says how many rows were
   read would pass the suite.
2. The MCP test (`runPipelineTruncation.test.ts`) and the UI test (`PipelineDetailPage.test.tsx`)
   **stayed green** under this mutation — I ran the UI suite with the backend composer mutated:
   `Tests: 111 passed`. Both construct the notice string themselves as an input fixture, so no
   backend wording change can ever turn them red. They are legitimate *pass-through fidelity*
   tests (they prove `helioApi` maps the notice through and the page renders its content
   verbatim), but they are **not** content tests of the composer, and should not be counted as
   such. The composer's wording is pinned by exactly one assertion in the whole suite.

Neither is a correctness defect in shipped behaviour — I verified the real wording end to end
against a live server (below) — so both are recorded as non-blocking suggestions, not blockers.

Tree restored afterwards: `git status --porcelain` empty, `HEAD` still `b931b274`, and a re-run of
`PipelineRunServiceSpec`, `InProcessPipelineEngineSpec`, `CreateSourceEnvelopeSpec` is green
(218 succeeded, 0 failed).

## Phase 1: Spec Review — PASS

Every ticket AC checked, several against a live server rather than only against tests:

- **"A run over a source with more rows than the cap reports truncation, including how many rows
  were available"** — verified live. Real run of a REST pipeline over the ticket's own Sleeper URL
  through the dev backend returned:
  `sourceRowCount=1000, sourceTruncated=true, sourceAvailableRowCount=3303,`
  `truncatedReads=[{dataSourceName: "HEL861 Sleeper Big", rowsRead: 1000, availableRowCount: 3303}]`.
- **"A run under the cap reports no truncation"** — verified live (100-row source: run succeeded,
  no notice, no banner) and by the mutation-(a) result above.
- **"Visible through both the MCP surface and the UI, not only in the raw payload / distinguishable
  from a complete one"** — MCP: `RunOutcome` carries `truncated`, `availableRowCount` and the full
  `truncationNotice` sentence, and `write.ts` has no bespoke formatter (`jsonResult` stringifies
  the object verbatim), so the agent reads the sentence itself. UI: banner verified rendering on
  screen (Phase 3). Both surfaces render the *same* server-composed sentence.
- **"The 3,303-row repro shape surfaces truncation with an available-row count of 3303"** —
  verified live against the actual Sleeper endpoint, not a fixture.
- **"The existing 1000-row memory bound is unchanged"** — `InProcessPipelineEngine.MaxRunRows = 1000`,
  the instance `maxRunRows` delegates to it, and a test asserts `MaxRunRows shouldBe 1000`
  (task 7.5). The value is defined exactly once; no literal `1000` anywhere else
  (`CreateSourceEnvelope.rowCapNotice` reads the symbol, verified by reading and by the notice
  interpolating correctly).
- **"Schemas/openspec updated"** — three spec deltas added under the change dir
  (`connector-spi`, `pipeline-run-execution`, `pipeline-run-truncation-reporting`). There is no
  JSON Schema for `RunResultResponse` or `CreateSourceResponse` in `schemas/` (checked:
  `schemas/pipelines/` has `pipeline-run-record`, a different shape), so there is nothing to drift.
- **"Wording is behaviour"** — audited as behaviour in Phase 2 below.

Tasks: all 34 items marked `[x]`; I spot-checked every substantive one against the diff and found
one partial (task 7.3, see Phase 2 finding 1). No scope creep: the diff touches only what
`files-modified.md` lists, and `files-modified.md` exactly matches `git diff --name-status`.
No regression to existing behaviour — `execute` was left unchanged so the 100-row `inferSchema`
and 10-row `previewSql` callers keep their behaviour, and `loadRows` kept its signature so its
~20 call sites are untouched.

## Phase 2: Code Review — PASS

**Gates, all run by me.** Backend in the delivery worktree; frontend/root gates in a throwaway
detached worktree at the same commit (outside `.claude/worktrees/`, since the root suite ignores
that path and the worktree has no root `node_modules`):

| Gate | Result |
| --- | --- |
| `sbt test` | `Tests: succeeded 3698, failed 0` — all tests passed |
| root `npx jest` (helio-mcp) | 11 suites, 213 tests passed |
| `npm --prefix frontend test` | 271 suites, 2947 tests passed |
| `npx eslint . --max-warnings=0` | clean |
| `npm --prefix frontend run typecheck` | clean |
| `npx prettier --check .` | clean |
| `helio-mcp` `tsc --noEmit` | clean |

**The MCP test does run in CI on the merged branch.** I verified this rather than reasoning about
it: in a checkout at this commit placed outside `.claude/worktrees/`, `npx jest --listTests` under
the canonical root `jest.config.cjs` lists
`helio-mcp/src/runPipelineTruncation.test.ts`, and the full root run executes it (PASS). The
executor's bespoke ts-jest invocation was needed *only* because the delivery worktree's absolute
path matches `testPathIgnorePatterns: ["/.claude/worktrees/"]`. Post-merge that pattern no longer
matches. This is not a hand-rolled-config-only test.

**Declaration order (the spray-json null-implicit hazard):** `truncatedReadResponseFormat` is
declared at `PipelineProtocol.scala:176`, above `runResultResponseFormat` at `:180`, with the
hazard stated in a comment. Confirmed not merely by reading: the live run above serialized a
populated `truncatedReads` array over the wire without NPE.

**`CreateSourceEnvelope` reads the symbol, and issues no second fetch.** `rowCapNotice` is a pure
function of the already-computed `schema.observedRowCount` and
`InProcessPipelineEngine.MaxRunRows`; there is no connector call in that path.
`RestApiConnectorDriver.inferSchema` populates `observedRowCount` with `.copy(...)` on the row
vector it already materialized. No new request. Verified live: creating the 3303-row source
returned `rowCapNotice: "This source already holds 3303 rows, more than the 1000-row run cap.
Pipeline runs over this source will be truncated to 1000 rows."`, and a 100-row source returned
no notice.

**Notice wording audited as behaviour** — would a reader acting on each string reach a correct
conclusion?

- Known-total branch: names the cap, the rows read, the true total, and the consequence. An agent
  reading it cannot mistake a filtered result for a complete one. Correct.
- Unknown-total (SQL) branch: `"...read the first 1000 rows returned because of the 1000-row run
  cap, and more rows exist (the total is not known)."` It asserts only what the `maxRows + 1` probe
  actually proves (more rows exist) and names **no** total. It implies no unmeasured number.
  Correct — but see finding 1: it has no test.
- "the first N rows **returned**" is deliberate and right: it avoids implying an ordering an
  un-`ORDER BY`ed SQL result set does not provide.
- Create-time advisory: correctly framed as forward-looking ("runs over this source will be
  truncated"), not as a claim that creation truncated anything — which matches reality, since the
  create path is uncapped.
- No string reports truncation without saying how many rows were read. No string names a number
  that was not measured.

Standards compliance: no inline fully-qualified names in any added Scala line (grepped);
value-class IDs untouched; new formatters live in the per-domain protocol, not the aggregator;
`TruncationSink` mirrors `AssertionSink` including the `synchronized` guard on its `var`; no `any`
in the TS changes; no dead code, TODO/FIXME, or commented-out code; the recorded
`recordUnrunnable` defaults carry a comment explaining *why* `false` is factually correct there.
Design-standard mechanical rules: the banner uses `--app-warning`, `--app-warning-surface`,
`--app-radius-sm`, `--space-2/3`, `--text-sm` — all defined in `theme/theme.css` with light **and**
dark values (`:167/171` and `:213/217`), so token parity holds. No new shared primitive was
invented, matching the design's explicit reasoning.

## Phase 3: UI Review — PASS

Servers started via the canonical script; `assert-phase.sh servers` → `PASS servers`. Exercised
against real data (a REST source over the ticket's own 3,303-row Sleeper endpoint), not fixtures.

- **Happy path:** clicking "Run pipeline" on the truncated pipeline renders the banner with the
  full server-composed sentence, verbatim:
  `⚠ Source "HEL861 Sleeper Big" truncated: this run read the first 1000 rows returned, out of 3303
  available, because of the 1000-row run cap. Results computed from this run — including any
  filter, sort, or aggregate — describe only that partial population, not the full source.`
  It reads correctly to a human: it says what was read, what exists, why, and what not to trust.
- **Absent for a complete run:** ran a 100-row pipeline in the same session — banner absent
  (`document.querySelector('.pipeline-detail-page__truncation-banner')` → null), run succeeded with
  100 rows. No false positive on screen.
- **Accessibility:** `role="alert"`, so the notice is announced; the `⚠` glyph is
  `aria-hidden="true"` so it is not read as content. The banner is non-interactive, so there is no
  keyboard-focus requirement.
- **Tokens/theme:** computed styles resolve to the warning token pair in both themes
  (dark `rgb(245,185,68)` on the 14% warning surface; light `rgb(153,98,30)` on the 11% surface),
  `font-size: 14px` (`--text-sm`), `padding: 12px` (`--space-3`).
- **Breakpoints:** 1440 / 1100 / 768 / 360 all render without breakage — text reflows, no
  horizontal overflow (`documentElement.scrollWidth === innerWidth` at 360), and the banner's
  left edge and width match its sibling regions at every width.
- **Console:** the only error at any point is a pre-existing
  `GET /api/pipelines/:id/schedule → 404` for a pipeline with no schedule — untouched by this diff
  and present independently of the run.

Dev-DB hygiene: every source, connector, pipeline and data type I created for this review was
deleted afterwards (verified 204s and an empty re-listing). The throwaway verification worktree
was removed (`git worktree list` shows no straggler).

## Overall: PASS

## Change Requests

None.

## Non-blocking Suggestions

1. **The unknown-total (SQL) notice branch has no test.** Task 7.3 asks for "a notice that states
   the total is not known and names no total", but the delivered test
   (`InProcessPipelineEngineSpec`, live SQL over `generate_series(1, 1001)`) asserts only the
   driver-level `SourceReadStats` — `truncated = true, availableRowCount = None`. The *notice text*
   for that branch is asserted nowhere. The wording is correct (I read it, and it is the branch
   most at risk of implying an unmeasured number), but nothing would catch a regression in it. A
   two-line unit test on `PipelineRunService.composeTruncationNotice(Vector(TruncatedRead("db",
   1000L, None)), 1000)` asserting the string does *not* contain a total and does say "not known"
   would close it. Task 7.3 should not be considered fully delivered as written.
2. **Pin the rows-read count independently.** Per mutation (c), `include("1000")` in
   `PipelineRunServiceSpec:767` is satisfied by the notice's "1000-row run cap" alone, so it does
   not verify the read count is reported. Asserting the full expected sentence (or
   `include("read the first 1000 rows")`) would make the assertion mean what it appears to mean.
3. **Don't count the MCP/UI tests as composer-content coverage.** Both feed the notice in as a
   fixture, so they stay green under any backend wording change. They are correct as
   pass-through fidelity tests; the comments above them ("content-distinguishable") slightly
   oversell what they discriminate.
4. **`truncationFields` dedupes non-deterministically and by name.**
   `(primaryRead ++ sink.reads).groupBy(_.dataSourceName).values.map(_.head).toVector` returns
   hash-ordered values, so a multi-source notice can list its sources in a different order between
   two identical runs, and the primary source is not guaranteed to come first. Deduping while
   preserving encounter order (e.g. `distinctBy`-style fold) would make the notice stable. Related:
   dedupe is by source *name*, so two distinct sources sharing a name collapse into one entry —
   `TruncatedRead` carries no id, which is a design choice worth revisiting if names ever collide.
5. **The banner is last-run-in-session only.** Reloading the pipeline page after a truncated run
   shows "Rows written: 1,000" with no truncation indication, because truncation lives in Redux run
   state and is not part of persisted run history. This is consistent with design D7 and does not
   break the AC (a human who runs the pipeline sees it), but the persisted run record is exactly
   where the original defect's "plausible-looking number with no signal to distrust it" survives.
   Likely the highest-value follow-up.
6. **File-size budgets.** `PipelineRunService.scala` (802 lines) and `PipelineDetailPage.tsx` (790)
   were already well past the ~400-line "propose a split" line before this change; the additions
   here are small and idiomatic, but both files remain split candidates.
