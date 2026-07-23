## Context

HEL-414 shipped `GET/PUT/DELETE /api/pipelines/:id/schedule` (PUT = upsert; body
`{ kind: "cron"|"interval", expression, enabled?, timezone }`; 400 body is `{ message }` via
`ErrorResponse`, see `backend/src/main/scala/com/helio/api/protocols/ResourceProtocol.scala`).
HEL-415 added the scheduler runtime and made PUT reset `next_run_at` on cadence changes. This
change is the frontend surface: `PipelineDetailPage.tsx` (486L), `PipelineDetailFooter.tsx`
(217L), `pipelineService.ts`, `pipelinesSlice.ts`. `PipelineDetailFooter.tsx`'s file header notes
it was extracted specifically to keep the parent page under a 400L soft cap — this change adds a
new component rather than growing either file materially.

## Goals / Non-Goals

**Goals:**

- Set/edit/enable/disable/clear a schedule from the editor; persist via the HEL-414 routes.
- Surface backend validation errors (400 `{ message }`) inline, not as a toast-only failure.
- Show enabled + next-run state on the detail page at a glance, without opening a dialog.
- Zero visual/behavioral change for pipelines without a schedule.

**Non-Goals:**

- Client-side re-implementation of cron/interval grammar validation (HEL-414 owns that; this
  change treats it as an opaque error-string API).
- A generic timezone-picker component — a `TextField` with a sensible default is enough for v1.
- Any scheduler-runtime or run-provenance behavior (siblings HEL-415/417).

## Decisions

**D1 — New `PipelineScheduleBar` + `PipelineScheduleDialog`, not a footer addition.** The footer
already carries save/cancel/run/preview/history actions and has a documented size constraint. A
new bar (same shape as `BoundSourceBar`/`BoundTypeBar`) placed between `BoundTypeBar` and the
river view shows the at-a-glance summary ("No schedule" / "Every 1h · next run in 3h" + an inline
enabled toggle). Clicking "Edit schedule" opens `PipelineScheduleDialog`, a `Modal`-based form for
kind/expression/timezone and delete ("Clear schedule"). It mirrors `PipelineShareDialog`'s shape
for local UI state only (`open`/`saving`/`error` state, submit-on-save) — **not** its data
fetching. Unlike `PipelineShareDialog` (which has no Redux-held data to reuse), the dialog does
**not** issue its own GET on open: it reads the already-loaded `schedule[pipelineId]` from Redux
(populated by the page-level `fetchPipelineSchedule` on mount, per D5/task 3.3) to initialize its
local form fields, and only dispatches `savePipelineSchedule`/`deletePipelineSchedule` on submit.
This avoids a second, independent fetch racing or diverging from the page-level one the bar
already relies on. Alternative considered: inline expansion in the footer — rejected, footer is
already the densest region and a modal matches the existing Share-dialog precedent for
"secondary, occasional-use pipeline config".

**D1a — Inline validation errors use the canonical `InlineError` component.**
`frontend/src/shared/chrome/InlineError.tsx` is `DESIGN.md`'s §6 canonical primitive for exactly
this ("do not hand-roll equivalents"), and the `pipelines` feature already uses it for
backend-validation-message display (`ComputeFieldConfig.tsx`, `AggregateConfig.tsx`) — a closer
precedent than `PipelineShareDialog`'s hand-rolled `<p className="...__error" role="alert">`.
`PipelineScheduleDialog` renders its save/validation error via `<InlineError error={saveError} />`,
not a hand-rolled paragraph.

**D2 — Friendly interval picker: number + unit `Select`, not free text.** For `kind: "interval"`
the AC asks for "a friendly interval picker". Compose the `<n><unit>` wire expression from a
`TextField[type=number]` (n) + `Select` (unit: s/m/h/d) rather than free-text entry — this can't
produce a malformed token client-side. For `kind: "cron"`, the wire format (5-field cron) doesn't
have a friendlier widget without a new dependency (non-goal), so it stays a mono `TextField` with
placeholder `0 * * * *` and a one-line format hint. Kind switch is a `Select`. On edit, the reverse
decomposition (`"<n><unit>"` → number + unit fields) uses the same `^(\d+)(s|m|h|d)$` shape the
backend validates against (`PipelineScheduleService.intervalPattern`); an expression that somehow
doesn't match (shouldn't happen — the backend rejects anything else) falls back to an empty number
field with the raw expression preserved, rather than silently dropping data.

**D3 — Timezone is a plain `TextField`, defaulted from the browser.** No curated picker (non-goal,
avoids new design-system surface for one field). Default value on open (new schedule only):
`Intl.DateTimeFormat().resolvedOptions().timeZone`, so the common case ("my own timezone") needs no
typing. Existing schedules always show their persisted `timezone`.

**D4 — Error surfacing reuses the `isAxiosError` + `response.data.message` pattern.** Matches
`dashboardsSlice.ts`'s `importDashboard`/`applyProposal` thunks and `sourcesSlice.ts`'s
`extractErrorMessage` helper exactly (backend's `ErrorResponse(message)` always uses that field
name) — no new error-shape convention introduced.

**D5 — Redux: a per-pipeline `Record<string, PipelineSchedule | null>`, GET 404 = `null`, not an
error.** Mirrors `PipelineScheduleService.find`'s domain shape (`NotFound` on "no schedule" is
expected, not exceptional). `fetchPipelineSchedule` treats a 404 response as
`{ pipelineId, schedule: null }` in its `fulfilled` case (checks `err.response?.status === 404`
before falling through to `rejectWithValue`), matching `dataTypesSlice.ts`'s existing 409-branching
precedent (`axiosErr.response?.status === 409`) for "expected non-2xx as a domain state, not a
failure". `savePipelineSchedule` (PUT) and `deletePipelineSchedule` get their own status/error
state (`scheduleSaveStatus`/`scheduleSaveError`) so a failed save doesn't clobber the last-loaded
schedule shown in the bar.

**D6 — New types file `types/pipelineSchedule.ts`.** `PipelineSchedule` /
`PutPipelineScheduleRequest` mirror `schemas/pipeline-schedule.schema.json` /
`schemas/put-pipeline-schedule-request.schema.json` field-for-field. Kept separate from the large
`types/pipelineStep.ts` rather than appended to it — schedules are a distinct concern from steps.

## Planner Notes (self-approved)

- No backend changes are needed or made; this change only consumes existing HEL-414 routes.
- Placement as a new bar (D1) rather than extending `BoundTypeBar`/footer keeps each component
  single-purpose, consistent with the existing bar/footer split.

## Risks / Trade-offs

- [Risk] A raw cron `TextField` gives no autocomplete/preview → a user can still submit a
  plausible-looking-but-wrong cron string that 400s. → Mitigation: inline error text repeats the
  backend's field-specific message (e.g. "field 2 ('99') is malformed"); a one-line format hint
  and placeholder reduce the common-mistake rate.
- [Risk] `next_run_at` is `null` until the scheduler's next tick computes it (HEL-415), so a
  freshly-saved enabled schedule may show "No next run yet" briefly. → Mitigation: this is
  accurate, not a bug — display it as a neutral state, not an error.
