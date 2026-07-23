## Evaluation Report — Cycle 1

### Phase 1: Spec Review — FAIL
Issues:
1. **Spec scenario violated: "Schedule exists but has no computed next run yet"**
   (`specs/pipeline-schedule-config-ui/spec.md`, "Requirement: Schedule bar shows
   current schedule state"). The scenario requires: "the schedule bar shows the
   schedule's expression without a next-run time, and does not render an error."
   Live-tested: creating a new interval schedule (or changing the cadence of an
   existing one, which HEL-415 resets `next_run_at` for) shows **"next run
   Invalid Date"** in the bar instead of "no next run yet" / no next-run text.
   This is visibly broken text, not a neutral state — see Phase 3 for the
   root-cause and repro.
2. All other ACs (set/edit/enable-disable/clear persists via schedule routes;
   invalid expressions surfaced inline; DESIGN.md compliance; tests for
   set/edit/disable/validation; backward-compatible no-schedule rendering) are
   met — verified live in Phase 3 and via test-suite review. Task checklist
   (`tasks.md`) matches the implemented code. No scope creep — diff is
   confined to the 12 files listed in `files-modified.md`, all within the
   ticket's declared impact area.

### Phase 2: Code Review — FAIL
Issues:
1. **Root cause of the Phase 1/3 bug** —
   `frontend/src/features/pipelines/ui/PipelineScheduleBar.tsx:26-29`:
   ```ts
   function formatNextRun(nextRunAt: string | null): string | null {
     if (nextRunAt === null) return null;
     return new Date(nextRunAt).toLocaleString(...);
   }
   ```
   only guards against `nextRunAt === null`. The backend's
   `PipelineScheduleResponse.nextRunAt` is `Option[String]`
   (`backend/src/main/scala/com/helio/api/protocols/PipelineScheduleProtocol.scala:16`),
   and spray-json's default `Option` formatter **omits** the key entirely from
   the JSON payload when it's `None` — it does not serialize `null` — which is
   an established, previously-documented gotcha in this codebase (spray-json
   omits `Option=None` on the wire; normalize at the service boundary, test
   with fields absent). So when the scheduler hasn't computed `next_run_at`
   yet (immediately after PUT, per HEL-415's "PUT resets `next_run_at` on
   cadence changes"), `schedule.nextRunAt` deserializes as `undefined`, not
   `null`. `formatNextRun`'s `=== null` check misses this, so
   `new Date(undefined)` produces an `Invalid Date` object and
   `.toLocaleString()` renders the literal string `"Invalid Date"` into the UI.
   The frontend type declaration (`types/pipelineSchedule.ts:19`,
   `nextRunAt: string | null`) is also inaccurate — it should reflect that the
   field may be absent (`| undefined`), which likely would have surfaced this
   at the type level or in a targeted "field absent" test per the project's
   own established testing guidance for this exact spray-json behavior.
   **Fix**: change the guard to a loose/nullish check (`if (nextRunAt == null)
   return null;` or `if (!nextRunAt)`), and consider normalizing
   `nextRunAt`/`lastRunAt` to `string | null` at the service boundary
   (`pipelineService.ts`'s `getPipelineSchedule`/`putPipelineSchedule`) so the
   rest of the app never has to special-case `undefined` vs `null`.

All other Phase 2 checks pass:
- CONTRIBUTING.md: no inline FQNs, imports at top of file, file sizes well
  within budget (largest new file is 283 lines), Redux-for-shared-state /
  presentational-components pattern followed, no `any` usage.
- DESIGN.md [mechanical]: tokens used throughout new CSS (`--space-*`,
  `--text-*`, `--app-*`, `--app-radius-*`); shared components (`Modal`,
  `Select`, `TextField`, `InlineError`) reused per D1/D1a rather than
  hand-rolled; accessible names present on all interactive elements
  (`aria-label` on checkboxes/selects/inputs, button text). The bar's literal
  `gap: 12px; padding: 10px 20px;` (`PipelineScheduleBar.css:9-10`) and the
  dialog's `--app-radius-md` buttons (`PipelineScheduleDialog.css:77,97,117`)
  technically diverge from the token/radius rules, but both exactly mirror
  pre-existing sibling code (`__source-bar`/`__type-bar` in
  `PipelineDetailPage.css:86-140`, `PipelineShareDialog.css`) rather than
  introducing new debt — non-blocking, noted below.
- DRY / modular / readable: `decomposeInterval`/`composeExpression`,
  `extractErrorMessage` reuse established patterns from
  `dashboardsSlice.ts`/`sourcesSlice.ts`/`dataTypesSlice.ts` exactly as the
  design doc specifies; no duplication introduced.
- Error handling: `savePipelineSchedule`/`deletePipelineSchedule` 400s surface
  inline via `InlineError` without closing the dialog (verified live);
  `fetchPipelineSchedule` 404-as-domain-state correctly modeled in Redux.
- Tests: full suite passes (117 suites / 1231 tests, matches the executor's
  report), including the new schedule-specific suites, all green.
- No dead code, no over-engineering.

### Phase 3: UI Review — FAIL
Issues:
1. **"Invalid Date" bug (blocking)** — reproduced live via Playwright against
   `scripts/concertino/start-servers.sh` (ports 5589/8496), on a real
   pipeline (`Profit (migrated)`), through the actual UI (not just
   inspection):
   - Opened a pipeline with no schedule → bar correctly showed "No schedule
     set" / "Set schedule".
   - Set an interval schedule (15m) via "Set schedule" → dialog composed
     `expression: "15m"` correctly, PUT succeeded, dialog closed — but the bar
     then showed **"next run Invalid Date"** instead of "no next run yet".
   - Reproduced again after switching to a cron schedule (`0 * * * *`) — same
     "next run Invalid Date" render, confirming this happens on every cadence
     change (matches HEL-415's "PUT resets `next_run_at`" behavior).
   - Reloading the page (fresh GET, by which point the scheduler had computed
     a real `next_run_at`) fixed the display — confirming the bug is a
     client-side parsing defect on the immediate post-PUT payload, not a
     persistence issue.
   - Visible in both dark and light themes, at 1440/1100/768/430px.
2. All other exercised flows are correct and match the spec:
   - Edit pre-fill / interval decomposition: editing the 15m schedule
     correctly pre-filled "15" / "Minutes"; editing after switching to cron
     correctly pre-filled the raw cron string.
   - Enable/disable toggle from the bar: toggling correctly persisted via PUT
     with unchanged kind/expression/timezone and updated the bar (checkbox
     aria-label, "Disabled" badge).
   - Inline validation: an invalid cron (`99 * * * *`) and an invalid
     timezone (`Not/AZone`) each surfaced the backend's exact message via
     `InlineError`, without closing the dialog or clearing the user's input
     (cron/timezone fields retained their entered values).
   - Clear schedule: "Clear schedule" issued the DELETE and returned the bar
     to "No schedule set".
   - Backward compatibility: a no-schedule pipeline's editor renders with only
     the added "No schedule set" bar; source bar, type bar, river view, and
     footer are otherwise unchanged.
   - Breakpoints 1440/1100/768 render without layout breakage; at 430px the
     schedule expression text truncates with an ellipsis (existing
     `text-overflow: ellipsis` rule) while the (buggy) next-run text remains
     visible — not a layout break, deferred to skeptic as [judgment].
   - No unhandled exceptions / blank screens / React error boundaries at any
     point.
3. **Non-blocking**: every page load for a pipeline without a schedule
   (explicitly "the common case today" per the ticket) logs a browser-level
   `Failed to load resource: ... 404` console entry for
   `GET /api/pipelines/:id/schedule`. This is an unavoidable side effect of
   modeling "no schedule" as an HTTP 404 (the HEL-414 backend contract this
   ticket must consume as-is, out of scope to change) — the browser logs the
   raw network failure regardless of the app's `try/catch` handling. Flagging
   for awareness only; not a code defect within this ticket's scope.

### Overall: FAIL

### Change Requests
1. Fix `formatNextRun` in `frontend/src/features/pipelines/ui/PipelineScheduleBar.tsx:26-29`
   to treat an absent (`undefined`) `nextRunAt` the same as `null` (e.g.
   `if (nextRunAt == null) return null;`), so a freshly-saved/cadence-changed
   schedule with a not-yet-computed `next_run_at` renders "no next run yet"
   per the spec's "Schedule exists but has no computed next run yet" scenario,
   instead of "Invalid Date". Add a regression test in
   `PipelineScheduleBar.test.tsx` that passes a schedule object with
   `nextRunAt` **omitted entirely** (not set to `null`) to catch this class of
   bug per the project's established spray-json-omits-`None` testing
   guidance.
2. Consider widening `PipelineSchedule.nextRunAt`/`lastRunAt` in
   `frontend/src/features/pipelines/types/pipelineSchedule.ts:19-20` to
   `string | null | undefined` (or normalize at the `pipelineService.ts`
   service boundary to always coerce absent → `null`) so the type signature
   reflects the actual wire contract and callers can't reintroduce the same
   bug.

### Non-blocking Suggestions
- `PipelineScheduleBar.css:9-10` (`gap: 12px; padding: 10px 20px;`) and
  `PipelineScheduleDialog.css`'s button radii (`--app-radius-md`) diverge from
  DESIGN.md's `--space-*`-token-only and `--app-radius-sm`-for-buttons
  [mechanical] rules, but both exactly mirror pre-existing sibling code
  (`PipelineDetailPage.css`'s `__source-bar`/`__type-bar`,
  `PipelineShareDialog.css`) rather than introducing new debt. Not asking for
  a fix in this ticket (would create visual inconsistency with the bars it's
  matching) — worth a future design-debt cleanup ticket across all three bars
  and the share/schedule dialogs together.
- At 430px the schedule expression truncates with an ellipsis while the
  next-run text does not — deferred to skeptic's visual judgment, not a
  mechanical layout break.
