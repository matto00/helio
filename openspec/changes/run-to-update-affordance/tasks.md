## Standing Constraints

- [C1] Sonnet on every role (orchestrator/executor/evaluator/skeptic/auditor) — no promotion regardless of budget or escalation outcome.
- [C2] ONE LANE: no concurrent delivery lane against this repo for the duration of this run.
- [C3] Migration ledger: V110 is highest as of Setup; V111 is next free if a migration is needed (none expected — verify fresh before claiming it).
- [C4] a11y: assert COMPUTED ARIA (never mere DOM presence) for the denial reason and the "Run to update" action, compared against the RUNNING app in both themes (DESIGN.md binding).
- [C5] Show the red: the deny-copy coverage test must be proven to fail when one rule's copy mapping is removed, before being trusted as a real gate.
- [C6] A denial toast carrying a "Run to update" action must never auto-dismiss (`duration: 0`) — an auto-dismissing actionable toast is a WCAG 2.2.1 timing violation.
- [C7] Rapid repeated writes with an identical denial must coalesce to one toast (deterministic message text, no timestamps/ids — relies on existing `toastsSlice` dedup).
- [C8] Every `git commit` inside the worktree: Bash `timeout: 600000`; never re-run a commit while one is in flight; never `git add -A`.
- [C9] Budget exhaustion on any gate (evaluator cycles, skeptic rounds, debug attempts) is a mandatory escalation, never a self-approval.
- [C10] Do not change epic HEL-1091's own state.
- [C11] Follow-ups filed from this ticket: `origin_kind: followup`, `origin_ticket: HEL-1096`, `relatedTo: ["HEL-1096"]`, `Follow-up` label, project `28f119e2-5738-46b1-a53b-42f73e06b053`.
- [C12] Measure submit-latency before/after awaiting `triggerAutoRun` and report both numbers in the PR description (owner instruction, design.md D2).

### Backend

- [x] 1.1 `AutoRunTriggerService`: add an `EvaluatedPipeline` result type (allowed | denied(pipelineId, name, reasons, canRun)); change `triggerAutoRun`'s return from `Future[Unit]` to `Future[Vector[EvaluatedPipeline]]`, keeping the existing debounce-upsert call for allowed pipelines unchanged.
- [x] 1.2 Compute, per denied pipeline, BOTH `visible` (owner or any grant — viewer or editor — via `pipelineRepo.findGrantRole`) and `canRun` (owner or editor grant, mirroring `PipelineRunService.submit`'s own check) for the WRITING user; a pipeline the writer has no grant on at all is dropped before it ever reaches the response (design.md D1 — skeptic-design-1.md CR1).
- [x] 1.3 `DataSourceService`'s shared private `triggerAutoRun` helper (currently `Unit`-returning, called from `appendFormRow`, `appendRows`, `replaceRows`, AND `patchRow`): change to return `Future[Vector[EvaluatedPipeline]]`, and AWAIT it (no longer fire-and-forget/`.recover`-discarded) at all FOUR call sites, folding visible-and-denied entries into each method's response (design.md D1 — skeptic-design-1.md CR2 extends to `replaceRows`, skeptic-design-2.md CR1 extends to `patchRow`). `deleteRow` (line 901) is explicitly left calling the OLD fire-and-forget form, unchanged — owner ruling, see design.md Non-Goals.
- [x] 1.4 Extend `RowWriteResult`/`RowWriteResponse` (+ `PanelProtocol`/`DataSourceProtocol`) with a `deniedPipelines: Vector[DeniedPipelineResponse]` field, used by `appendRows`/`appendFormRow`/`replaceRows`; add the identical field to `RowResponse` (`patchRow`'s wire type — a real `200` + JSON body, non-breaking) for `patchRow`.
- [x] 1.5 Update `schemas/sources/row-write-response.schema.json` AND `schemas/sources/row-response.schema.json` for the new field and run the schema-drift check.
- [x] 1.6 Add `canRun: Boolean` to `CostVerdictResponse` (`PipelineAnalyzeProtocol.scala`); compute in `PipelineService.analyze` via the same owner-or-editor check as 1.2.

### Frontend

- [x] 2.1 Add a shared deny-reason copy module (e.g. `frontend/src/features/pipelines/services/denyReasonCopy.ts`) mapping all ten `CostReason.code` values to a specific-rule sentence, including honest copy for `unclassified-op`/`unclassified-source`/`row-estimate-unavailable`/`no-roots`.
- [x] 2.2 Update `pipelineStep.ts`/`dataSource.ts` frontend types for `costVerdict.canRun` and the new `deniedPipelines` response field.
- [x] 2.3 Wire `panelService.ts`'s form-submit path to push exactly one toast per write from `response.deniedPipelines` (design.md D3/D4): `variant: "warning"`, deterministic message via 2.1, `duration: 0` + a "Run to update" action only when exactly one pipeline was denied and `canRun`.
- [x] 2.4 Implement the toast/pipeline-page shared "Run to update" click handler: call `POST /api/pipelines/:id/run`, branch HTTP 429 (distinct guard-rejection message, reading `Retry-After`) from any other failure (design.md D7) — never route 429 through the deny-copy mapping.
- [x] 2.5 `usePipelineDetailPage.ts`/`PipelineDetailFooter.tsx`: render a denial block (when `costVerdict.autoRunnable` is false) using the same copy module as 2.1, with a "Run to update" button gated on `costVerdict.canRun`, reusing 2.4's click handler.
- [x] 2.6 Style the denial block and toast per DESIGN.md tokens; verify visually against the running app in both light and dark themes.

### Tests

- [x] 3.1 Backend: a coverage test asserting every `PipelineCostEstimator` reason code has a corresponding entry surfaced end-to-end into `RowWriteResponse`.
- [x] 3.2 Backend: `DataSourceServiceSpec`/`AutoRunTriggerServiceSpec` — a denied pipeline appears in the write response (name + reasons) with correct `canRun` for an owner writer and an editor-grantee writer; appears with `canRun: false` but reasons still present for a viewer-grantee writer; and is OMITTED entirely from the response for a writer with no grant at all (skeptic-design-1.md CR1) — repeated for `appendRows`, `appendFormRow`, `replaceRows` (CR2), AND `patchRow` (skeptic-design-2.md CR1). Add one test asserting `deleteRow`'s response stays `204`/no-body and the denial is only logged (confirms the exclusion, not just an absence of a test).
- [x] 3.3 Backend: `PipelineServiceSpec` — `costVerdict.canRun` is true for the owner/an editor grantee and false for a viewer grantee.
- [x] 3.4 Backend: measure and record submit-latency before/after for `appendFormRow`, `replaceRows`, AND `patchRow` (C12, design.md D2); state the numbers plainly in the PR body.
- [x] 3.5 Frontend: deny-copy coverage test, shown RED first by deleting one code's mapping entry and confirming the specific-rule test fails (C5), then restored GREEN.
- [x] 3.6 Frontend: toast-integration test — single denial + `canRun` shows an action; N>1 denials show no action; rapid repeated identical denials coalesce to one toast (C7).
- [x] 3.7 Frontend: toast a11y test — an action-carrying denial toast never auto-dismisses, is keyboard-reachable/operable, and is announced via computed ARIA (C4/C6).
- [x] 3.8 Frontend: `PipelineDetailFooter` denial-block test — reason rendered, "Run to update" gated on `canRun`, computed-ARIA assertion in both themes (C4).
- [x] 3.9 e2e/Playwright: real chain — a denied form submit shows the toast with the specific rule and action; clicking it submits a run; a guard (429) rejection shows the distinct message; a successful run refreshes the bound panel via the existing SSE fan-out, unmodified.
- [ ] 3.10 Run `openspec validate run-to-update-affordance --type change`, the schema-drift check, and confirm `ci-complete` is PRESENT and SUCCESS before Delivery.
