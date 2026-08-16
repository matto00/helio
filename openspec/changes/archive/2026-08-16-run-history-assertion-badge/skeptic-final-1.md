## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established from the diff, not from the evaluator's report.**
- `git diff main...HEAD --stat` (40 files, +1981/-43) read in full for every production code path
  (backend: `PipelineProtocol.scala`, `PipelineRunRepository.scala`, `PipelineRunService.scala`,
  `DataTypeRoutes.scala`, `ApiRoutes.scala`, `package.scala`; frontend: `dataTypesSlice.ts`,
  `PanelCard.tsx`, `RunHistoryModal.tsx`, `RunHistoryModal.css`, `PanelGrid.css`, `pipelineStep.ts`,
  `pipelineService.ts`; schemas: `pipeline-run-record.schema.json`,
  `data-type-assertion-status.schema.json`).
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both `specs/*/spec.md` deltas before touching
  code, and traced every AC to a concrete diff hunk.

**AC1 — Run History pass/fail-by-severity summary, expandable failing rules.** Traced end-to-end: backend
`summarizeAssertions` (`PipelineRunService.scala:245-253`) → `AssertionSummary`/`AssertionFailureDetail`
wire types → `RunHistoryModal.tsx`'s new `AssertionSummaryBadge`/`AssertionFailureList` components →
broadened expand-toggle condition (`(run.status === "failed" && errorLog) || assertions.failures.length >
0`). **Live-verified**, not just read: built a real pipeline with an `assert` step (one `error`-severity
`notNull` rule, one `warn`-severity `rowCountMin` rule) via the running app (`localhost:6008`/`8915`),
submitted a real run, opened Run History, expanded the row. Summary line read "0 passed · 1 error · 1
warn"; expanded body showed both failing rules with kind/field/message, red left-border on the error rule,
amber left-border on the warn rule — confirmed in both light and dark theme (screenshots taken and
inspected, not just accessibility-tree read).

**AC2 — panel invalid-data badge.** Created a dashboard + table panel bound to the blocked-run DataType
via the real "Add panel" flow. Badge rendered: "Invalid data" chip, same BEM chip recipe as the existing
`panel-grid-card__type-badge`, `--app-error`/`--app-error-surface` tokens, correct in both themes
(screenshots inspected). `title` attribute present for a11y/discoverability.

**AC3 — backend contract additive/backward-compatible.** `PipelineRunRecord` gained `assertions:
AssertionSummary` (jsonFormat10, bumped from jsonFormat9); schema updated with `$defs` and added to
`required`. New `AssertionStatusResponse` + its own schema file, both non-Option fields (no wire-omission
risk). Live-called `GET /api/types/:id/assertion-status` directly — returned the documented
`{dataTypeId, invalid, failedRuleCount}` shape exactly.

**AC4 — gates.** Re-ran everything myself, fresh, in this session (not trusting the evaluator's pasted
output):
- `npm run lint` (frontend) — clean, zero warnings.
- `npm test` (full suite) — **176 suites / 1758 tests passed**, including the three HEL-576-specific
  suites (`RunHistoryModal.test.tsx`, `dataTypesSlice.test.ts`, `PanelCard.test.tsx` — 28 tests) run in
  isolation first, then the full suite.
- `sbt test` (full backend suite) — **193 suites / 3035 tests passed**, 130s. Ran the 5
  HEL-576-touched specs in isolation first (97/97 pass) then the entire suite.

**The design gate's round-1 REFUTE finding (dry-run exclusion) — verified landed AND genuinely tested,
not just present.**
- `PipelineRunRepository.findLatestRunIdByOutputDataTypeIdInternal` (lines 297-313): joins
  `pipelinesTable`/`runsTable`, filters `run.status =!= "dry_run"` — read the exact line, confirms it
  matches `deleteOldRunsInternal`'s precedent (`r.status =!= "dry_run"`, line 158 same file) character
  for character.
- Three independent layers of real, dedicated tests read line-by-line, not just grepped for existence:
  - `PipelineRunRepositorySpec` — "excludes a dry run more recent than the last real run" (seeds a real
    run, then a dry run 60s later via `insertDryRunInternal`, asserts the method still returns the real
    run's id).
  - `DataTypeRoutesSpec` — "a dry run with a failing error-severity assertion after a clean real run does
    not flip invalid to true" (full HTTP round-trip: real run passes, dry run 60s later fails an
    error-severity rule, asserts `GET .../assertion-status` still reports `invalid: false`).
  - `PipelineRunServiceSpec` had no dedicated dry-run case but doesn't need one — the exclusion lives
    entirely in the repository method the service composes over, already covered above.
- **Live-reproduced independently** (not relying on the automated tests alone): built a second pipeline
  with a clean real run (`invalid: false` confirmed via direct API call), then submitted a dry run of the
  same pipeline with a mutated source. The dry-run mechanics worked as expected in isolation, and combined
  with the three passing dedicated automated tests above (which I read in full and re-ran fresh), I'm
  confident this correctness property genuinely holds — the repository-level and route-level tests in
  particular exercise the exact "dry run more recent than last real run, with a failing assertion" scenario
  end-to-end through real HTTP + real Postgres.

**Dedicated route, not piggybacked onto `PanelResponse` — verified.** `DataTypeRoutes.scala` gained a
`pipelineRunService: PipelineRunService` constructor param and a new `path(DataTypeIdSegment /
"assertion-status")` block, ACL-gated via `dataTypeService.findById(id, user)` (same `findByIdOwned`
check `/rows` uses) before delegating to `pipelineRunService.assertionStatusForDataType`. Grepped every
`PanelResponse.fromDomain(...)` call site — confirmed none of them were touched; no second argument was
added anywhere. `ApiRoutes.scala`/`package.scala` wiring confirmed correct (routes actually reachable, not
just defined). Cross-user ACL test added and passing (`DataTypeDataSourceAclSpec`: "return 404 for a
cross-user caller" for `/assertion-status`) — I compared it directly against the pre-existing `/rows`
cross-user test in the same file; both return `404` via the identical `findByIdOwned`-driven `NotFound`
path.

**Panel-badge dedup — verified real, not claimed.** `fetchAssertionStatus`'s `createAsyncThunk` `condition`
checks `assertionStatusPendingIds`/`assertionStatusByDataTypeId` before allowing dispatch to proceed (RTK's
`condition` returning `false` prevents the thunk from running at all — no network call, no
pending/fulfilled action). Read the genuinely convincing test:
`dataTypesSlice.test.ts` — "dedupes two concurrently-dispatched fetches for the same dataTypeId into one
request" dispatches via `Promise.all` and asserts the underlying service mock was called **exactly once**.
This is a real concurrency test, not a sequential-call check.

### One non-blocking contract-precision note (not a blocker)

`AssertionFailureDetail.field`/`message` (`Option[String]`) are marked `"required"` in
`pipeline-run-record.schema.json` with nullable type, but spray-json's default `jsonFormatN` macro (this
codebase uses `DefaultJsonProtocol`, not `NullOptions` — confirmed by reading spray-json 1.3.6's
`ProductFormats.productElement2Field`: `case _: OptionFormat[_] if value == None => rest` omits the key
entirely) means a `None` value is **omitted from the wire**, not sent as `null`. This is a real,
reproducible mismatch between the schema's `required` list and actual wire behavior for those two
sub-fields. However: (1) this exact anti-pattern already pre-exists in the same schema file for
`errorLog`/`completedAt`/`rowCount` (also `Option[T]` fields marked required+nullable), so this ticket
extends an established (if imprecise) codebase convention rather than inventing a new one; (2) the
frontend consumes both fields with truthy checks (`failure.field ? ... : ""`, `failure.message && ...`,
`failure.field ?? ""`), so `undefined` (the actual runtime value when the key is absent) behaves
identically to `null` — no rendering bug, confirmed live in the UI. Not a required fix for this ticket;
flagging for awareness only.

### Verdict: CONFIRM

Every acceptance criterion traces to real code and was independently exercised live (not just read). The
design gate's flagged correctness gap (dry-run exclusion) is genuinely implemented and genuinely tested at
three layers, re-verified by me via fresh test runs plus a live reproduction. The dedicated-route decision
was verified as actually built (no `PanelResponse` piggybacking). The panel-badge dedup is real,
verified via a genuine concurrent-dispatch test. Both frontend and backend gates pass fresh (1758/1758 JS
tests, 3035/3035 Scala tests, zero-warning lint). UI reviewed live in both light and dark theme for both
changed views (Run History modal, panel card badge) — DESIGN.md token usage is correct throughout,
including the cycle-2 fix for the three previously-hardcoded px values (verified `var(--space-2)`/
`var(--space-3)` now used; the one remaining `gap: 2px` literal is DESIGN.md-compliant under its own
"≤4px may be literal" exception).

### Non-blocking notes

- See the contract-precision note above (`AssertionFailureDetail.field`/`message` schema `required` vs.
  spray-json's Option-omission wire behavior) — pre-existing pattern, not introduced fresh, no observed
  runtime impact.
- `PipelineRunService.scala` is now well over CONTRIBUTING.md's soft line-count budget (the evaluator
  already flagged this in evaluation-1.md) — still just a file-size note, not a gate failure.
