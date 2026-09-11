## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All four ticket ACs addressed explicitly:
  - Real concurrent-append regression test (task 5.10) uses `Future.sequence` over two
    independently-started `dataSourceRepo.appendRows` futures against the real embedded-Postgres
    DB (not sequential HTTP calls) — verified in
    `DataSourceRoutesSpec.scala` ("concurrent appends (HEL-1077 regression...)"), asserts distinct
    increasing `seq`. Passed on my own re-run.
  - Stale-precondition PATCH/DELETE rejected with `409`, row unchanged — covered by dedicated
    tests and matches design.md D5/D6.
  - PATCH/DELETE reuse `lockSource`, `DatasetRowValidator`, and the existing ACL-scoped
    `findByIdOwned` lookup verbatim — confirmed in the diff (`DataSourceRepository.patchRow`/
    `deleteRow` call `lockSource`; `DataSourceService.patchRow`/`deleteRow` call
    `dataSourceRepo.findByIdOwned` before dispatching to the repository, same order as
    `appendRows`).
  - Cross-owner edit/delete under real (non-superuser, non-BYPASSRLS) RLS returns `404` — verified
    against the `RlsOwnerTablesSpec` harness, which explicitly runs the app-role connection
    (`helio_app_test`, NOT BYPASSRLS) through `DataSourceService.patchRow`/`deleteRow` directly
    (task 5.8), not through a superuser test pool.
- No AC silently reinterpreted; no scope creep — the diff touches exactly the row-edit/delete
  surface plus the required schema/type additions, matching design.md's stated Goals/Non-Goals.
  Frontend changes are limited to typed service calls with no UI consumer, exactly as design.md's
  Non-Goals and tasks.md 4.1 specify (deferred to HEL-1080, a filed spinoff).
- design.md's nine round-2 corrections (D1 cross-source scoping, D2 full-row-replace semantics,
  D4 precision, D5 404-vs-409 mechanism, D6 precedence, D8 response shape) are all reflected
  exactly in the implementation — verified line-by-line against the diff (see Phase 2 for
  specifics).
- Planning artifacts (design.md, tasks.md, proposal.md, spec.md) match the final implemented
  behavior; tasks.md's 22 checkboxes are all `[x]` and each corresponds to a diff hunk or test I
  independently confirmed exists and passes.
- API contract: new JSON Schemas (`row-patch-request`, `row-response`, `row-response-row`) added
  and `check:schemas` confirms drift-free (87 protocol case classes in sync). OpenSpec markdown
  spec (`dataset-row-write-api/spec.md`) added with matching scenarios.
- No regressions to existing behavior: full backend suite (4160 tests) and full frontend suite
  (3198 + 248 helio-mcp tests) pass; the HEL-1077 concurrent-append guarantee is explicitly
  re-verified post-change (task 5.10), not just assumed.
- `workflow-state.md` `CONSTRAINTS` is empty (`[]`) — nothing to honor beyond the Iron Laws.

### Phase 2: Code Review — PASS

Ran all gates myself, fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` requested this cycle):

- `cd backend && sbt test` → 4160/4160 passed (5m21s). Also ran the two most relevant spec files
  in isolation first (`DataSourceRoutesSpec`, `RlsOwnerTablesSpec`) — 134/134 passed.
- `npm run lint` → clean, zero warnings.
- `npm run format:check` → clean.
- `npm test` → 248 (helio-mcp) + 3198 (frontend) passed.
- `npm --prefix frontend run build` → succeeded.
- `npm run check:schemas` → in sync (87 case classes, 49 protocol files).
- `npm run check:scala-quality` → clean (163 pre-existing soft file-size warnings, none new/hard).
- `npm run check:no-credential-leak` → 0 violations.

Design-decision verification against the diff:

- **D1 (cross-source-write guard):** confirmed both `patchRow`'s conditional `UPDATE` and
  `deleteRow`'s conditional `DELETE` use
  `WHERE id = ? AND data_source_id = ? AND updated_at = ?` (`DataSourceRepository.scala`, the new
  `patchRow`/`deleteRow` methods) — always including `data_source_id`. The cross-source regression
  test (task 5.6) exercises this directly (edit source B's row through source A's URL → `404`,
  source B's row unchanged) and passes.
- **D4 (microsecond truncation / precision):** `DataSourceService.patchRow`/`deleteRow` compute
  `val now = Instant.now().truncatedTo(ChronoUnit.MICROS)` before calling the repository, matching
  every other row writer's convention. The two-hop round-trip test (task 5.9) — append, PATCH
  using the append response's `updatedAt`, PATCH again using the second response's `updatedAt`,
  then DELETE with the (by-then-stale) first PATCH's value correctly getting `409` — passed,
  proving the truncation convention round-trips correctly rather than merely asserting it once.
- **D5/D6 (404/400/409 precedence):** verified the exact order in code: `DataSourceService`
  checks malformed `updatedAt` first (`parseInstant` → `400`, no DB call), then
  `findByIdOwned` (`404`), then kind check (`400`), then delegates to the repository, which checks
  source-existence (`404`), row-existence (`404`), and — PATCH only — `DatasetRowValidator`
  (`400`) strictly before the conditional-mutation precondition check (`409`). The dedicated
  test "reject a schema-invalid edit with 400 even when the precondition is also stale" (task
  5.11) independently confirms this ordering by deliberately making both conditions true and
  checking the response is `400`, not `409`.
- **D2 (full-row-replace, not sparse merge):** `patchRow`'s repository method validates and writes
  `data` verbatim with no merge against `currentRow`; the null-handling tests (5.3) confirm
  optional-no-default → stored `null`, optional-with-default → default value, required-no-default
  → `400`, matching `DatasetRowValidator`'s existing (unmodified) behavior.
- Sealed `RowMutationFailure` trait (`SourceNotFound`/`RowNotFound`/`ValidationFailed`/
  `StalePrecondition`) cleanly distinguishes all outcomes per task 1.3 — no conflation via
  `Either`/`Option` nesting.
- DRY: `recomputeAfterMutation` is shared between `patchRow` and `deleteRow`, reusing
  `PipelineRowJson.staticColumnRuntimeType` exactly as `appendRows`/`replaceRows` already do (D7)
  — no forked schema-inference logic.
- Type safety: no `any`/untyped escape hatches; new Scala types are precise
  (`Vector[JsValue]`, `Instant`), new TS types (`RowResponse`, `RowResponseRow`) are fully typed.
- Security: cross-owner access is RLS-enforced and independently verified under a real
  non-BYPASSRLS role (see Phase 1); no route bypasses `findByIdOwned`.
- Error handling: the DELETE route's handling of Pekko's default `MissingQueryParamRejection`
  (which surprisingly completes `404`, not `400`) is fixed explicitly via
  `parameter("updatedAt".optional)` with a documented root-cause comment — this is a genuine,
  well-diagnosed fix, not a workaround.
- No dead code / no leftover TODOs in the diff.
- No over-engineering: the sealed trait and shared `recomputeAfterMutation` helper are
  proportionate, not premature abstraction.
- Comment/doc density is high but each comment cites a specific design.md decision or tasks.md
  item and adds information (root cause, cross-reference) rather than restating the code —
  consistent with CONTRIBUTING.md's comment standard.
- No inline fully-qualified names introduced (checked via grep against the diff).
- File-size budgets: `DataSourceRepository.scala` (734 lines), `DataSourceService.scala` (1146
  lines), and `DataSourceRoutesSpec.scala` were already over the 250-line soft budget before this
  change; `check:scala-quality` reports these as pre-existing soft warnings only, no new hard
  violations, consistent with the executor's report.

### Phase 3: UI Review — N/A (with justification)

Trigger technically fires (`frontend/**` files changed: `dataSourceService.ts`,
`dataSource.ts`), but the diff adds only typed service functions and TS interfaces with **no UI
consumer** — this is deliberate per design.md's Non-Goals and tasks.md 4.1 ("for HEL-1080 to
consume once it also gets a row-read path"). There is no new screen, component, or interaction
surface to exercise; the mandatory happy-path/error-state/breakpoint checklist has no target.
Confirmed via `git diff --name-only` that zero `frontend/src/**/components` or page-level files
changed. Started the dev servers (`scripts/concertino/start-servers.sh`,
`scripts/concertino/assert-phase.sh servers` → `PASS`) and confirmed the frontend still serves
`200` and the backend `/health` still returns `{"status":"ok"}` — i.e. no regression to app
bootstrapping from this change. Did not run a full Playwright pass since there is no new
interactive surface and the shared MCP browser session was already in use by a concurrent run
(known parallel-Playwright hazard).

### Overall: PASS

No change requests. Non-blocking suggestions only.

### Non-blocking Suggestions

- None of substance. `DataSourceService.scala` and `DataSourceRepository.scala` continue growing
  past the soft file-size budget — not a regression introduced by this ticket, but a candidate for
  a future split-out ticket (e.g. a `DataSourceRowService`/`DataSourceRowRepository`) if the row
  read/write surface keeps expanding with HEL-1080 and beyond.
