## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- [x] All ticket acceptance criteria addressed explicitly:
  - "Single request creates source+pipeline+run+dashboard+panels atomically; panels bind via resolved symbolic reference" — `CombinedProposalService.apply` sequences `pipelineProposalService.apply` → `resolveOutputRefs` → `dashboardProposalService.apply`; verified end-to-end by `CombinedApplyProposalSpec` (happy path + mixed-binding).
  - "Failure in dashboard phase rolls back pipeline+source, verified by test" — `CombinedApplyProposalRollbackSpec` asserts `allCounts()` unchanged after a dashboard-phase failure.
  - "Reuses PipelineProposalService + DashboardProposalService (no duplicated create/rollback logic); RLS + V41 enforced throughout" — confirmed by diff: neither service's existing logic is duplicated; both are called with the caller's `AuthenticatedUser`, and the test fixture runs under real (non-BYPASSRLS) RLS.
  - "Output-ref resolution validated: unresolved/dangling ref is a 400 that creates nothing" — `validateOutputRefPositions` runs before `pipelineProposalService.apply`; `CombinedApplyProposalDanglingRefSpec` covers all 4 dangling scenarios (plain dangling, kind-mismatch, duplicate, shadowed-config), each asserting `allCounts()` unchanged.
  - "MCP tool added; sbt test + MCP tests green" — `apply_combined_proposal` registered; both suites independently re-run green (see Phase 2).
  - "Backward-compat: additive" — `CombinedApplyProposalRegressionSpec` proves both standalone paths unchanged, including the sentinel having no special meaning there.
- [x] No AC silently reinterpreted.
- [x] All `tasks.md` items (1.1–7.10) marked done and match what was actually implemented — spot-checked every task item against the diff (schema, protocol, `PipelineProposalService.rollback`, `CombinedProposalService`'s four methods, route/wiring, MCP types/client/tool/handler, all 5 new test files).
- [x] No scope creep — diff file list matches `files-modified.md` exactly; no unrelated changes.
- [x] No regressions to existing behavior — `DashboardProposalService`, `ProposalPanelSupport`, `PipelineProposalProtocol`, and every existing `PipelineProposalService` method are byte-for-byte untouched (confirmed via `git diff`, not just the executor's claim); full `sbt test` (2512 tests) and full frontend/root Jest suites pass with zero regressions.
- [x] API contracts updated: new `schemas/combined-proposal.schema.json` + `CombinedProposalProtocol.scala`, mixed into `JsonProtocols.scala`; `check:schemas` (schema↔protocol drift check) passes clean.
- [x] Planning artifacts reflect final implementation — design.md D1–D7 all mirrored precisely in the code (see Phase 2 for the D2/D3 deep trace).

Issues: none.

### Phase 2: Code Review — PASS

**Fresh gate re-run (not trusting the executor's own report), in `WORKTREE_PATH`** (`CLEAN_WORKTREE` not set — `slow`-only path did not apply):

- `npm run lint` → clean (exit 0)
- `npm run format:check` → clean (exit 0)
- `npm run check:scala-quality` → clean (0 violations; 86 pre-existing informational file-size warnings, none in new files)
- `npm run check:schemas` → in sync (39 protocols, 32 files)
- `npm run check:openspec` → only flag is "not archived" (expected mid-workflow; archival is a later delivery-phase step, not a Phase-2 gate)
- `npx jest` (root, incl. `helio-mcp/**`) → 6 suites / 130 tests passed
- `npm --prefix frontend test` → 148 suites / 1506 tests passed (frontend untouched by this ticket — confirms no regression)
- `npm --prefix helio-mcp run typecheck` and `run build` → both clean
- `cd backend && sbt test` → **2512 tests, 152 suites, 0 failures** — includes all 4 new `CombinedApplyProposal*Spec` files (11 new test cases: happy path ×2 + auth, dangling-ref ×4, rollback + short-circuit ×2, standalone regression ×2), all passing.

**Independent trace of the D2/D3 "blessed slot" precedence** (not trusting the executor's summary — traced against the real `ProposalPanelSupport.bindingCandidate` implementation):

`ProposalPanelSupport.bindingCandidate(panel) = panel.dataTypeId.orElse(nonFlatConfigDataTypeId(panel))`, and `nonFlatConfigDataTypeId` returns `None` outright when `panel.type` is in `DataPanelKinds`. Because `Option.orElse`'s argument is call-by-name, `nonFlatConfigDataTypeId` is only *evaluated* when `panel.dataTypeId` is `None` — i.e. config is consulted only on true absence, never merely on a non-matching value.

`CombinedProposalService`'s `flatIsBlessed`/`configIsBlessed` mirror this exactly:
- `flatIsBlessed(panel) = panel.dataTypeId.contains(OutputRefSentinel)`
- `configIsBlessed(panel) = !DataPanelKinds.contains(panel.type) && panel.dataTypeId.isEmpty && panel.config...dataTypeId == sentinel`

These are mutually exclusive by construction (`configIsBlessed` requires `dataTypeId.isEmpty`, `flatIsBlessed` requires it non-empty), so `clearBlessedSlot`'s if/else-if exactly reproduces `orElse`'s short-circuit. Verified against all three skeptic-caught bugs, by code trace and by the tests that exercise them:
- **Round 1, finding 1 (kind-mismatch)**: a `chart` panel with `config.dataTypeId = sentinel` never satisfies `configIsBlessed` (chart ∈ `DataPanelKinds`) — `clearBlessedSlot` leaves the panel unchanged, so the re-serialization check still finds the sentinel → rejected. Matches `CombinedApplyProposalDanglingRefSpec`'s "Bad Kind Mismatch" case.
- **Round 1, finding 2 (duplicate)**: `validateOutputRefPositions` clears the *one* blessed slot (if any) then re-serializes the *whole* panel and scans for a lingering sentinel — a duplicate in `fieldMapping` is still found even when a legitimate occurrence was cleared elsewhere. Matches "Bad Duplicate".
- **Round 2 (orElse-absence, not not-equal)**: `configIsBlessed` requires `panel.dataTypeId.isEmpty`, not merely "≠ sentinel" — a `text` panel with a real, different flat `dataTypeId` set never has `config.dataTypeId` cleared, even if it holds the sentinel, so the leftover sentinel is caught. Matches "Bad Shadowed".

`resolveOutputRefs` uses the identical `flatIsBlessed`/`configIsBlessed` precedence, applied only after `validateOutputRefPositions` already guarantees at most one legitimate occurrence — a safe, unconditional substitution, verified via the happy-path and mixed-binding specs (both confirm the created panel's `config.dataTypeId` equals the pipeline's real `outputDataTypeId`, and a co-existing panel bound to a pre-existing type is left untouched).

**`PipelineProposalService.rollback` additivity + composition** (independently verified, not trusted from the executor's claim): `git diff main...HEAD -- backend/.../PipelineProposalService.scala` shows **zero removed lines** in the file body (only the diff header `--- a/...`) — the method is purely appended after the last existing method, confirming no existing method's signature or behavior changed. `rollback` composes exclusively through `pipelineService.delete` → `dataTypeService.delete` → (if `response.source` is defined) `dataTypeRepo.findBySourceId` (read, before any delete in this fresh invocation — safe per design.md D4/D5's own reasoning) → `dataSourceService.delete` → each companion `dataTypeService.delete` — same order and same composed-service discipline as the existing private `rollbackAll`, never a raw repository call for a write. `response.source.isDefined` is confirmed equivalent to `createdByThisCall` by tracing `ResolvedSource.responseForClient` (`None` for the existing-sourceId branch, `Some` for both inline-creation branches) — so `rollback`'s `None`/`Some` branch exactly mirrors `rollbackSourceOnly`'s `createdByThisCall` check.

**Other checklist items:**
- [x] Canonical code-quality (CONTRIBUTING.md): no inline FQNs (mechanically clean per `check:scala-quality`); all new files well under the 250-line soft budget (largest is `CombinedApplyProposalSpecBase.scala` at 196, `CombinedProposalService.scala` at 149).
- [x] DRY: zero duplicated create/rollback/validation logic; sentinel precedence logic factored into two small private helpers reused by all three of `clearBlessedSlot`/`validateOutputRefPositions`/`resolveOutputRefs`.
- [x] Readable: `OutputRefSentinel`, `flatIsBlessed`, `configIsBlessed` names are self-explanatory; no magic values.
- [x] Modular: `CombinedProposalService` holds no persistence logic of its own; the MCP tool/handler split mirrors the established `pipelineProposalHandlers.ts` pattern.
- [x] Type safety: the MCP `as ProposalPanel[]`/`as PipelineProposalSource`/`as CombinedProposal` casts mirror the pre-existing, already-established pattern in `proposal.ts`/`write.ts`/`pipelineProposal.ts` (same zod-shape-to-domain-type gap the codebase already accepts elsewhere) — not a new escape hatch introduced by this ticket.
- [x] Security: route requires auth (verified live: `curl` against the running dev backend returns `401 Unauthorized` with no session); all writes flow through the caller's `AuthenticatedUser` and real RLS.
- [x] Error handling: dangling-ref and dashboard-phase failures both return a named `BadRequest` before or with rollback; no silent failures.
- [x] Tests meaningful: 11 new backend tests + 2 new MCP tests exercise every branch of the precedence logic (not just the happy path) and assert on DB row counts, not just HTTP status.
- [x] No dead code: no TODO/FIXME/XXX in any new file (grepped the diff).
- [x] No over-engineering: no premature abstraction: the sentinel logic is three small functions, not a general-purpose framework.
- [x] Behavior-preserving: `PipelineProposalService`'s existing methods are provably untouched (see rollback additivity trace above); `DashboardProposalService`/`ProposalPanelSupport`/`PipelineProposalProtocol` are not touched at all.

Issues: none.

### Phase 3: UI Review — PASS

Triggered by `ApiRoutes.scala` and `schemas/**` changes (ticket has **zero** frontend files touched — explicitly out of scope per ticket.md and design.md's Non-Goals).

- `scripts/concertino/start-servers.sh` → `READY backend=... READY frontend=...`
- `scripts/concertino/assert-phase.sh servers ...` → `PASS servers`
- Loaded the app (`http://localhost:5819`): 0 console errors, dashboard list/panels render normally, all existing API calls (`/api/auth/me`, `/api/dashboards`, `/api/dashboards/:id/panels`, `/api/types/:id/rows`) return 200 — confirms the `ApiRoutes.scala` change (new route mount) introduced no regression to the existing app.
- Independently smoke-tested the new route against the live dev backend: `POST /api/proposals/apply` with no session cookie → `401 Unauthorized` (route is live, correctly auth-gated, consistent with every other proposal-apply endpoint).
- No new frontend UI exists for this capability (ticket's own explicit scope: "MCP + frontend: expose the combined flow... the in-app path can reuse it once HEL-341 authoring lands — link, don't block"), so the UI-behavior checklist items (loading/empty states, breakpoints, accessible names for a *new* flow) have no surface to exercise for this ticket; the regression-only portion of Phase 3 (existing app unaffected) passed cleanly.

Issues: none.

### Overall: PASS

### Non-blocking Suggestions

- None beyond what's already noted inline above (the MCP `as X` casts are pre-existing codebase convention, not a new issue).
