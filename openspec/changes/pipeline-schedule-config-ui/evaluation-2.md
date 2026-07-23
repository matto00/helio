## Evaluation Report — Cycle 2

### Phase 1: Spec Review — PASS
Issues: none. Re-verified live (not just by reading code) that the cycle-1 spec violation
("Schedule exists but has no computed next run yet" scenario) is fixed: creating a new interval
schedule and, separately, changing an existing schedule's cadence to cron both now render "no next
run yet" immediately after the PUT resolves, before any page reload — matching the spec exactly.
All other ACs remain met (verified again in Phase 3): set/edit/enable-disable/clear persist via
the schedule routes; invalid expressions/timezones surface inline; DESIGN.md is followed; backward
compatibility holds for a no-schedule pipeline. `tasks.md` and `files-modified.md` are up to date
with the cycle-2 fix (both explicitly annotated "cycle 2 (evaluation-1 change request N)"). No
scope creep — the cycle-2 diff (`53e53ed5..HEAD`) touches exactly the two change-request fixes plus
their regression tests and planning-doc updates.

### Phase 2: Code Review — PASS
Issues: none. Both cycle-1 change requests were addressed, and both fixes are correct and
independently verified:
1. `frontend/src/features/pipelines/ui/PipelineScheduleBar.tsx:35-38` — `formatNextRun` now takes
   `string | null | undefined` and uses a nullish (`== null`) guard instead of `=== null`, so an
   absent `nextRunAt` key (spray-json's `Option = None` wire-omission) takes the same "no next run
   yet" path as an explicit `null`. The fix comment correctly documents the root cause.
2. `frontend/src/features/pipelines/services/pipelineService.ts:172-205` — added
   `normalizeSchedule`, applied to both `getPipelineSchedule` and `putPipelineSchedule` responses,
   coercing an absent `nextRunAt`/`lastRunAt` wire key to `null` at the service boundary — this is
   a belt-and-suspenders fix alongside (1): even if a future caller reads `nextRunAt` without going
   through `formatNextRun`'s guard, the value it receives is already normalized to `string | null`,
   matching the declared `PipelineSchedule` type.
   Change request 2 (widen the type or normalize at the boundary) was satisfied by choosing the
   boundary-normalization option, which is the stronger fix of the two suggested — acceptable and
   arguably better than widening the type.
3. Regression coverage added in both directions:
   `frontend/src/features/pipelines/ui/PipelineScheduleBar.test.tsx` (new test: a schedule object
   with the `nextRunAt` key **omitted entirely**, not set to `null`, renders "no next run yet" and
   not "Invalid Date") and `frontend/src/features/pipelines/services/pipelineService.test.ts` (new
   file: `getPipelineSchedule`/`putPipelineSchedule` map an absent wire key to `null`, and preserve
   a present value unchanged). Both tests reproduce the exact wire shape that caused the bug
   (key-absent, not key-present-with-null), consistent with the project's established
   spray-json-omits-`None` testing guidance — these are meaningful regression tests, not
   rubber-stamp coverage.
4. No dead code, no scope creep, no new CONTRIBUTING.md/DESIGN.md violations introduced by the
   fix. `files-modified.md` accurately reflects the cycle-2 changes with clear "cycle 2" annotations.

Fresh gates (independently re-run, not trusted from executor report):
- `npm run lint` — clean (0 warnings, `--max-warnings=0`).
- `npm run format:check` — clean.
- `npm run build` — clean production build (pre-existing >500kB chunk-size warning only, unrelated
  to this change).
- Full Jest suite: **118 suites / 1235 tests, all passing** (up from cycle 1's 117/1231 — the 1
  new suite is `pipelineService.test.ts`, the 4 new tests are the regression coverage above).

### Phase 3: UI Review — PASS
Issues: none. Restarted dev servers via `scripts/concertino/start-servers.sh` (port 5589/8496,
`assert-phase.sh servers` → PASS) and re-ran the full live flow against the same fixture pipeline
(`Profit (migrated)`, `555f4bae-7c76-4566-84eb-036bc33b4485`) used in cycle 1:
- **Primary repro (cycle 1's blocking bug)**: set a 15-minute interval schedule via "Set schedule"
  → bar immediately showed **"no next run yet"** (not "Invalid Date") right after the PUT
  resolved, dialog still open state confirmed correct. Edited the same schedule, switched kind to
  cron (`0 * * * *`), saved → bar again immediately showed **"no next run yet"**, confirming the
  fix holds across a cadence change (the exact HEL-415 "PUT resets `next_run_at`" path that
  triggered the bug in cycle 1), not just on initial creation.
- Edit pre-fill / interval decomposition: still correct (15 / Minutes pre-filled on reopening the
  interval schedule before switching to cron).
- Enable/disable toggle from the bar: still correctly persists via PUT with unchanged
  kind/expression/timezone and updates the bar (checkbox aria-label, "Disabled" badge).
- Inline validation: an invalid timezone (`Bad/Zone`) still surfaces the backend's exact message
  via `InlineError` without closing the dialog or clearing other fields (cron expression field
  retained its value through the failed save).
- Clear schedule: "Clear schedule" still returns the bar to "No schedule set"; fixture left in
  that state at the end of the session.
- No unhandled exceptions, blank screens, or React error boundaries triggered at any point. The
  only console entries are the same browser-level `Failed to load resource: ... 404`/`400` network
  logs noted (non-blocking) in cycle 1 — an unavoidable side effect of the HEL-414 backend's
  404-as-"no schedule" contract, out of scope for this ticket to change.
- Did not re-run the full breakpoint/light-theme matrix this cycle (unchanged by the fix, already
  verified clean in cycle 1, and the fix touches only text content, not layout/CSS).

### Overall: PASS
