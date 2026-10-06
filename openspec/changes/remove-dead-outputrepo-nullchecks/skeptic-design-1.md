## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD a5a2fa2ce70de4105e48c9e08ecb52a8c6932cd4 (branch task/remove-dead-outputrepo-nullchecks/HEL-1337,
no code changes yet; only the untracked change dir). Spawn-cwd guard: `READY`.

### What I verified (with evidence)

**Null branches named in the ticket exist at the cited lines** (`grep -rn "outputRepo == null|outputRepo != null|outputRepoUnavailable"` under `backend/src`):
- `OutputControlsValidator.scala:56`, `WorkspaceContextService.scala:132,308`, `WorkspaceSearchService.scala:76`,
  `PatchSetApplyResolvers.scala:637,774`, plus the unnamed same-shape `PatchSetUndoService.scala:91`. Confirmed.
- `outputRepoUnavailable`/`OutputRepoUnavailableMessage` are referenced only by those sites, `PatchSetApplyTypes.scala:109,117,119`,
  `PatchSetUndoTypes.scala:27` (comment) and `PatchSetPreviewOutputContextSpec.scala:276`. D2's "delete once unreferenced" is achievable.

**"No caller passes null dbContext"** — `grep "new ApiRoutes"`: 26 constructions (Main + 25 in 19 spec files). Every
`dbContext =` argument is `ctx` or (AuditMutationInstrumentationSpec) a `var dbContext` assigned `ctx` in `beforeAll`
(line 116) and only read inside `def routesFor/rawRoutesFor/realSessionRoutesFor` and an in-test construction (line 484),
so never null at construction. No positional-null caller. `ApiRoutes.scala:161` has no default. Claim CONFIRMED.
Additionally `ApiRoutes.scala:247,356,540` already construct `OutputRepository`/`OAuthStateRepository`/`PatchSetApplicationRepository`
from `dbContext` unconditionally, so a null `dbContext` is already not a supported state.

**"All PublicDashboardRoutes callers pass a real repo"** — `grep "new PublicDashboardRoutes"`: ApiRoutes:881 (`outputRepoOpt`, which
is `Some(outputRepo)` at :248) + 9 spec constructions in 8 files (PublicDashboardRoutesSpec has two, :97 and :221), all `Some(outputRepo)`.
None relies on the `= None` default. (Plan says "9 callers (ApiRoutes + 8 specs)" — actual is 10 sites; immaterial, same conclusion.)
D4 therefore does not change public-route behaviour: every `None` arm for `outputRepoOpt` in `PublicDashboardRoutes` (:70-81, :90-103,
:142-145, :195-199, :269-270, :306) is unreachable from every construction site. No escalation trigger.

**D1 production safety (`require(outputRepo != null)`)** — every production construction of the four classes:
- `OutputControlsValidator`: ApiRoutes:378 (`outputRepo`, plain non-null val), PanelService:96 (PanelService's own `outputRepo`,
  already `require`d at :91), PublicDashboardRoutes:63 (becomes the required param under D4). Test: ProposalControlsSpec:43 (non-null).
- `WorkspaceContextService`: ApiRoutes:723 only (passes `outputRepo`).
- `WorkspaceSearchService`: ApiRoutes:808 only (passes `outputRepo`).
- `PatchSetApplyContext`: built only via `PatchSetApplyContext.build` from PatchSetApplyService:70 / PatchSetPreviewService:41, whose only
  production constructions (ApiRoutes ~:545-565) pass `outputRepo`. `PatchSetUndoContext` (distinct type, PatchSetUndoTypes.scala:19) is built
  only by PatchSetUndoService:66, constructed in production only at ApiRoutes:570 with `outputRepo = outputRepo`.
- No `.copy(` on either context anywhere (`grep "copy(.*outputRepo"` — zero hits).
Conclusion: no production path can pass null; `require` is behaviour-preserving in production and mirrors HEL-1295's exact pattern
(7 existing `require`s). It is the mechanism that turns "this branch is dead" from a claim into an invariant, and it converts what would
otherwise become a deferred NPE in a null fixture into a construction-time failure. Justified under CONTRIBUTING:276; not scope creep.

**D3/D6 test handling** — specs passing a null outputRepo today:
- `PatchSetPreviewOutputContextSpec:264-279` (1 test) asserts the typed `OutputRepoUnavailableMessage` error on a null repo — impossible state, correct removal.
- `PatchSetUndoServiceSpec` block "undo with a null outputRepo (HEL-1256)" contains exactly 3 `in`s (delete-with-bound-outputs, create,
  "still undo an application that never needs the Output repository") + helper `undoServiceWithoutOutputRepo` (:710). All three
  are conditioned on the null repo — correct removal. Expected removed total = **4**.
- `WorkspaceContextServicePanelCountSpec` (3 tests): `toDashboardEntry` never touches `outputRepo`; nothing depends on the null — fixture update, not removal.
- ClassifySemanticRole/ComputeColumnStats/SanitizeSampleRows specs: pure-function, fixture update.
- `AssistantToolExecutorSpec.newExecutor` default `outputRepo = null`: the tests using the default never reach `find`/`assemble`
  with a data-type path (with null `dataSourceService` they would NPE regardless), so swapping in a mock is a fixture change.
- `PanelServiceOutputBindingSpec:186,193` assert the existing `require` messages — correctly retained.

**D5 count** — `Option(dbContext)` at ApiRoutes :251, :252, :256, :259, :274, :361, :365, :392, :444, :637, :644, :665, :678, :704, :748
(15) + `outputRepoOpt = Some(outputRepo)` :248 = 16. Matches. Public vals `outputHistoryRepoOpt`/`nodePayloadHistoryRepoOpt` (:255,:258)
have no readers outside ApiRoutes (grep). Val-order hazard documented at :437-441 is real and the plan keeps declaration order.

**D7** — `PipelineService.createTransactional` (:312) body is at 6-space indent vs the 4-space method-body level; inner
`resolveSecondarySourceSchemas(...).flatMap` at relative line 51 exists. Plan's `git diff -w` check is a sound whitespace-only proof.

**Contract/scope** — no API/schema/migration change; `skip_specs: true` is appropriate. Every ticket bullet maps to a task
(2.x services, 3.1 PublicDashboardRoutes, 3.2-3.4 ApiRoutes, 4.1 indentation, 5.x test-count AC). No placeholders/TBDs.

### Verdict: CONFIRM

### Non-blocking notes

1. **D3 table is incomplete**: `WorkspaceContextServiceComputeJoinHintsSpec.scala:28` also constructs
   `new WorkspaceContextService(null, null, null, null)` and is not listed. With the D1 `require` it will abort at suite construction.
   The executor must update it too (fixture change, not removal).
2. **D8 must reconcile aborted suites, not just the totals line.** A missed null fixture (note 1) causes a *suite abort*, which drops
   that suite's tests from "Tests: succeeded N" without a per-test failure line; a totals-only diff could misread it as removals.
   Require `*** 0 SUITES ABORTED` (or no abort line) in both runs, and reconcile `after = before - 4 + added` with the 4 removals named
   (1 in PatchSetPreviewOutputContextSpec, 3 in PatchSetUndoServiceSpec) and each added `require` test named.
3. **D5 rename collision**: dropping `Opt` from `outputHistoryRepoOpt`/`nodePayloadHistoryRepoOpt` produces names identical to the
   constructor params `outputHistoryRepo` (:222) / `nodePayloadHistoryRepo` (:224) — compile error. Pick a different name
   (e.g. `resolvedOutputHistoryRepo`) or keep the existing name with a plain type. Loud, so low risk.
4. **D5 forward-reference hazard on `Some(x)`**: when an Opt val becomes plain and a downstream Option param receives `Some(x)`, a forward
   reference that today passes a (crash-on-use) null Option would become a silent `Some(null)`. Keeping declaration order (as planned)
   avoids this; in particular do not "simplify" `aiStepClient` (:444) to reuse `chatAccessService` (declared at :644).
5. **D1 for `PatchSetUndoContext`** is phrased conditionally ("if that context type is distinct"); it is distinct
   (PatchSetUndoTypes.scala:19), so the `require` applies there too.
6. The 5.4 `require`-fires tests are "recommended"; either choice is fine as long as D8 enumerates them.
7. Caller count for PublicDashboardRoutes is 10 sites (ApiRoutes + 9 spec constructions in 8 files), not 9; correct the PR text.
