## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read the round-1 report (`skeptic-design-1.md`) in full to know exactly what was required, then
  re-read `proposal.md`, `design.md`, `tasks.md`, `specs/pipeline-schedule-config-ui/spec.md`, and
  `ticket.md` fresh (cold), not trusting the round-1 narrative for round-2 conclusions.

- **Change Request 1 (fetch-vs-Redux contradiction) — genuinely resolved, not just reworded.**
  `design.md` D1 now reads: "Unlike `PipelineShareDialog` (which has no Redux-held data to reuse),
  the dialog does **not** issue its own GET on open: it reads the already-loaded
  `schedule[pipelineId]` from Redux (populated by the page-level `fetchPipelineSchedule` on mount,
  per D5/task 3.3) to initialize its local form fields, and only dispatches
  `savePipelineSchedule`/`deletePipelineSchedule` on submit." `tasks.md` 3.2 mirrors this exactly
  ("the dialog does **not** fetch; it initializes its fields from the already-loaded
  `schedule[pipelineId]` Redux state ... and only dispatches on submit"), and task 4.3's test list
  now explicitly asserts "edit pre-fills fields from Redux state (no GET call from the dialog
  itself)". I grepped the live change dir for the string "fetch-on-open" and it now appears **only**
  inside `skeptic-design-1.md` (the historical report) — confirmed gone from `design.md`/`tasks.md`.
  D1, task 3.2, task 3.3, and task 4.3 all now tell the same story with no residual ambiguity.

- **Change Request 2 (InlineError commitment) — genuinely resolved.** A new decision `D1a — Inline
  validation errors use the canonical `InlineError` component` was added to `design.md`, citing
  `DESIGN.md` §6 and the in-feature precedent (`ComputeFieldConfig.tsx`, `AggregateConfig.tsx`) over
  `PipelineShareDialog`'s hand-rolled paragraph, and states the dialog renders
  `<InlineError error={saveError} />`. I re-read `ComputeFieldConfig.tsx:16,84` and
  `AggregateConfig.tsx:14,170` directly — both import `InlineError` from
  `../../../shared/chrome/InlineError` and use an `error` prop, matching the signature D1a assumes.
  `tasks.md` 3.2 ("`InlineError` for save/validation errors") and 4.3 ("`InlineError` rendered with
  the backend's message on 400 without closing the dialog or clearing input") are consistent with
  D1a and with each other.

- **No new inconsistency introduced by the fix.** Cross-checked design.md against tasks.md and
  spec.md line by line for the touched decisions (D1, D1a, D2, D5) and their corresponding tasks
  (2.2–2.5, 3.1–3.3, 4.1–4.4) and requirements/scenarios in spec.md — all consistent on: dialog data
  source (Redux, not fetch), error-display component (`InlineError`), and state shape (`schedule:
  Record<string, PipelineSchedule | null>`, `scheduleSaveStatus`/`scheduleSaveError` separate from
  `scheduleStatus`/`scheduleError`).
  - Verified the new-state fields (`schedule`, `scheduleStatus`, `scheduleError`,
    `scheduleSaveStatus`, `scheduleSaveError`) don't collide with the real, current
    `PipelinesState` interface in `frontend/src/features/pipelines/state/pipelinesSlice.ts` (read in
    full) — no existing `schedule*` key.
  - Verified D2's added decomposition-regex detail (`^(\d+)(s|m|h|d)$`) matches the backend's actual
    `intervalPattern` in `backend/src/main/scala/com/helio/services/PipelineScheduleService.scala:158`
    exactly (`"^(\\d+)(s|m|h|d)$".r`), and the stated fallback (empty number field + raw expression
    preserved) is a sound, low-risk default for the "shouldn't happen" case.

- **Non-blocking note 1 (checkbox-row wording) — addressed.** `proposal.md`'s Non-goals now reads
  "reuse existing `Select`/`TextField`/`InlineError`/`Modal` primitives and the plain
  `<input type="checkbox">` pattern per `DESIGN.md`" — the nonexistent `checkbox-row` term is gone.
  Grepped `openspec/changes/pipeline-schedule-config-ui/`, `frontend/src`, and `DESIGN.md` for
  `checkbox-row`: it now appears only in the historical round-1 report.

- Re-traced all 5 ticket ACs to spec.md requirements/scenarios and tasks — unchanged from round 1's
  finding (fully covered, no scope drift), and the round-2 edits don't touch AC coverage.

### Verdict: CONFIRM

Both round-1 required revisions are substantively fixed (not cosmetic rewording) and are internally
consistent across design.md, tasks.md, and spec.md. No new contradiction was introduced by the
fix. The plan is sound enough to implement.

### Non-blocking notes

- `proposal.md`'s "the plain `<input type="checkbox">` pattern per `DESIGN.md`" slightly overstates
  that `DESIGN.md` itself documents a checkbox pattern (it doesn't mention checkboxes at all — I
  grepped it). The actual precedent is a plain HTML checkbox used elsewhere in the codebase (e.g.
  `TypeDetailPanel.tsx`, per round 1), styled per `DESIGN.md`'s general token rules, not a
  `DESIGN.md`-named pattern. Cosmetic; doesn't block implementation since the intent (no new
  component, plain checkbox) is unambiguous.
