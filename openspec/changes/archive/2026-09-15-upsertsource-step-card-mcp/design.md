## Context

`upsertsource`'s backend contract is fully shipped: `PipelineStep.Registry` (registry-derived
allow-list, `PipelineStep.scala:234`) already accepts it; write-path validation, the ownership
check, and cycle detection (HEL-1099/1101) reject malformed/unauthorized/cyclic configs with named
400s; the engine (HEL-1100) executes append/replace. The frontend currently renders any
unregistered-in-this-build step kind (today: `upsertsource`) via `unsupportedOpType`/
`isUnsupportedOpType` in `stepNarrowing.ts`, dispatched from `StepOpEditor.tsx` — a deliberate,
reusable fallback (design.md Decision 9 of HEL-1100) that this change only stops applying to
`upsertsource` specifically. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- A real, editable step card for `upsertsource`, following the existing op-wiring pattern
  (`union`/`lookup` are the closest precedent: async/repo-touching, own ACL/ownership concern, full
  editor, own entry in `OP_TYPES`).
- MCP tool documentation that lets an agent create/edit an `upsertsource` step with the same
  fidelity a human gets from the UI.

**Non-Goals:**
- Any backend change. If review finds a genuine backend gap, it is a spinoff ticket per
  `feedback_refactor_discipline` — not silently absorbed here.
- A generic "writable dataset" picker component reused elsewhere — this ships the minimal picker
  this card needs; a shared component is only worth extracting if a second caller appears.

## Decisions

1. **Reuse `sourcesSlice`/`fetchSources` + `Select`, not a new data-fetching hook.** `union`/`lookup`
   already fetch the caller's data sources this way via `SecondaryInputPicker`. `upsertsource`'s
   target picker filters that same list with the existing `isStaticSource` guard
   (`dataSource.ts:145`, `s.type === "dataset"` — **not** `kind`, which is not a field on
   `DataSource`). No new Redux slice.
2. **Ownership is checked against the PIPELINE OWNER, not the caller — verified against
   `PipelineService.scala:1830` (`upsertOwnershipCheckF`), which resolves the target under
   `AuthenticatedUser(pipeline.ownerId, ...)`, never the calling grantee's identity.**
   `fetchSources`/`DataSourceRepository.findAll` are owner-only (no shared-with-me sources), so for
   the pipeline OWNER viewing their own pipeline, the existing fetched list is exactly the backend's
   accepted set — no change needed there. For a non-owner EDITOR grantee (`usePipelineDetailPage.ts`
   already computes `isOwner`), the existing-dataset option of the target picker is **disabled**
   with an inline note ("Only the pipeline owner can target an existing dataset — choose 'Create new
   source' instead, or ask the owner to configure this step"), and only "create new source" is
   offered. This is a real, self-approved product decision (not deferred): the alternative — fetching
   the owner's datasets on the grantee's behalf — has no existing backend read path and would be a
   new ACL surface, out of scope here; if a future ticket wants grantees to target the owner's
   existing datasets, that is a spinoff, not silently built into this one.
3. **No pre-selected target — new local `UpsertSourceTarget` UI state distinguishes "no target
   chosen yet" from "new-source" and "existing-source".** Mirrors the backend's own
   incomplete-draft tolerance (`{}` decodes with no error) — the card must not synthesize a fake
   default (HEL-386/620's picker-empty-default defect). A radio choice ("Use existing dataset" /
   "Create new source") gates which sub-field renders; neither sub-field is pre-populated. For a
   non-owner editor grantee (Decision 2), "Use existing dataset" renders disabled rather than
   omitted, so the reason is visible rather than the option silently disappearing.
4. **Mode is always written explicitly, never left absent, even though the backend tolerates an
   absent `mode` as `"append"`.** The seed/default config for a freshly added `upsertsource` step is
   `{ mode: "append" }` (target absent — see Decision 3) — this is not "silently defaulting" in the
   sense the editor spec means (a value the user never sees or chose); it is the toggle's own visible
   initial selection, exactly as every other op's seed config pre-selects a value (e.g. `dedupe`'s
   `keep: "first"`). Loading an existing step whose persisted config has no `mode` (e.g. an
   MCP-created draft that never set one) also displays "append" selected, matching the read-path's
   own `"append"` decode default — never an unselected/blank toggle state. Selecting "append" while
   "append" is already the visible selection is a no-op (no PATCH fired), matching every other
   change handler's existing no-redundant-PATCH behavior.
5. **Reuse `ConfirmInline` for the replace-mode warning**, the same "inline confirm/cancel for
   destructive row actions" component DESIGN.md already documents (line 468) — not a new modal, no
   new visual dialect, and the mode choice itself uses the existing `Select` component (matching
   every other two-plus-way op choice in this editor, e.g. `sort`'s direction, `fillnull`'s
   strategy) rather than the boolean-only `Toggle` knob. Sequence: selecting `replace` in the
   `Select` updates *only local* pending-mode state and reveals `ConfirmInline` inline below it; the
   actual `persist()` PATCH (and the committed `mode` value the config reflects) fires only on
   Confirm. Clicking Cancel discards the pending selection and reverts the `Select` to the last
   committed mode (i.e. still `append`, or still `replace` if the step already was). Loading a step
   whose PERSISTED config is already `mode: "replace"` (e.g. MCP-created) shows `replace` as the
   selected value with **no** confirmation prompt — the confirmation guards the *transition into*
   replace, not the state of already being in it. Switching `replace` → `append` commits immediately
   (append is never destructive); switching back to `replace` afterward re-triggers the confirmation.
6. **Backend rejection surfacing needs new save-error state — the previously-assumed channel doesn't
   exist.** `validationError` (threaded from `getAnalyzeValidationError`) is an analyze-time signal,
   not a save-failure one, and `useStepCardState.persist`'s `.catch` today silently swallows every
   PATCH rejection for every op kind (pre-existing behavior, out of scope to change for other kinds
   in this ticket — noted here explicitly, not silently left ambiguous). This ticket adds one new
   piece of hook state, scoped narrowly: a `saveError: string | null` (or per-step-kind-generic, but
   only ever populated for `upsertsource` by this ticket's `persist` call site) set from the
   rejected promise's backend-supplied message (the same message text `pipeline-upsertsource-config`/
   `pipeline-cycle-detection` specify — read via the existing axios-error-to-message extraction this
   codebase already uses elsewhere, not re-derived), and cleared at the start of the next `persist`
   attempt for that step (success or failure) so a stale error never lingers past a subsequent try.
   `UpsertSourceConfig` renders it as an inline error (matching `ComputeFieldConfig`'s existing
   `validationError` inline-error rendering pattern for visual consistency, even though the state
   source is new) directly below the field that submission concerned (target picker for a
   cycle/not-found rejection). Local editor state is not reverted on rejection — the user's typed
   value stays visible and editable so they can correct it, exactly as design.md originally intended,
   now with an actual channel to carry the message. Task 2.4's test drives a rejected
   `updatePipelineStep` mock through the real `useStepCardState` hook, not a prop stub.
7. **MCP documentation only** — `add_pipeline_step`'s `type`/`config` are already untyped
   (`z.string()`/`z.record()`), so no schema change is needed, only a new prose block in its
   `description` (matching every other op's existing convention there) plus the same for
   `update_pipeline_step` if it separately enumerates shapes, additionally stating the target must be
   owned by the PIPELINE OWNER (not the calling agent's own identity) — an agent operating via a
   shared/editor-granted pipeline will otherwise be surprised by an ownership rejection.

## Risks / Trade-offs

- [Risk] A non-owner editor grantee cannot target ANY existing dataset through this card, even one
  they themselves own, matching the backend's real rule exactly — this may read as a regression from
  the (false) "owned+shared" premise the original design assumed. → Mitigation: this is not a
  regression, since no such capability exists in the backend today; the disabled-with-explanation
  treatment (Decision 2) makes the real constraint visible rather than hiding it behind a picker
  that would silently 404/"not found" on submit.
- [Risk] MCP tool description drift (HEL-1129 precedent — descriptions can silently diverge from
  real backend behavior). → Mitigation: the MCP proof step runs a freshly started (not
  session-attached) helio-mcp process against a real backend, exercising create-new-source,
  create-existing-source, and the cycle-rejected case, before the description text is considered
  correct.

## Backend fix (added mid-execution, driver-ruled — see workflow-state.md PENDING_ESCALATION history)

Execution's MCP end-to-end proof (task 3.3) found that a genuine cycle-forming `upsertsource`
target 500s instead of getting the named-cycle `400` HEL-1101 (Done) specifies. Root cause:
`PipelineService.classifyDbError` (the shared fallback every `.recover { case ex =>
Left(classifyDbError(ex)) }` site delegates to once none of its other explicit `case` arms match)
has no arm for `PipelineCycleGuard.PipelineCycleRejected`. Two call sites (`addRoot`/`create`, at
`PipelineService.scala:374`/`818`) already special-case it locally with their own explicit
`case PipelineCycleGuard.PipelineCycleRejected(msg) => Left(ServiceError.BadRequest(msg))` arm
ahead of their `classifyDbError` fallback — but `addStep`/`updateStep`/`duplicateStep`/
proposal-apply do not, and fall all the way through to `classifyDbError`'s catch-all `case other`,
which logs and returns a generic `ServiceError.InternalError("Internal server error")`.

**Fix (this ticket, not a spinoff):** add the arm to `classifyDbError` ITSELF —
`case PipelineCycleGuard.PipelineCycleRejected(msg) => Left(ServiceError.BadRequest(msg))` — rather
than patching each of the ~9 remaining `.recover` call sites individually (whack-a-mole; a tenth
call site added later would silently reintroduce the same gap). The two existing local arms
(`:374`, `:818`) are harmless left in place (same case, matched before `classifyDbError` is ever
reached) — kept rather than removed, to keep the diff minimal and behavior-preserving. Scala match
semantics mean the centralized arm only ever fires for a site that doesn't already handle the case
itself, so this is purely additive.

**Why this is in-scope for a UI ticket, not a spinoff:** it is one line, no migration, no API
shape change, and it restores behavior an already-Done sibling ticket (HEL-1101) already specifies
and claims end-to-end coverage for — the gap is on a write path (`addStep`/`updateStep`) this
exact ticket wires the UI/MCP to, so shipping HEL-1102 without it would ship a UI/MCP surface that
cannot actually demonstrate its own required cycle-rejection scenario.

**Why HEL-1101/HEL-1100's own tests didn't catch this — investigated, confirmed (b), not a guess:**
`PipelineCycleDetectionServiceSpec.scala`'s `"PipelineService.create / addStep"` /
`"PipelineService.updateStep"` / `"PipelineService.duplicateStep"` describe blocks (labelled
"API-level" in their own section comments, HEL-1100 task 3.9 / evaluation-1.md CR1) DO already
exercise `addStep`/`updateStep`/`duplicateStep` with a config that closes a real cycle — so this is
**not** category (a) (wrong-path coverage; the right paths are covered). Every one of those tests'
assertions is `result shouldBe a[Left[_, _]]` — this is category (b), a wrong-assertion gap:
`Left(ServiceError.InternalError("Internal server error"))` (what `classifyDbError` actually
returned, pre-fix) is a `Left[_, _]` exactly as much as `Left(ServiceError.BadRequest(msg))` is, so
the assertion could not have distinguished a 500 from a 400 — it passed identically either way.
Compounding this: despite the describe blocks' own "(API-level)" label, none of these tests
actually go through the real Pekko HTTP route — they call `service.addStep(...)`/
`service.updateStep(...)`/`service.duplicateStep(...)` directly (service-level), so even a
`result shouldBe a[Left[ServiceError.BadRequest]]` type-pinned assertion there still would not have
proven the ROUTE's status-code mapping (`ServiceResponse.run`'s `ServiceError -> StatusCode`
translation) actually fires correctly — it would only prove the service layer chose the right
`ServiceError` variant. Both defects needed fixing: the new tests below (a) pin the actual
`ServiceError` variant is what backs the assertion, and (b) go through the real HTTP route via
`ScalatestRouteTest`, checking the wire-level `status` and the response body's `message`.

**New tests added (`PipelineCycleRouteStatusSpec.scala`, real HTTP route via `ScalatestRouteTest` —
not service-level):** one regression test per write path that runs `PipelineCycleGuard`, each
asserting the actual HTTP status is `400` and that the response body names the cycle: pipeline
`create` (roots+steps closing a direct self-cycle in one request), `addStep` (transitive cycle via
another pipeline), `updateStep` (direct self-cycle retarget), `duplicateStep` (direct self-cycle,
seeded via the repository test-seam since a live `addStep` for that config would already be
rejected). Pipeline-proposal apply was investigated and found to have **no separate `.recover`
site** — `PipelineProposalService` has zero `classifyDbError`/`.recover` occurrences of its own; it
delegates entirely to `PipelineService.create`/`addStep`, so it inherits the `classifyDbError` fix
transitively and needs no dedicated route-level test for this specific fix.

**MCP proof:** re-ran the cycle-1 live fresh-`helio-mcp`-process proof of the cycle-rejected case
after the fix — the tool response now carries the named-cycle message (backend log confirms
`ServiceError.BadRequest` with the cycle string, surfaced verbatim by `guarded()`) instead of the
prior generic `500 Internal Server Error: Internal server error`.

## Migration Plan

None — no schema change. The `classifyDbError` fix is a pure code change with a straightforward
revert (single-arm removal) if it needed to be rolled back.
