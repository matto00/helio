## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Issues:
- **AC2 ("...re-enable cleanly") is violated by a reproducible race condition** — see Phase 3 for
  full repro/root-cause. Disable → persist → exclude-from-run/analyze/preview all work correctly;
  duplicate works correctly; but "re-enable cleanly" is not met when the step's preview panel is
  open at re-enable time: the UI shows a persistent, incorrect `Request failed with status code
  422` error instead of a refreshed preview, even though the enable itself succeeded and persisted
  correctly. This also touches the `pipeline-step-lifecycle` spec delta's requirement "A toggle
  SHALL refresh analysis (and open previews) so schemas/validation reflect the changed effective
  pipeline" — the refresh should succeed, not surface a false failure.
- All other Phase 1 checks pass:
  - AC1 (duplicate via UI) — confirmed live: clone lands directly after the original with
    identical config, persists across reload.
  - AC3 (migration) — confirmed: `V86__pipeline_steps_enabled.sql` applies cleanly (backend test
    run: "Successfully applied 85 migrations ... now at version v86"); no `V85` exists locally,
    consistent with the coordinator's note that it belongs to the parallel HEL-462 lane.
  - AC4 (tests) — backend tests present and green (3073/3073); frontend tests present and green
    (1843/1843 + 186 helio-mcp); however, the tests do not exercise the real-network-timing race
    that produces the AC2 violation above (unsurprising — jsdom/jest-mocked service calls resolve
    synchronously/deterministically and can't reproduce a wire-timing race; this is a test-gap
    worth noting, not a separate defect).
  - AC5 (backward compatible / additive wire) — confirmed via code review: `enabled: Option[Boolean]`
    on both requests, migration `DEFAULT true`, every response subtype always serializes `enabled`.
  - Tasks 1–4 all marked done and match the implementation (verified via diff, no unmarked-but-done
    or done-but-unimplemented items).
  - No scope creep — diff matches design.md's Impact list exactly; the executor correctly
    identified and *deliberately deferred* a related gap (`PatchSetUndoInverse` not propagating
    `enabled` on undo/redo-recreate) as an out-of-scope spinoff rather than scope-creeping it in.
  - No regressions — full backend + frontend suites green.
  - Schemas updated (`create-pipeline-step-request.schema.json` gains `enabled`), `check:schemas`
    green.
  - Planning artifacts (proposal/design/tasks/spec deltas) accurately reflect the implemented
    behavior, including the design-gate history recorded in `workflow-state.md`.

### Phase 2: Code Review — FAIL

Gates (all re-run fresh in `WORKTREE_PATH`, `CLEAN_WORKTREE` not set at this speed):
- `cd backend && sbt test` — **PASS** (3073 tests, 0 failed; V86 migration applied cleanly)
- `npm run lint` — **PASS** (zero warnings)
- `npm run format:check` — **PASS**
- `npm test` — **PASS** (1843 frontend + 186 helio-mcp, 0 failed)
- `npm run check:schemas` — **PASS** (61 schemas checked, in sync)
- (also ran, non-required but informative) `npm run check:scala-quality` — clean, no new inline-FQN
  violations; only pre-existing informational file-size warnings, including the two files this
  change grew (`PipelineStepRepository.scala` 329 lines, `PipelineService.scala` 846 lines — both
  already over the 250-line soft budget before this change, growth is incremental per
  `files-modified.md`'s own notes and non-blocking per CONTRIBUTING.md).

Issues:
- **Race condition in the preview-refetch effect when re-enabling a step with its preview open**
  (`frontend/src/features/pipelines/ui/StepCard.tsx:175-216`, specifically the "Activation: fetch
  immediately, no debounce" branch at `StepCard.tsx:199-203`, interacting with
  `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx:437` `handleToggleStepEnabled`).
  Root cause:
  - `configFingerprint`'s dependency array includes `step.enabled` (`StepCard.tsx:218`, HEL-412's
    Decision 8 change). When a step is *disabled*, `active` becomes `false` and
    `lastFetchedFingerprint.current` is reset to `null` (`StepCard.tsx:182`).
  - When the SAME step is *re-enabled*, `active` becomes `true` again on the very next render, and
    because `lastFetchedFingerprint.current === null`, the effect takes the **immediate,
    undebounced** "activation" fetch path (`StepCard.tsx:199-203`) rather than the 500ms-debounced
    path used for ordinary config edits.
  - `handleToggleStepEnabled` (`PipelineDetailPage.tsx:437-452`) flips `steps` **optimistically**
    (synchronously) before `await`-ing the enable PATCH. The optimistic flip is what flips
    `step.enabled` and triggers the effect above — so the immediate preview GET is dispatched
    essentially concurrently with (and can easily win the race against) the SAME click's own
    enable PATCH's server-side commit.
  - When the preview GET reaches the backend before the PATCH's DB write commits, the backend's
    own defensive check in `previewStep` (correctly, by design) returns `422 "step is disabled"`.
    The frontend surfaces this as `previewError`, which is then **stuck**: since
    `lastFetchedFingerprint.current` was already set to the current fingerprint before the fetch
    even resolved, nothing re-triggers a retry, so the incorrect error persists until some other
    interaction (e.g. toggling the preview off/on) forces a fresh fetch.
  - Reproduced deterministically 2/2 attempts against this run's dev servers (backend port 8751,
    frontend port 5844): network log showed `PATCH .../pipeline-steps/<id>` (200 OK, the enable)
    immediately followed by `GET .../steps/<id>/preview` (422), and the step card's preview panel
    displayed a persistent `Request failed with status code 422` alert even though the step was,
    by then, correctly enabled and persisted (confirmed via full page reload: `enabled: true`
    round-tripped correctly — this is purely a client-side UI/race defect, not data corruption).
  - This is newly introduced by this ticket: the pre-existing "activate: fetch immediately"
    fast-path (HEL-404) was safe for expand/open-preview activations because nothing else was
    concurrently mutating server state; HEL-412's addition of `step.enabled` to the same dependency
    array turns "just re-enabled" into an "activation" that now races the enabling mutation itself.
  - Duplicate does **not** share this defect (verified) — the new step's `POST` fully resolves
    (201) before the local `steps` splice occurs (design.md Decision 7, non-optimistic), so there
    is no equivalent race on the duplicate path.
  - Fix direction (any of the following closes the gap): (a) don't let a `step.enabled`
    false→true transition take the undebounced "activation" branch — route it through the same
    debounced branch used for config-change re-fetches instead of resetting
    `lastFetchedFingerprint.current` to `null` on deactivation; (b) in
    `handleToggleStepEnabled`, don't flip the optimistic `enabled` bit until the PATCH resolves
    when the step's own preview is currently open (a scoped exception to the optimistic-first
    convention); or (c) treat a `422` immediately following an enable-toggle as retryable once
    before surfacing it as a terminal `previewError`.
- No other code-quality issues found. DRY/readability/modularity/type-safety/security/dead-code
  checks pass on the diff: mechanical patterns (ACL triad, `findByIdInternal` internal-bypass
  comments, `PipelineStepConfigCodec` reuse for duplicate's config round-trip,
  `updatePipelineStepEnabled` kept as a sibling function rather than widening
  `updatePipelineStep`'s signature) all match CONTRIBUTING.md and existing precedent. No inline
  FQNs. No untyped escape hatches. Backend skip-semantics are applied correctly and consistently
  at all five documented call sites (`PipelineRunService.runPipeline` full+dry run,
  `PipelineRunService.previewStep`, `PipelineService.analyze`, `PipelineService.analyzeProposal`,
  `BoundPanelService.projectSchema`) — confirmed via diff review and live pipeline-run check (see
  Phase 3).

### Phase 3: UI Review — FAIL

Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` on this run's
ports (5844/8751); both reported healthy. Servers stopped after review (killed the `vite` PID on
5844 and the `sbt run` `java` PID on 8751 directly, since `cleanup.sh` is orchestrator/Phase-4-only
and was correctly not invoked).

Live checks performed against a purpose-built "HEL-412 eval test pipeline" (Rename column → Select
fields → Limit rows, 3 steps), created and deleted within this review (pre-existing fixtures
untouched):

- **Happy path — PASS**: Disable/Enable and Duplicate icon buttons appear as siblings of the drag
  handle and Move buttons on every StepCard header, exactly as design.md Decision 6 specifies.
  Disabling a mid-pipeline step (`Select fields`) mutes the card (label/checkbox/body at reduced
  opacity, header actions stay fully legible), hides its preview control, and the config editor
  (field checkboxes) remains visible/editable — matches the spec's "editor remains
  visible-but-muted... config stays editable" requirement exactly. A real pipeline run with the
  step disabled completed successfully and the run's per-step row-count badges appeared only on
  the two enabled steps (`Rename column 3 rows`, `Limit rows 3 rows`) — the disabled step showed no
  badge, confirming run-time exclusion end-to-end (not just via backend unit tests). Duplicate
  lands directly after the original with identical config (`email`+`amount` both checked in the
  clone), confirmed via a fresh header-focus / expand. Toggle state (`enabled=true`/`false`) and
  duplicate both persist correctly across a full page reload.
- **Unhappy path — FAIL**: see the race condition documented in Phase 2 — re-enabling a step whose
  preview panel is open produces a persistent, incorrect `Request failed with status code 422`
  error banner instead of the refreshed preview data. This is a real, user-visible "unhappy path
  handled badly" finding per this phase's own checklist ("Unhappy paths ... handled gracefully — no
  blank screens, no unhandled exceptions" — here it's not blank/unhandled, but it is **actively
  incorrect**, which is arguably worse: a currently-enabled, correctly-functioning step displays a
  hard error implying it is broken).
- **Console errors** — one console error appears on every pipeline-detail-page load
  (`GET /api/pipelines/:id/schedule → 404`) — this is pre-existing behavior unrelated to this
  ticket's diff (no-schedule-set is a normal 404, not a regression). The **second** console error
  (`GET .../preview → 422`) is the race documented above and **is** new/introduced by this diff.
- **Loading/empty/error states** — loading and empty states unaffected by this diff; the one error
  state this diff newly introduces is the race above.
- **Entry points** — the only entry point for these actions is the StepCard header actions
  cluster on the pipeline detail page; confirmed working from there.
- **Accessible names / keyboard** — PASS: both new buttons are semantic `<button type="button">`
  elements with `aria-label` (`"Disable step"` / `"Enable step"`, flipping with state) and
  `aria-pressed` on the toggle; natively keyboard-operable (Enter/Space). Color is not the sole
  carrier of meaning (the accessible name flips, per design.md Decision 6/§8).
- **Breakpoints (1440/1100/768/390)** — PASS: rendered without new layout breakage at all four
  widths; the new action buttons remain visible and tappable at every width (the footer bar's own
  wrapping behavior at 390px is pre-existing responsive behavior from the mobile-PWA work, not
  touched by this diff).
- **Light/dark parity** — PASS: spot-checked light theme; muted/disabled styling and the new
  buttons render correctly with no dark-mode-only bleed-through, consistent with the diff's
  token-only CSS (`opacity: 0.6` muting, `color: var(--app-accent)` for the pressed toggle state —
  no hardcoded hex/rgb).

### Overall: FAIL

### Change Requests

1. Fix the re-enable/open-preview race in
   `frontend/src/features/pipelines/ui/StepCard.tsx:175-216` (interacting with
   `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx:437-452`
   `handleToggleStepEnabled`): re-enabling a step whose preview panel is open takes the
   undebounced "activation: fetch immediately" branch (`StepCard.tsx:199-203`), which races
   directly against the same click's own enable PATCH and can 422 before the PATCH commits,
   leaving a **persistent, incorrect** `Request failed with status code 422` error in the UI (does
   not self-heal — verified via a 2s+ wait and a full reload; the persisted `enabled` state itself
   is correct, only the UI error is wrong). Reproduced deterministically (2/2) in this cycle's live
   check. Fix by routing the `step.enabled: false→true` transition through the existing debounced
   fetch path instead of the immediate/undebounced one (or an equivalent fix per the three
   directions sketched in Phase 2) so the preview refresh always reflects settled server state.
   This is required to satisfy AC2's explicit "re-enable cleanly" and the
   `pipeline-step-lifecycle` spec delta's "A toggle SHALL refresh ... open previews".
2. Add a regression test (backend or frontend) that exercises re-enabling a step with an open
   preview under realistic async ordering (e.g. a frontend test that resolves the enable PATCH
   *after* the debounce/immediate-fetch would have fired, using fake timers + a deferred mock
   promise) so this class of race is caught by the suite going forward — the current 1843-test
   frontend suite passed cleanly without exercising this path, since jsdom-mocked service calls
   resolve synchronously and can't reproduce a real wire-timing race.

### Non-blocking Suggestions

- The executor's self-flagged spinoff (`PatchSetUndoInverse.fullPipelineStepInverse` /
  `pipelineStepCreateRequestFromResponse` not propagating `enabled` on undo/redo-recreate) is
  correctly out of this change's scope per design.md's Impact list — good discipline not to
  scope-creep it in. Worth filing as a follow-up ticket as the executor suggested.
