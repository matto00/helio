## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-schedule-config-ui/spec.md` in full.
- Confirmed the HEL-414 backend contract the design relies on actually matches what's claimed, by
  reading it directly rather than trusting the design doc's paraphrase:
  - `backend/src/main/scala/com/helio/api/routes/PipelineScheduleRoutes.scala` — `GET/PUT/DELETE
    /api/pipelines/:id/schedule`, `PUT` is upsert. Matches.
  - `backend/src/main/scala/com/helio/services/PipelineScheduleService.scala` — `find` returns
    `ServiceError.NotFound("Pipeline schedule not found")` when no schedule exists (→ HTTP 404 via
    `ServiceResponse.completeError`), confirming design D5's "GET 404 = no schedule" assumption is
    correct, not hallucinated. `validate` hand-rolls cron/interval/timezone checks and returns
    `ServiceError.BadRequest(message)` (→ HTTP 400), confirming D4's error-shape assumption.
  - `backend/src/main/scala/com/helio/api/protocols/ResourceProtocol.scala` /
    `ServiceResponse.scala` — 400 body is `ErrorResponse(message)`, i.e. `{ "message": "..." }`.
    Matches design.md's stated contract exactly.
  - `schemas/pipeline-schedule.schema.json` / `schemas/put-pipeline-schedule-request.schema.json`
    — field sets match design.md/tasks.md's description of `PipelineSchedule` /
    `PutPipelineScheduleRequest` field-for-field (including `enabled` optional on PUT, `nextRunAt`/
    `lastRunAt` nullable).
- Confirmed the frontend precedents the design cites are real, not invented:
  - `PipelineDetailPage.tsx` (486L) / `PipelineDetailFooter.tsx` (217L) — line counts match
    design.md's claim; `PipelineDetailPage.tsx` already fetches per-pipeline `Record`-keyed state
    on mount (`runHistory[id]`, `reduxSteps[id]` pattern in `state.pipelines`), which the new
    `schedule: Record<string, PipelineSchedule | null>` + mount-time `fetchPipelineSchedule` plan
    (D5, task 3.3) fits cleanly into.
  - `dataTypesSlice.ts:48` — real 409-branching precedent (`axiosErr.response?.status === 409`)
    cited by D5/task 2.3 for the 404-as-domain-state pattern.
  - `dashboardsSlice.ts:162,182` — real `isAxiosError` + `response?.data?.message` precedent cited
    by D4/task 2.4.
  - `BoundSourceBar.tsx` / `BoundTypeBar.tsx` — real bar components confirming D1's "same shape as
    BoundSourceBar/BoundTypeBar" placement claim is plausible.
  - `PipelineShareDialog.tsx` — read in full; confirms it's a `Modal`-based dialog with local
    `open`/`loading`/`error` state and its own fetch-on-open (`useEffect` gated on `open`), as D1
    describes — but see Change Request 1 below for why citing it as the *fetch* pattern (not just
    the modal-shape pattern) creates a real conflict with D5/task 3.3.
  - `frontend/src/shared/ui/{TextField,Select,Modal}.tsx` and `frontend/src/shared/chrome/
    InlineError.tsx` all exist as claimed/needed. `InlineError` is already used inside the
    `pipelines` feature itself (`ComputeFieldConfig.tsx`, `AggregateConfig.tsx`), a closer
    precedent than `PipelineShareDialog`'s hand-rolled `<p className="...__error" role="alert">` —
    see Change Request 2.
  - No `checkbox-row` component or CSS class exists anywhere in `frontend/src` (grepped), and
    `DESIGN.md` never mentions it — proposal.md's "reuse existing Select/TextField/checkbox-row/
    Modal primitives" overstates what's actually a shared component vs. an ad hoc pattern (plain
    `<input type="checkbox">`, as used e.g. in `TypeDetailPanel.tsx`). Non-blocking, see notes.
- Read `DESIGN.md` §§3, 6, 7 (tokens, shared-component reuse, UI state patterns) and
  `CONTRIBUTING.md`'s file-size soft-budget rule (~250L/file, ~400L "propose a split" threshold) —
  design.md explicitly accounts for the latter (new component instead of growing the already-486L
  `PipelineDetailPage.tsx` or the already-size-capped `PipelineDetailFooter.tsx`).
- Traced every ticket AC to a spec requirement: AC1 (set/edit/enable/disable/clear) → 5 spec
  requirements with matching scenarios; AC2 (inline validation) → "Invalid expressions and
  timezones are surfaced inline"; AC3 (next-run display) → "Schedule bar shows current schedule
  state"; AC4 (DESIGN.md + tests) → tasks 4.1–4.4; AC5 (backward-compatible) → explicit requirement
  + scenario. No AC is left uncovered, and no scope drift beyond the ticket was found (no backend
  changes, no generic design-system additions).
- Confirmed `httpClient.ts`'s only global interceptor branches on 401, not 404 — so the design's
  reliance on a clean 404 rejection reaching the thunk's `catch` is sound.

### Verdict: REFUTE

The backend-contract fidelity and AC traceability are solid — this is a well-grounded plan overall
— but two points are genuinely ambiguous/inconsistent enough that a competent implementer could go
two different ways, and both are cheap to fix in the design doc now rather than during execution.

### Change Requests

1. **D1's "fetch-on-open" for `PipelineScheduleDialog` conflicts with D5 + task 3.3's Redux/mount-
   fetch design.** design.md D1 says the dialog "mirrors `PipelineShareDialog`'s shape: local
   `open`/`loading`/`error` state, **fetch-on-open**, submit-on-save." But `PipelineShareDialog`
   doesn't use Redux at all — it calls `pipelineService` functions directly from a `useEffect`
   gated on its own `open` prop, with entirely local state. That contradicts D5 ("Redux: a
   per-pipeline `Record<string, PipelineSchedule | null>`... `fetchPipelineSchedule` thunk...") and
   task 3.3 ("fetch the schedule on mount alongside the existing pipeline/steps fetches" — i.e. the
   *page*, not the dialog, owns the fetch). Taken literally, D1 would have the implementer build a
   second, independent GET-on-open inside the dialog on top of the page-level Redux fetch the bar
   already relies on — two copies of the same data that can race or diverge. **Required fix:**
   amend design.md D1 to state explicitly that `PipelineScheduleDialog` does **not** issue its own
   fetch; it reads the already-loaded `schedule[pipelineId]` from Redux (populated by the page-
   level `fetchPipelineSchedule` on mount, per D5/task 3.3) to initialize its local form fields on
   open, and only dispatches `savePipelineSchedule`/`deletePipelineSchedule` on submit. Keep "local
   `open`/loading(save)/error state" from the `PipelineShareDialog` precedent (that part is fine),
   drop "fetch-on-open."

2. **Inline-error rendering doesn't commit to the DESIGN.md-canonical `InlineError` component.**
   `DESIGN.md` §6 lists `InlineError` (`frontend/src/shared/chrome/InlineError.tsx`) as a canonical
   primitive and says "do not hand-roll equivalents." The `pipelines` feature already uses it for
   exactly this kind of backend-validation-message display (`ComputeFieldConfig.tsx`,
   `AggregateConfig.tsx`) — a closer, more relevant precedent than `PipelineShareDialog`'s
   hand-rolled `<p className="pipeline-share-dialog__error" role="alert">`, which design.md D1
   cites instead. Neither design.md nor tasks.md (3.2) commits to which pattern the new dialog
   should follow. **Required fix:** add a line to design.md (D1 or a new decision) committing to
   `InlineError` for the schedule dialog's inline validation-error display, consistent with the
   existing in-feature precedent and DESIGN.md's explicit reuse rule.

### Non-blocking notes

- proposal.md's "reuse existing Select/TextField/checkbox-row/Modal primitives" references a
  `checkbox-row` component that doesn't exist anywhere in the codebase or `DESIGN.md`. Likely just
  loose wording for "a labeled checkbox row" (the existing pattern elsewhere is a plain `<input
  type="checkbox">`, e.g. `TypeDetailPanel.tsx`) — worth tightening the wording, but not
  implementation-blocking.
- Neither design.md nor tasks.md (3.2/4.3) explicitly calls out that editing an existing `interval`
  schedule requires decomposing the persisted `"<n><unit>"` expression back into the friendly
  picker's number + unit fields (the inverse of D2's compose-on-save). It's derivable from the same
  `^(\d+)(s|m|h|d)$` shape the backend validates against, but a one-line callout in task 3.2 would
  remove any doubt for the implementer.
