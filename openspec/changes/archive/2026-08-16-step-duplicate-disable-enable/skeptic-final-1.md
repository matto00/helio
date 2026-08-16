## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established independently** (not trusting evaluation-1.md/evaluation-2.md claims):
`git log --oneline` confirms commits `bae7a1e0` + `b445b769` on `feature/step-duplicate-disable-enable/HEL-412` off base `68a2dd32`. `git diff 68a2dd32...HEAD --stat` — 66 files, matches `files-modified.md`'s inventory.

**Migration V86** — `backend/src/main/resources/db/migration/V86__pipeline_steps_enabled.sql` read directly: exactly `ALTER TABLE pipeline_steps ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;`, additive/instant-default. `ls backend/src/main/resources/db/migration/ | grep V85` returns nothing — confirmed V85 does not exist in this worktree (no collision). Fresh `sbt test` run (backend/embedded Postgres): log shows `Migrating schema "public" to version "86 - pipeline steps enabled"` immediately after v84, `Successfully applied 85 migrations ... now at version v86` — clean application. `Total number of tests run: 3073 ... succeeded 3073, failed 0` — reproduced myself, matches evaluation-2's count is not directly comparable (evaluator's evaluation-1 said ~3048 in design docs; my own fresh run is the ground truth: 3073/3073 green).

**Five skip-semantics boundaries — read the actual code, not the claim**:
1. `PipelineRunService.scala:143` — `runPipeline` (full run + dry run, one call site): `allSteps.filter(_.enabled)` before `executeRun`.
2. `PipelineRunService.scala:150-189` (`previewStep`): the target step itself: `case k if !sortedSteps(k).enabled => UnprocessableEntity("step is disabled")`; the executed prefix: `sortedSteps.take(k + 1).filter(_.enabled)`.
3. `PipelineService.scala:206` (`analyze`, live analyze call site): `val steps = allSteps.filter(_.enabled)` before building `PipelineAnalyzeService` inputs.
4. `PipelineService.scala:262` (`analyzeProposal`): `val enabledSteps = proposal.steps.filter(_.enabled.getOrElse(true))`.
5. `BoundPanelService.scala:133` (`projectSchema`): `val enabledSteps = steps.filter(_.enabled.getOrElse(true))`.

All five match design.md Decision 3 exactly, including the `.getOrElse(true)` treatment on the two `CreatePipelineStepRequest`-shaped call sites (proposal/bound-panel) vs. direct `.enabled` on the two persisted-domain call sites (run/analyze).

**Duplicate endpoint** (`PipelineService.scala:741-778`, `duplicateStep`): `findByIdInternal` → 404 if absent → `findByIdShared` (masks invisible steps as 404 too) → owner-or-`requireEditorAccess` (403 for viewer grantees) → config round-trip decode (500-classified on failure per Decision 5) → `current.sortBy(_.position).indexWhere(...)` for `originalListIndex` → `insertAtInternal(pipeline.id, existing.kind, typedConfig, originalListIndex + 1, existing.enabled)`. Matches design.md Decision 4 verbatim. Route: `PipelineStepRoutes.scala:61-66`, `POST /api/pipeline-steps/:id/duplicate`, 201.

**Cycle-2 race fix** — read `StepCard.tsx`'s preview-refresh effect (lines 183-254) end to end and traced every transition by hand:
- Disable (`!step.enabled`): returns immediately, does **not** touch `lastFetchedFingerprint` (so a later re-enable isn't mistaken for a fresh activation) — confirmed this is the actual mechanism, not just a comment.
- Re-enable (`wasEnabledRef` false→true, tracked via a ref updated at the top of every effect run before the early-return): unconditionally takes the 500ms debounced branch, **regardless of fingerprint equality** — closes the single-step round-trip edge case.
- Ordinary activation (`wasEnabled` already true): unchanged fall-through to the original "`lastFetchedFingerprint.current === null` → immediate fetch" branch — no regression.
- Mount-disabled-with-persisted-preview-open edge case: `wasEnabledRef` initializes from `step.enabled` at mount, so the first disabled→enabled transition is still correctly detected and debounced.

Frontend gates, fresh: `npm run lint` — zero warnings. `npm run format:check` — pass. `npx jest --testPathPatterns=pipelines` — 545/545 (matches evaluation-2's claimed count). `npm test` (full suite) — 1846/1846 (matches). `npm run check:schemas` — "schemas in sync ... 61 checked across 45 protocol files".

**Live verification** (`scripts/concertino/start-servers.sh` / `assert-phase.sh` on 5844/8751 — both `PASS`). Hit the documented shared-Playwright-session hijacking hazard hard this run (another concurrent worktree, HEL-688, kept redirecting the shared browser tab to `localhost:6120` and invalidating the shared host-scoped session cookie — matches `project_concertino_parallel_playwright_hazard.md`). Worked around it by driving setup/teardown via `curl` against `localhost:8751` directly (with the CSRF header `X-Helio-Requested-With: 1`) and only using the browser for the decisive interactive checks, timed to land cleanly:
- Added two steps (`select`, `limit`) to the `skeptic-pipeline` fixture (0 steps beforehand) via the API, confirmed `enabled: true` on the wire by default and `enabled: false` when explicitly sent on create (Decision 2's `Option[Boolean]` semantics, both directions).
- **Sibling actions cluster, screenshot-verified**: drag handle, Move up/down, Disable/Enable (power icon), Duplicate (copy icon) render as flat siblings inside `.pipeline-detail-page__step-card-actions-cluster` — no nesting, matches design.md Decision 6 and the HEL-407 precedent.
- **Disable live**: clicked "Disable step" on the Limit rows card — screenshot shows the card muted (label/icon grey vs. the enabled "Select fields" card's black label), preview control (`Hide preview`/`Preview data`) gone entirely, config editor (`Row limit (N)` input, `Remove step`) still visible and interactive. Accessibility snapshot confirms `aria-label` flips to "Enable step" and `aria-pressed="true"`.
- **Cycle-2 race, live re-repro**: re-enabled the same step with its preview persisted-open. Captured full network log across the sequence: `PATCH /api/pipeline-steps/:id` (enable) → 200, `GET .../analyze` → 200, `GET .../preview` → **200** (not 422) once the debounce elapsed. Zero 422s anywhere in the session's network log. Console errors: only the pre-existing, unrelated `GET .../schedule → 404` (no-schedule-set). Screenshot after re-enable shows the card fully restored (rows re-rendered, no error banner).
- **Duplicate live**: clicked "Duplicate step" on Limit rows — clone appeared directly after the original (position `originalListIndex + 1`), config+type equal, step count incremented correctly.
- **CSS/token audit** (`PipelineDetailPage.css`): the `--disabled` modifier is `opacity: 0.6` on icon/label/body only (never on the actions cluster, so re-enable/remove stay legible) — token-free, no new colors. The toggle button's `aria-pressed="true"` state uses `color: var(--app-accent)`. The whole diff uses only existing tokens (`--app-*`, `--space-*`, `--text-*`) and reuses the existing 24×24 icon-button recipe (`--step-card-drag-handle`/`--move-btn`/`--toggle-enabled-btn`/`--duplicate-btn` share one selector block) — no one-off styles invented. Since theming is pure CSS-custom-property resolution (no per-theme overrides in this diff), light/dark parity is structural, not something that could silently diverge; spot-checked dark theme via a live screenshot — the same muted/accent treatment holds.
- **All-steps-disabled = passthrough**: not independently live-repro'd (would have meant disabling every step and running a real Spark job, too heavy for this pass), but covered by `PipelineRunServiceSpec`'s "all-disabled behaves as a zero-step passthrough" test, which is part of the 3073/3073 green backend run above, and the logic (`allSteps.filter(_.enabled)` producing an empty vector) is the same code path exercised by the single-disabled-step scenario I did verify live.

Cleaned up: added-then-removed 2 (then 7, then 2 again — see below) test steps against `skeptic-pipeline`, restored it to 0 steps (confirmed via a final `GET .../steps` returning `[]`). Both dev servers (backend PID 3831164, frontend PID 3831727) killed and reconfirmed via `lsof` that 5844/8751 are no longer listening. Scratch screenshots removed.

### An independent finding: duplicate has no double-submission guard

While live-testing, one click on "Duplicate step" fired **two** `POST .../duplicate` requests (network log: #370 and #372, both 201, ~440ms apart) and created two clones instead of one. I re-tested carefully to rule out a one-off tooling artifact: a clean single click on a different card's Duplicate button fired exactly one POST; a **deliberate, explicit double-click** (`doubleClick: true`) on a fresh step reliably reproduced exactly two POSTs and two persisted clones every time. Root cause: `PipelineDetailPage.tsx`'s `handleDuplicateStep` (design.md Decision 7, "non-optimistic") has no in-flight guard — no button-disable-while-pending, no debounce — so a rapid double-click (a common real-world interaction on a small icon-only button with no immediate visual feedback) creates two persisted steps.

I checked whether this is a regression introduced by this diff or an existing codebase pattern: `frontend/src/features/dashboards/ui/DashboardList.tsx:316` (`duplicateDashboard`) and `frontend/src/features/panels/ui/PanelCard.tsx:194-196` (`duplicatePanel`) — the two precedents design.md Decision 4 explicitly cites — have the **identical** gap (a bare `dispatch(...)` on click, no pending-state guard). This is a pre-existing, sitewide pattern for every "duplicate" button in the app, not something HEL-412 introduced or diverged from. Per my "consistency with sibling screens" judgment criterion, this is actually *on*-pattern.

**Verdict on this finding: non-blocking.** It doesn't violate any AC (a single click duplicates correctly, which is what the ticket and spec ask for), it's fully recoverable (`Remove step` cleans up an accidental extra), and singling out this ticket's new button for a hardening pattern absent from its two cited precedents would be inconsistent scrutiny rather than a real regression. Flagging as a follow-up-ticket candidate (ideally bundled across all three duplicate buttons for consistency) rather than a change request against this diff.

### Acceptance criteria — traced

- "A step can be duplicated... via the UI" — met: `PipelineStepRoutes.scala:61`, `PipelineService.duplicateStep`, live-verified.
- "A step can be disabled/enabled; excluded from runs AND analyze/preview, re-enable cleanly" — met: 5 boundaries above, live-verified including the cycle-2 fix.
- "Flyway migration applies cleanly on fresh + existing DBs; existing steps default enabled=true" — met: V86 content + clean embedded-Postgres application + live default-true behavior confirmed via curl.
- "Tests: backend run/analyze skip a disabled step; duplicate produces an equivalent step; frontend toggle + duplicate" — met: 3073/3073 backend, 1846/1846 frontend, fresh runs.
- "Backward compatible: enabled defaults true; additive on the wire" — met: `Option[Boolean] = None` on both request types, always-serialized-but-additive on responses.

### Verdict: CONFIRM

### Non-blocking notes

- Consider a follow-up ticket to add in-flight/debounce protection to all three "Duplicate" buttons (dashboard, panel, pipeline step) — a rapid double-click on any of them currently creates two persisted resources. Not scoped to this ticket; not a regression.
- The executor's self-flagged `PatchSetUndoInverse` gap (undo/redo-recreate doesn't propagate `enabled`) remains a reasonable spinoff candidate, correctly left out of this change's scope.
- Hit the known shared-Playwright-session hazard hard this run (concurrent HEL-688 worktree); worked around via direct API calls for setup/teardown and tightly-timed browser interactions for the decisive checks. No corruption of the other session observed or caused on my end (verified my own port's servers were the only ones I started/stopped).
