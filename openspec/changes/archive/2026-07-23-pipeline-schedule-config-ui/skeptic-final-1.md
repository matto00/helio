## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established (cold, not trusting evaluator's narrative)**
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-schedule-config-ui/spec.md`, `files-modified.md`, `CONTRIBUTING.md`, `DESIGN.md`
  in full.
- `git log --oneline -5`: two HEL-416 commits on top of the already-merged HEL-414/415 backend —
  `53e53ed5` (initial impl) and `acc6ce1f` (Invalid Date fix). `git diff main...HEAD --stat`
  confirms the diff is scoped to the files `files-modified.md` claims (frontend schedule
  types/service/slice/UI + tests), plus the pre-existing HEL-414/415 backend files that were
  already on this worktree's `main` before HEL-416 started (explained and consistent with
  `files-modified.md`'s note).
- Read the actual code, not just the design doc's description:
  `frontend/src/features/pipelines/types/pipelineSchedule.ts`,
  `frontend/src/features/pipelines/services/pipelineService.ts` (schedule section + `normalizeSchedule`),
  `frontend/src/features/pipelines/state/pipelinesSlice.ts` (schedule state + 3 thunks + reducers),
  `frontend/src/features/pipelines/ui/PipelineScheduleBar.tsx`,
  `frontend/src/features/pipelines/ui/PipelineScheduleDialog.tsx`, and both `.css` files.

**AC traceability (ticket.md → code, not just claimed)**
1. "Set, edit, enable/disable, clear a schedule; changes persist via schedule routes" —
   `pipelinesSlice.ts`'s `fetchPipelineSchedule`/`savePipelineSchedule`/`deletePipelineSchedule`
   thunks call the real `GET/PUT/DELETE /api/pipelines/:id/schedule` routes
   (`pipelineService.ts:190-210`); verified live end-to-end (see UI section below).
2. "Invalid expressions surfaced inline" — `PipelineScheduleDialog.tsx:279`
   (`<InlineError error={error} />`), fed by `extractErrorMessage` in the slice
   (`pipelinesSlice.ts:31-36`); verified live with a malformed cron and an invalid timezone.
3. "Next-run time displayed when schedule enabled" — `PipelineScheduleBar.tsx:80-85`; verified live.
4. "Follows DESIGN.md; tests cover set/edit/disable + validation" — see Code Review and Tests
   below.
5. "Backward compatible: no-schedule pipelines render as today" — verified live (screenshot below);
   `PipelineScheduleBar.tsx:49-60` renders only the added bar's empty state, no other DOM change.

No AC is unaddressed; no scope drift beyond the ticket's declared impact area.

**The specific bug this round exists to re-verify (evaluation-1.md's blocking finding, fixed in
`acc6ce1f`)**
- Root cause as documented: spray-json omits `Option = None` fields from the wire rather than
  serializing `null`, so a freshly-saved/cadence-changed `nextRunAt` deserializes as `undefined`,
  and the original `formatNextRun`'s `=== null` guard let `new Date(undefined)` through, rendering
  literal "Invalid Date" text.
- Read the fix directly: `PipelineScheduleBar.tsx:35-38` — `formatNextRun` now takes
  `string | null | undefined` and uses `if (nextRunAt == null) return null;` (nullish check).
  `pipelineService.ts:179-185` additionally normalizes `nextRunAt`/`lastRunAt` to `string | null`
  at the service boundary (belt-and-suspenders, applied to both `getPipelineSchedule` and
  `putPipelineSchedule`). Both fixes are real, not cosmetic.
- Regression tests read directly: `PipelineScheduleBar.test.tsx:78-81` destructures `nextRunAt` out
  of the fixture entirely (`const { nextRunAt: _omitted, ...rest } = enabledSchedule`) and asserts
  `"nextRunAt" in scheduleWithOmittedNextRun === false` before asserting the render — this
  reproduces the exact wire shape (key-absent) that caused the bug, not just `nextRunAt: null`.
  `pipelineService.test.ts:19,39-68` does the same for the service-boundary normalization on both
  GET and PUT.

**Fresh gates, re-run myself (not trusted from evaluator's paste)**
- `npm run lint` → clean (0 warnings).
- `npm run format:check` → "All matched files use Prettier code style!".
- Targeted tests (`pipelineSchedule|PipelineSchedule|pipelineService|pipelinesSlice|PipelineDetailPage`):
  5 suites / 151 tests, all passing.
- Full suite: `npm test` → **118 suites / 1235 tests, all passing** — matches evaluation-2.md's
  claimed count exactly (independent re-run, not copy-pasted).

**Live verification via Playwright (fresh servers, ports 5589/8496)**
- `scripts/concertino/start-servers.sh` → both already healthy; `assert-phase.sh servers` → PASS.
- Used a dedicated test fixture (`skeptic-pipeline`,
  `3e535ac8-b7d5-4608-a192-34c3a55ffe18`) rather than the evaluator's fixture, to get an
  independent, from-scratch read (left it back at "No schedule set" when done — no residual state
  change to the repo/DB beyond the schedule row, which round-trips through the same UI).
- **No-schedule state**: bar shows "No schedule set" / "Set schedule", matches the DATA
  SOURCE/OUTPUT TYPE bar recipe exactly (screenshot `01-no-schedule.png`, read directly).
  Console shows exactly one expected `404` network-log entry for the schedule GET — matches
  evaluation-2's noted non-blocking side effect of the HEL-414 404-as-"no schedule" contract.
- **Interval schedule set via friendly picker**: entered `15` / `Minutes`, saved → PUT fired,
  bar immediately (no reload) showed **"Every 15m" / "no next run yet"** — not "Invalid Date"
  (screenshot `02-interval-set.png`, read directly). This is the primary regression check for the
  fix this round exists to verify.
- **Cron schedule + cadence change**: edited the same schedule, pre-fill correctly showed
  `15` / `Minutes` (interval decomposition working), switched kind to Cron, entered
  `0 * * * *`, saved → bar immediately showed **"0 \* \* \* \*" / "no next run yet"** — confirms
  the fix holds across a cadence change (the exact HEL-415 "PUT resets `next_run_at`" path that
  triggered the original bug), not just initial creation.
- **Enable/disable toggle from the bar**: unchecked the bar's checkbox → network log showed a
  third `PUT .../schedule` call; bar updated to show a "Disabled" badge with the expression
  unchanged (`0 * * * *` retained) — matches the "unchanged kind/expression/timezone" AC.
- **Inline validation — malformed cron**: entered `99 * * * *`, saved → dialog stayed open,
  `InlineError` rendered the exact backend message ("Invalid cron expression '99 \* \* \* \*':
  field 0 ('99') is malformed"), cron field retained the entered value.
- **Inline validation — invalid timezone**: entered `Not/AZone`, saved → dialog stayed open,
  `InlineError` rendered the exact backend message ("Invalid timezone 'Not/AZone': not a valid
  IANA zone id"), all other field values (cron expression) retained.
- **Clear schedule**: fixed the timezone, clicked "Clear schedule" → DELETE fired, bar returned to
  "No schedule set" — fixture left in original state.
- **Dark theme parity**: toggled dark theme, reopened the dialog (`03-dark-dialog.png`) and set a
  new interval schedule to check the bar in dark mode (`04-dark-bar.png`) — both read directly.
  Modal stays fully opaque (`--app-surface-strong`), accent-orange checkbox/Save button, no bleed-
  through, and the bar correctly shows "no next run yet" in dark mode too — the fix is theme-
  independent (touches text content only, no CSS). Cleared the schedule again and switched back to
  light theme to leave the fixture clean.
- **Console errors**: only the three expected raw network-log entries (one 404 for "no schedule",
  two 400s for the two deliberately-invalid-input test cases) — no React errors, no unhandled
  exceptions, no blank-screen/error-boundary triggers at any point.

**DESIGN.md / CONTRIBUTING.md compliance (independent judgment, not re-running the evaluator's
checklist)**
- Tokens: `PipelineScheduleBar.css` and `PipelineScheduleDialog.css` use `--space-*`, `--text-*`,
  `--app-*` tokens throughout; no hardcoded hex/rgb. The two literal-px divergences flagged by the
  evaluator (`gap: 12px; padding: 10px 20px` in the bar; `--app-radius-md` buttons in the dialog) —
  I independently confirmed both are **exact copies** of pre-existing sibling code:
  `grep`'d `PipelineDetailPage.css:86-140` for `__source-bar`/`__type-bar` and found the identical
  `gap: 12px; padding: 10px 20px` values, and `grep`'d `PipelineShareDialog.css` and found the
  identical `border-radius: var(--app-radius-md)` on its action buttons. This is genuinely
  consistency-with-precedent, not new debt introduced by this change — correctly non-blocking.
- Shared components: `Modal`, `Select`, `TextField`, `InlineError` reused per D1/D1a; plain
  `<input type="checkbox">` matches the established codebase pattern (no `checkbox-row` component
  exists, confirmed at design gate). No hand-rolled equivalents.
- Light/dark parity: verified directly above, not inferred.
- File sizes: largest new file (`PipelineScheduleDialog.tsx`) is 283 lines — well within
  CONTRIBUTING.md's soft budget; `PipelineDetailPage.tsx`'s 46-line diff avoids growing it past its
  documented size-cap concern (a new bar/dialog was added instead of extending the footer, per D1).
- No inline FQNs, no `any`, imports at top of file — spot-checked across all five touched/new
  TS/TSX files.

### Verdict: CONFIRM

Both change requests from evaluation-1.md are genuinely fixed (independently re-derived root cause
and re-verified the fix live, not just re-reading the executor's claim), the regression tests
actually exercise the key-absent wire shape that caused the bug (not a weaker `null` test), all
five ticket ACs trace to real code and were exercised live end-to-end, fresh lint/format/test runs
are clean and match the evaluator's counts exactly, and DESIGN.md/CONTRIBUTING.md compliance holds
under independent inspection including a live dark-theme check the evaluator's report didn't
re-verify visually. This ships.

### Non-blocking notes

- Same as evaluation-2.md's non-blocking item: opening a pipeline editor for a pipeline with no
  schedule always logs a raw browser-level `404` network entry (the HEL-414 backend's
  404-as-"no-schedule" contract, out of scope for this ticket to change). Confirmed this is
  cosmetic/console-only — no user-visible effect, no thrown exception.
- The bar/dialog's literal-px and `--app-radius-md` divergences from DESIGN.md's strict token
  rules (noted above) are inherited from sibling code, not introduced here — worth a future
  design-debt cleanup ticket across all three bars + the share/schedule dialogs together, as
  evaluation-1.md already suggested. Not a reason to hold this ticket.
