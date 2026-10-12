## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `70f9fe4fb10c24d75b7062f990d456843fe1e3d6` (commits 94edcc42b + 70f9fe4fb) against the live-resolved base
`c658f1fa033ef0124e670935eda697966ce53dda` (origin/main). Scope is driver-reduced: item 3 (DataSourceService split) is OUT.

### Phase 1: Spec Review — FAIL

- AC1: PASS on substance. The real-server 413 cases (infer over-limit, data-sources over-limit, pdf over cap, oversized
  metadata part) use `postOverHttpExpectingEarlyClose` (tolerant, the default). Success cases keep `postOverHttp`. The
  forced-ordering test (`gateOnServerClose = true`) is shipped and green. The red is a naive raw-socket client, not
  `Http().singleRequest`. That deviation is disclosed, and the technical content of the disclosure is accurate (see
  the mutation re-run below). **One inaccuracy:** see CR1.
- AC2: PASS. `grep -rn "deleteIfAuto|autoName" backend/src` returns zero hits. `deleteIfUnadoptedImplicit` is the only
  rule, used at SourceService.scala:202, InlineSourceCleanup.scala:105 and :140, and DataSourceService.scala:707. The
  capture is simplified to `Option[ConnectorId]` (D1).
- AC3: PASS. `grep -n getMessage InlineSourceCleanup.scala` returns zero hits. Every `ex` log line goes through
  `ImplicitConnectorCleanup.describeFailure` (class + SQLSTATE), which sits on the companion as the executor notes ask.
  The only other interpolation is `e.err.message` (a ServiceError: our own text, allowed by D2). The cleanup paths still
  `.recover` to `false` / `Failed`, so a cleanup failure never fails the source delete.
- AC4: PASS. There is one `withUserContext` DBIO with an owner-scoped `FOR UPDATE` re-read, then an owner-scoped
  delete, then `credentialRepo.deleteAction` on the credential id taken from the LOCKED row
  (ConnectorRepository.scala:301-316). Fault-injection and both cross-tenant layers are covered.
- AC5: PASS. `undoPatchSet.fulfilled` resets `status` to `idle` only when some edit has `inlineSources[].result ===
  "removed"`. There is no import cycle: patchSetsSlice.ts does not import connectorsSlice.
- AC6: PASS. PatchSetUndoCombinedConnectorWiringSpec covers the plain, adopted, renamed-source and shared cases with
  `DataSourceService` wired WITH `connectorRepo`. The shared case also deletes the last source and asserts removal.
- AC7: PASS. No migration file is in the diff. New specs use `VerifiedEmbeddedPostgres.start`. `[hel1468-guard]` is
  present in all three of my sbt runs. `npm run check:scala-quality` is clean (no inline FQNs).
- Tasks: all marked done and they match the diff. There is no scope creep (item 3 untouched).
- CONSTRAINTS C1-C4: honored in the diff. C1 red-first was re-verified independently (below). For C3, the test
  credentials are the literal `test-secret-value` and nothing logs a credential.
- Spec deltas match the implemented behaviour, with a small overclaim (see Non-blocking).

### Phase 2: Code Review — PASS

Gates, run by me in WORKTREE_PATH (`nice -n 19`, sbt `-batch -Dsbt.server.autostart=false`, no sbt server left running,
MemAvailable about 52 GB):

- **Targeted sbt** (`backend/target/hel1505-eval/green.log`): ConnectorRepositoryDeleteAtomicitySpec,
  ConnectorRepositorySpec, InlineSourceCleanupUnifiedRuleSpec, PatchSetUndoCombinedConnectorWiringSpec,
  CsvUploadLimitsRoutesSpec, SourceCreatePostInsertCleanupSpec, DataSourceDeleteAutoConnectorSpec,
  PatchSetUndoInlineSource{,Wire,Cleanup}Spec, InlineSourceLeakPathsRoutesSpec and
  PipelineProposalImplicitConnectorCleanupSpec.
  - Result: 12 suites, `Tests: succeeded 106, failed 0`; `[hel1468-guard] ScalaTest summary: failed=0 aborted=0
    unreadable=0`; zero "Broken pipe".
- **Mutation re-run** (`mutants.log`): three mutants in one run, then restored, and `git status` is clean afterwards.
  - (a) Removed the in-transaction owner predicate in `ConnectorRepository.delete` (`owned` filter, line 303). Result:
    "refuse another user's delete even when the precheck is bypassed" FAILED, `Right(true) was not equal to
    Right(false)`.
  - (b) `describeFailure` appends `ex.getMessage`. Result: all 5 log-safety cases FAILED.
  - (c) The shipped forced-ordering pdf test switched to `tolerant = false`. Result: FAILED with
    `java.net.SocketException: Broken pipe`. This confirms that the naive-client red under the forced ordering is
    deterministic, as disclosed.
  - Summary line: `[hel1468-guard] ... failed=7`.
- **Red on main for atomicity** (`atom-main.log`): main's `ConnectorRepository.scala` against the new spec. Result: the
  fault-injection case FAILED (`0 was not equal to 1`, connector gone and credential orphaned) and cross-tenant (ii)
  FAILED. This matches the red-evidence.md claim.
- **Frontend**: `npm test` (which ran the full suite from root) passed 562 suites and 6156 tests, including the 3 new
  connectorsSlice cases. `npm run lint` and `npm run typecheck` are clean, `npm run format:check` is clean, and
  `npm --prefix frontend run build` succeeds.

Review checklist:

- **Log safety**: no credential, config or exception message is logged anywhere in InlineSourceCleanup.scala. The
  ConnectorRepository change adds no logging.
- **Owner-only delete / no cross-tenant path**: there are three layers of owner scoping: the precheck `findByIdOwned`,
  the in-transaction `FOR UPDATE` read and the delete filter. `deleteAction` is id-only, but its id comes from the
  owner-filtered locked row, so it has no cross-tenant reach.
- **Single transaction**: `withUserContext` is `.transactionally`, so a credential delete failure rolls the connector
  delete back. This is proven red-then-green.
- DRY, readability, modularity, error handling, dead code and type safety have no blocking findings. Minor items are
  under Non-blocking.

### Phase 3: UI Review — PASS (reduced)

Triggered by `frontend/**`, but the change is reducer-only: one `addCase` in connectorsSlice.ts, and no component,
markup or styling changes. The driver waived the live check, so no browser session or dev server was started. The
behaviour is covered by the reducer tests (removed resets to idle; kept-only and empty leave it unchanged). The full
jest suite and the production build are green. No design-standard [mechanical] rules apply.

### Overall: FAIL

### Change Requests

1. **Disclosure misattributes the item-1 decision to the owner.**
   - **Where:** `openspec/changes/unify-auto-connector-cleanup/red-evidence.md:68` reads `## Item 1 -- resolution
     (owner ruling: raw-socket-naive-client-red)`.
   - **What the record says:** the escalation answer (`.concertino/runs/HEL-1505/answer.json`, event
     `escalation.answered` for `HEL-1505-1791774569424-3462da`) says "raw-socket-naive-client-red (**driver decision,
     technical**; ...)". The driver's brief to this evaluator says the same.
   - **Why it matters:** this section is the PR-body disclosure source, so the misattribution would be published as an
     owner ruling that was never made.
   - **Fix:** change the heading to "driver decision (technical): raw-socket-naive-client-red". Also make sure the PR
     body uses the same wording. Everything else in the disclosure is accurate: singleRequest could not be forced red,
     going 6/6 green under the gate and 0/40 plus 50/50 plain; the naive client is red; the tolerant helper is on the
     flaky path; and there is 50-run stress evidence.

### Non-blocking Suggestions

- `CsvUploadLimitsRoutesSpec.scala`: the `tolerant = false` branch (including `else reader.run()`) is used by no
  shipped test, so the red can only be reproduced by editing a test. Either:
  - add a shipped case asserting the naive client throws `IOException` under `gateOnServerClose = true`, which this
    evaluation shows is deterministic; or
  - drop the parameter and keep the red in red-evidence.md only.
- `specs/connectors/connector-management/spec.md`: the scenario claims "the credential still resolves". The atomicity
  spec asserts row counts only. Either add a `resolve` assertion or drop the clause.
- `connectorsSlice.test.ts`: the `as unknown as PatchSetUndoResponse` cast is unnecessary, because the literal already
  matches `EditUndoOutcome`. Typing the literal directly would let the compiler catch shape drift.
- red-evidence.md cites logs under `backend/target/hel1505-logs/` (untracked). If any of them is load-bearing,
  persist it via `persist-evidence.sh` before Phase-4 cleanup (CON-160).
