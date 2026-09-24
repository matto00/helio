## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `13824cd43a0ae81b48d709387a83d10fac2ab07e` (1 commit ahead of
`origin/main` @ `c9136b96d1c8026d59e27c238c1ebb891efded62`, working tree clean).

### Phase 1: Spec Review — PASS

- **AC1** (specific-rule copy per `CostReason.code`, incl. deny-by-default codes):
  `frontend/src/features/pipelines/services/denyReasonCopy.ts` covers all 10 codes
  with distinct, honest copy (4 "unclassified"/unavailable codes get non-alarming
  copy per design.md D6). Verified via `RowWriteResponseDenyReasonCoverageSpec.scala`
  (backend wire-fidelity) and `denyReasonCopy.test.ts` (frontend content).
- **AC2** (manual "Run to update" action instead of silent no-op): implemented on
  both the write-toast (D3) and the pipeline detail page (D5); confirmed live in
  the running app (see Phase 3).
- **AC3** (goes through existing `POST /api/pipelines/:id/run`, respects existing
  guards, distinct 429 message): `runToUpdate.ts` calls the existing `runPipeline`
  service function unmodified; branches HTTP 429 from any other failure
  (`guardRejectionMessage`), never routing 429 through the deny-copy mapping.
  Confirmed live: click submitted a real `POST .../run` (backend accepted it,
  200, then the async run itself failed on an unrelated dev-environment
  constraint — daily AI-call quota exhausted — surfaced via the pre-existing
  run-failure path, not a HEL-1096 code path).
- **AC4** (successful run refreshes bound panels via existing SSE, no new
  mechanism): `runToUpdate.ts`'s own doc confirms no new refresh call is added;
  independently ran `e2e/hel1096-run-to-update-affordance.spec.ts` myself
  (`npx playwright test`, 2/2 passed) — this test seeds a pipeline with 21
  no-op `assert` steps (deliberately AI-quota-independent), triggers a denial
  (`steps-above-bound`), clicks "Run to update", and asserts the bound table
  panel's row count updates via the existing SSE fan-out with no manual
  reload — a real, dependency-free proof of this AC.
- **AC5** (a11y: computed ARIA, both themes): verified live against the running
  app — see Phase 3.
- **AC6** (Show the red — mutation-provable): independently reproduced myself —
  see Phase 2.
- **Scope boundary** (exactly `appendRows`/`appendFormRow`/`replaceRows`/`patchRow`
  in scope, `deleteRow` untouched): confirmed by reading
  `DataSourceService.scala` directly — `deleteRow` (line ~919) still calls
  `triggerAutoRunFireAndForget` (old signature, `Unit`-returning), still returns
  `204` via `ServiceResponse.runNoContent` (`DataSourceRoutes.scala:200`), no
  `deniedPipelines` field anywhere in its response type. A dedicated backend test
  (`DataSourceServiceDeniedPipelinesSpec` "deleteRow" block) proves this by
  construction (the return type has no field to assert on).
- **Two-ACL-check gate (D1)**: confirmed a writer with zero grant on a denied
  pipeline gets the entry OMITTED entirely — re-derived from
  `AutoRunTriggerService.handleDenied`'s `case None => None` branch (no grant
  found) and independently exercised by
  `DataSourceServiceDeniedPipelinesSpec`'s "omits the pipeline entirely..." test
  (real embedded-Postgres integration test, cross-owner multi-root fixture) and
  `AutoRunTriggerServiceSpec`'s equivalent lower-level test. Both pass.
- **Fixture changes** (7 files, claimed purely additive): diffed every changed
  fixture file myself. All changes are exactly `deniedPipelines: []`,
  `canRun: true`, or `costVerdict: null` added to existing fixtures/mocks to
  satisfy the now-required new fields on existing wire types — no fixture DATA
  was altered to change existing test outcomes. This is the legitimate
  "type gained a field" pattern, not the fixture-edited-to-pass-tests defect
  pattern.
- Task items 1.1–3.9 all genuinely implemented as described; 3.10 correctly
  left partial (`ci-complete` is a Delivery-phase gate, not yet applicable —
  `openspec validate` and schema-drift both independently re-run by me, both
  pass).
- No scope creep found — file list matches the ticket's four call sites, the
  copy module, the toast/click-handler wiring, the pipeline-page denial block,
  and proportionate test coverage.
- No regressions: full `sbt test` (4819/4819) and full `npm test` (3696/3696)
  pass; the ALLOWED-pipeline debounce-upsert path is untouched code, and
  existing `AutoRunTriggerServiceSpec`/`DatasetWriteAutoRun*Spec` tests
  (updated only for the new `user` parameter, no behavior change) still pass.
- API contracts: `schemas/sources/row-write-response.schema.json`,
  `row-response.schema.json`, new `denied-pipeline-response.schema.json`, and
  `schemas/pipelines/pipeline-analyze-response.schema.json` all updated in the
  same change; schema-drift check passes.
- `RowResponse` (patchRow, `schemas/sources/row-response.schema.json`) vs
  `RowWriteResponse` (append/replace,
  `schemas/sources/row-write-response.schema.json`): confirmed `deniedPipelines`
  was added to each of these two DISTINCT wire types correctly, not merged.
- `workflow-state.md` CONSTRAINTS: C1/C2/C8/C9/C10 are process constraints, not
  independently checkable from the diff. C3 (no migration) — confirmed, Flyway
  log during my `sbt test` run tops out at V110, no new migration added. C4/C5/
  C6/C7/C12 — independently verified, see Phase 2/3. C11 — verified live via
  Linear: HEL-1171 exists, `Follow-up` label, `origin_ticket` HEL-1096 embedded
  in its description, project `28f119e2-5738-46b1-a53b-42f73e06b053` (v0.8)
  matches.

### Phase 2: Code Review — PASS

Ran every gate myself, fresh, in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set —
`default` speed):

- `npm run lint` — clean (zero warnings)
- `npm run format:check` — clean
- `npm test` — 339 suites / 3696 tests passed
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk
  warning, unrelated to this change)
- `npm run typecheck` — clean
- `cd backend && sbt test` — **4819/4819 passed, 0 failed** (fresh run, 5m24s,
  independently reproduces the executor's own claimed number)
- `npm run check:schemas` — schemas in sync with `JsonProtocols`
- `npm run check:scala-quality` — clean (184 soft file-size warnings, all
  pre-existing except the new `DataSourceServiceDeniedPipelinesSpec.scala` at
  258 lines vs. the ~250-line soft budget — informational only per
  CONTRIBUTING.md, non-blocking)
- `npm run check:openspec` — clean
- `npm run check:no-credential-leak` — clean
- `openspec validate run-to-update-affordance --type change` — valid

**Show the red (C5), independently reproduced**: I manually deleted the
`ai-step` entry from `DENY_REASON_COPY` in `denyReasonCopy.ts`, re-ran
`denyReasonCopy.test.ts` — 2 tests failed exactly as the executor's comment
claims (`covers 'ai-step'...`, `names AI specifically for ai-step...`),
restored the file, re-ran — 19/19 green, `git diff` confirmed clean. This
constraint is now genuinely mutation-proven, not merely asserted.

**Design/code quality**:
- **Canonical compliance**: no inline FQNs introduced (scala-quality check
  clean); new CSS reuses the exact existing `--app-warning`/`color-mix(...)`
  token pattern already used by the pre-existing truncation/error banners
  (`PipelineDetailPage.css:706` for comparison) — no hardcoded colors/spacing.
- **DRY**: one shared `denyReasonCopy.ts` module imported by both the toast
  and the pipeline-page block, as design.md specifies; one shared
  `useRunToUpdate`/`runToUpdate.ts` click-handler pair for both surfaces.
- **Type safety**: `EvaluatedPipeline` is a real sealed ADT
  (`Allowed`/`Denied`), not a loosely-typed tuple; `DeniedPipelineResponse`
  reuses `CostReasonResponse`'s existing format via trait mixin rather than
  duplicating a JSON formatter.
- **Security**: the `visible` ACL gate is the load-bearing cross-tenant fix
  from skeptic-design-1.md — independently re-verified (see Phase 1) with a
  real cross-owner, multi-root-pipeline integration test, not just a unit
  mock.
- **Error handling**: `triggerAutoRunAwaited`'s failure path still degrades to
  `Vector.empty` (never fails the write) — same posture as the pre-existing
  fire-and-forget `.recover`.
- **Tests meaningful**: `DataSourceServiceDeniedPipelinesSpec` and
  `AutoRunTriggerServiceSpec`'s new block both use a REAL embedded Postgres
  and REAL grant rows — these would catch a real regression in the ACL logic,
  not a rubber-stamped mock.
- **No dead code / no over-engineering**: reasonable scope; `EvaluatedPipeline`
  as a new case class over reusing `CostVerdict` is justified in
  design.md's Planner Notes (genuinely different per-entry shape).
- **Behavior-preserving**: the ALLOWED branch's debounce-upsert path is
  unchanged; `deleteRow` is provably unchanged (see Phase 1).

**C12 (latency measurement)**: the commit message
(`git log -1`) states real, specific numbers — p50/p95 before→after for all
three call sites design.md D2 names (e.g. `appendFormRow p50 11ms->33ms / p95
15ms->41ms`), all comfortably under the 200ms flag threshold. Not placeholder
text.

Non-blocking suggestions:
1. `DataSourceServiceDeniedPipelinesSpec.scala` (258 lines) is marginally over
   the CONTRIBUTING.md ~250-line soft budget — informational only, no action
   required.

### Phase 3: UI Review — PASS

Servers verified via canonical scripts (`start-servers.sh` reused
already-healthy servers, `assert-phase.sh servers` → `PASS`); confirmed via
`readlink /proc/<pid>/cwd` that both the frontend (port 6528) and backend
(port 9435) processes are bound to `WORKTREE_PATH`, not a stale process from
another run.

Built a live scenario from scratch in the running app: a dataset source, a
pipeline reading it with a real `analyzewithai` step (deterministic `ai-step`
denial), a dashboard with a bound form panel.

- **Happy path**: submitting the form panel with a denied downstream pipeline
  showed, live, a warning toast: *"HEL-1096 eval denial pipeline: This
  pipeline calls AI, so it wasn't updated automatically."* with a "Run to
  update" action — exactly the single-denial + `canRun` case. Screenshot
  persisted.
- **C6 (never auto-dismiss)**: confirmed the toast was still present in the
  DOM after 8+ seconds (past the shared component's default duration).
- **C4 (computed ARIA)**: read the live DOM directly —
  `<p id="toast-message-1" class="toast__message" aria-hidden="true">` (the
  visible card) plus the shared component's existing `role="status"
  aria-live="polite"` live region carrying the identical text (pre-existing
  `Toast.tsx` infrastructure, confirmed unmodified by this diff — `git diff`
  shows no changes to `Toast.tsx`/`toastsSlice.ts`); the action button carries
  `aria-describedby="toast-message-1"`.
- **Pipeline-page denial block**: visiting the pipeline detail page directly
  showed the same reason + gated "Run to update" button, `role="status"
  aria-live="polite"`, `aria-describedby` correctly linking the button to the
  reason text — read directly from the live DOM, not inferred.
- **Both themes**: captured the pipeline-page denial block in dark (native)
  and light (toggled `data-theme`) — both render with correct
  `--app-warning`/`--app-warning-surface` tokens, legible contrast, no
  layout break. Screenshots persisted.
- **Clicking "Run to update"**: dismissed the source toast (per
  `useRunToUpdate.ts`'s synchronous-dismiss behavior) and submitted a real
  `POST /api/pipelines/:id/run` (accepted by the backend, not rate-limited);
  the run itself then failed for an unrelated, pre-existing reason (this dev
  environment's daily AI-call quota was already exhausted from other testing)
  — surfaced via the existing run-failure reporting path, not a defect in
  this ticket's code.
- **429 guard-rejection / SSE refresh (AC3/AC4)**: rather than trying to force
  a live 429 or a live AI-quota-independent success in the shared dev
  environment, I ran the diff's own `e2e/hel1096-run-to-update-affordance.spec.ts`
  myself (`DEV_PORT=6528 BACKEND_PORT=9435 npx playwright test
  e2e/hel1096-run-to-update-affordance.spec.ts`) — **2/2 passed**, fresh, on my
  own machine. This test deliberately avoids the AI-quota dependency (21 no-op
  `assert` steps triggering `steps-above-bound` instead), does a REAL manual
  run, and asserts the bound table panel's row count updates via the existing
  SSE fan-out with no reload — directly proving AC4. The second test proves
  the 429 branch shows a distinct message ("too many runs"/"42s") that never
  contains the gate-denial copy ("too many steps").
- **No console errors attributable to this ticket**: 4 console errors observed
  during my session — one from my OWN manual unauthenticated `fetch()` probe
  (403, not app-triggered), two pre-existing 404s on `.../schedule` (no
  schedule configured yet — existing, unrelated feature), and one legitimate
  422 from the backend correctly rejecting a real run due to AI-quota
  exhaustion (surfaced via the existing generic-failure path, working as
  designed).
- **Breakpoints**: measured `getBoundingClientRect()`/`scrollWidth` on the
  pipeline-page denial block at 1440/1100/768/375px — no horizontal overflow
  at any width; the block's `flex-wrap: wrap` reflows the action under the
  text at narrow widths. Screenshot captured at 375px confirms no visual
  breakage.
- **Interactive elements**: "Run to update" is a real `<button type="button">`
  in both surfaces (not a div-with-onClick), keyboard-focusable, with a
  visible `:focus-visible` outline.

Screenshot/measurement evidence persisted at time of capture via
`persist-evidence.sh`:
- `.concertino/runs/HEL-1096/evidence/hel1096-pipeline-denial-light.png` (dark theme)
- `.concertino/runs/HEL-1096/evidence/hel1096-pipeline-denial-light2.png` (light theme)
- `.concertino/runs/HEL-1096/evidence/hel1096-toast-live.png` (live denial toast)
- `.concertino/runs/HEL-1096/evidence/hel1096-denial-mobile-375.png` (375px breakpoint)

No mtime-ordering claims were relied on anywhere in this report — every claim
above is either a live DOM read, a fresh gate re-run, or a screenshot cited
for its content, not its position/timestamp.

### Overall: PASS

### Non-blocking Suggestions

- `DataSourceServiceDeniedPipelinesSpec.scala` is 258 lines, marginally over
  CONTRIBUTING.md's ~250-line soft budget (informational-only per the script
  and CONTRIBUTING.md itself — no action required).
- The N>1-denied-pipelines toast message (design.md D3, a deliberate,
  owner-reasoned choice across 3 skeptic design rounds) lists every denied
  pipeline's name and specific reason but does not literally say "resolve
  each on its own pipeline page" — a user has to already know pipeline pages
  exist. Since every pipeline's name IS named in the toast and the SAME
  denial block independently renders on each pipeline's own detail page
  whenever visited, I judge this a defensible v1 gap rather than a stranding
  UX defect — but a follow-up adding one clause (e.g. "— view on each
  pipeline's page to run it") would close the gap cheaply if it comes up in
  practice.
