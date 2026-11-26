## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: `17128318964b62245c955ba32aaf5423198c8d0d`. This adds one commit over cycle 1's `c0081f0c4`; the base, resolved live, is `5613ea63fdae31dbd1b1fe5d28663eb3d3fb676b`.

### Fresh gate runs (my own)

- **Cycle 1 baseline:** cycle 1 ran the whole backend `testFull` in 10 shards on `c0081f0c4`. All 799 suites ran and 10,589 tests passed, with 0 failures.
- **What cycle 2 touched:**
  - `RestPagedFetch` (the deadline checks and an optional timer seam)
  - a behaviour-identical `noticeFor` helper, used by `CreateSourceEnvelope` and `SourceService`
  - tests
  - two JSON schema bounds, and the same bound in zod
- **What I re-ran on this head:**
  - `testOnly com.helio.domain.connectors.* com.helio.services.sources.* com.helio.api.routes.sources.* com.helio.api.protocols.sources.*` covered 71 suites: 946 tests passed, 0 failed. 3 were canceled; these are opt-in measurement specs.
    - Log timestamps show this was a fresh run, not a cache replay.
    - It included RestPagedFetchDeadlineSpec, RestApiConnectorDriverPaginationSpec, DataSourceRoutesSpec and CreateSourceEnvelopeSpec.
  - The pipeline service specs that depend on these files (`PipelineRunServiceSpec`, `PipelineService*`, `PipelineProposal*`, `PipelineRoot*`) covered 9 suites: 136 tests passed, 0 failed.
  - `jest helio-mcp`: 77 suites and 712 tests passed. This includes the new `startPage` max case.
  - `lint`, `format:check`, `check:schemas`, `check:scala-quality`, `check:openspec`, `check:spec-structure`, `check:no-credential-leak` and `check:helio-mcp-types` all exited 0.
- The worktree is clean apart from the untracked evaluation reports.

### Phase 1: Spec Review — PASS

- **CR1 is resolved.** The scenario now says:
  - `link`, `next_url` and `cursor` take three requests.
  - `page` and `offset` end only on a short or empty page. Two full pages of 3 plus an empty third take three requests; with a page size of 2 they would take four.
  - This matches D3's end rule and the tests at `RestApiConnectorDriverPaginationSpec` l.154-166.
  - The WHEN line still says "three pages of 2 rows each", which the THEN clause then qualifies for page and offset. The wording is clumsy but the scenario is accurate (see suggestions).
- **CR2 is resolved.** `DataSourceRoutesSpec` has a new connectorId infer test.
  - It checks that an unconfigured `has_more` body carries `pagingNotice`.
  - It checks that a configured request's key set is exactly `Set("fields")`.
  - Removing the `config.pagination.isEmpty` guard in `inferFromPage` would turn the second assertion red, so the test can fail.
  - Task 3.6's claim now matches the work.
- files-modified.md now correctly says `inferredSchema.pagingNotice`.
- The CONSTRAINTS C1-C4 still hold. The cycle-2 delta does not touch the no-config path, the issuer or the failure semantics, apart from the stricter deadline.

### Phase 2: Code Review — PASS

- **CR3 is resolved.**
  - `overdue = hit.get || deadline.isOverdue()` now gates three points: loop entry, a `Left` result and a `Right` result. So no page starts after the deadline, a late final page is never a success, and a body discarded after the deadline reports the curated budget text.
  - The timer is now injectable through `startTimer`, which defaults to Pekko's scheduler. `RestPagedFetchDeadlineSpec` uses a timer that never fires, so only the loop's own clock can produce the error. Its three tests cover each of those three behaviours.
  - `mutation-deadline-red.txt` carries a literal `diff -u` of the mutant, `overdue = hit.get`. All three tests are red, each on its specific assertion.
  - The budget text now says "after N completed pages", with N counted from fully processed pages.
- **The reconstructed mutation diffs (a)-(e) and the MCP diffs are acceptable as context, but not as primary evidence.**
  - Each one is honestly labelled as reconstructed after the fact, with the mutant source not kept. They are not presented as `git diff`.
  - The load-bearing evidence is still the red assertion text in each transcript, and it is self-authenticating:
    - (d)'s red is the origin-check text where the guard's refusal was expected. The guard runs first in `issuePage`, so that text can only appear if the guard admitted `blocked.test`.
    - (a)'s reds are the missing rows from page 2 onward.
  - The reconstructed (d) mutation (a marker header on followed requests, which `issuePage` uses to skip `guardedPoolSettings`) fits that output.
  - I am not relying on the reconstructions for any claim. Future mutation evidence should capture the literal diff at run time, as the deadline mutation now does.
- **Cheap items:**
  - `RestPagination.noticeFor` removes the duplicated notice logic.
  - The `startPage` maximum of 1,000,000 is now the same in the backend, both JSON schemas and zod, with a zod test. I confirmed it live: `startPage: 1000001` gives 400 "pagination.startPage must be an integer from 0 to 1000000", and `1000000` passes validation (the request then reaches the guard, which returns 502 for a blocked host).
- **Mechanical rules:** `check:scala-quality` passes, there are no inline FQNs, and the new test imports are at the top of the file.
- **Soft budget (unchanged from cycle 1):** `RestApiConnectorDriver.scala` is over CONTRIBUTING's ~400-line guide. The Delivery PR body must propose a split.

### Phase 3: UI Review — PASS (smoke only; no UI surface changed)

- Triggered only because `schemas/**` changed (the `startPage` maximum). No `frontend/**` files changed.
- I started the servers with the canonical script and the lane DB: `READY`, then `PASS servers`.
- The frontend answered 200, and the live API smoke above passed.
- I stopped the servers with `stop-servers.sh` (`STOPPED ports=6445,9352`).

### Overall: PASS

### Non-blocking Suggestions

- spec.md l.48: reword the WHEN line, for example "a three-page fixture (2 rows per page for link/next_url/cursor; page size or limit 3 for page/offset)", so the WHEN and THEN lines agree without a parenthetical.
- Capture literal mutation diffs at run time (`diff -u` against a backup, as the deadline mutation did) instead of reconstructing them afterwards.
- Delivery PR body: include CONTRIBUTING's split proposal for `RestApiConnectorDriver.scala`.
