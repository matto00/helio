## Evaluation Report — Cycle 2 (evaluation-2.md)

### Resumability note

Resumed from cycle 1 (evaluation-1.md, FAIL). Re-read the diff (`git diff bae7a1e0..b445b769`)
and the updated `files-modified.md` cycle-2 addendum only — ticket/proposal/design/tasks/spec
deltas not re-read (stable, per instructions).

### Phase 1: Spec Review — PASS

`git diff bae7a1e0..b445b769 --name-only` confirms backend untouched this cycle (only
`frontend/src/features/pipelines/ui/StepCard.tsx`, `StepCard.test.tsx`,
`PipelineDetailPage.test.tsx`, plus the report/handoff/workflow-state artifacts) — consistent
with the orchestrator's framing that this is a targeted frontend-only fix for cycle 1's single
Change Request.

- AC2 ("...re-enable cleanly") — now met. Live re-repro (below) shows 0/2 reproductions of the
  cycle-1 race, down from 2/2. The `pipeline-step-lifecycle` spec delta's "A toggle SHALL refresh
  analysis (and open previews)" requirement is now honored without the spurious 422.
- All other Phase 1 items from evaluation-1.md remain satisfied (unchanged this cycle: AC1/3/4/5,
  tasks, no scope creep, no regressions, schemas, planning artifacts).
- `files-modified.md`'s new "Cycle 2" section accurately documents root cause, probe (red before
  fix, green after), fix, and fresh verification — matches the actual diff.

### Phase 2: Code Review — PASS

Gates re-run fresh in `WORKTREE_PATH` (backend untouched this cycle, per the orchestrator's
instruction and confirmed via `git diff --name-only`, so `sbt test` was not re-run):
- `npm run lint` — **PASS** (zero warnings)
- `npm run format:check` — **PASS**
- `npm test` — **PASS** (1846 frontend + 186 helio-mcp, up from 1843 frontend last cycle — the 3
  new regression tests)
- `npm --prefix frontend run build` — **PASS** (production build succeeds; pre-existing >500kB
  chunk-size warning unrelated to this diff)

Fix review (`frontend/src/features/pipelines/ui/StepCard.tsx`, diff `bae7a1e0..b445b769`):
traced the logic against every relevant transition —
- **Ordinary activation** (expand/open-preview on an already-enabled step, `wasEnabled` was
  already `true` on the prior effect run): falls through unchanged to the original
  "`lastFetchedFingerprint.current === null` → fetch immediately" branch. **No regression.**
- **Disable**: `!step.enabled` returns immediately without touching `lastFetchedFingerprint`
  (deliberately, so a later re-enable isn't treated as a config-unchanged no-op) — preview
  rendering is still gated on `step.enabled` elsewhere in the JSX (unchanged from cycle 1), so the
  card still mutes and the preview control still hides. **No regression.**
- **Re-enable** (`wasEnabled === false` on this run): unconditionally takes the 500ms-debounced
  branch, **regardless of fingerprint equality** — correctly closes the single-step-pipeline edge
  case (config/`enabledBits` round-tripping to the same string across a disable→enable cycle)
  that a naive fingerprint-only check would have missed. This is exactly the fix CR1 asked for.
- **Mount-already-disabled-with-persisted-previewOpen** edge case (never fetched once,
  `lastFetchedFingerprint.current` still its initial `null`): correctly still routed through the
  debounced branch on first enable, per the dedicated `wasEnabledRef` tracking — a case a simpler
  "was fingerprint null" fix would have mishandled.
- **Verified the fix is load-bearing, not incidental**: reverted `StepCard.tsx` to its pre-fix
  (`bae7a1e0`) content while keeping the cycle-2 tests, and ran the 3 new tests — all 3 failed
  deterministically at the exact assertion documented in `files-modified.md`'s probe output
  (`toHaveBeenCalledTimes` mismatches / an unexpected immediate fetch), confirming they are
  genuine regression tests for this defect, not tautologies. Restored the fix afterward; full
  suite re-confirmed green (1846/1846).
- No other code-quality issues in the diff — comments are precise and point at the actual defect
  (`evaluation-1.md CR1`), no new inline FQNs, no dead code, `wasEnabledRef`'s purpose is
  documented inline. DRY/readable/modular/type-safe.

### Phase 3: UI Review — PASS

Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` on this run's
ports (5844/8751); reported healthy.

Live re-repro of the exact cycle-1 scenario, using a fresh single-step "HEL-412 cycle2 eval test"
pipeline (`Select fields`, deliberately single-step to hit the fingerprint-round-trip edge case
the fix specifically targets): expanded the step, left its persisted preview tray open, disabled
it (card muted, preview hid correctly — unchanged from cycle 1), then **immediately** re-enabled
it (mirroring the exact quick-click timing that reproduced the race 2/2 in cycle 1). Repeated
twice.

- **Result: 0/2 reproductions.** Both times: no `Request failed with status code 422` banner, the
  card returned to its normal (enabled) rendering, and the preview refreshed cleanly. Network log
  confirmed the correct ordering both times: `PATCH /api/pipeline-steps/:id` (the enable) → 200,
  followed by `GET /api/pipelines/:id/steps/:id/preview` → **200** (not 422) once the debounce
  elapsed. No new console errors beyond the one pre-existing, unrelated `GET .../schedule → 404`
  (no-schedule-set, present on every pipeline-detail-page load regardless of this diff).
- Disable behavior re-confirmed unaffected: card mutes, preview control disappears, config editor
  (field checkboxes) stays visible/editable — identical to cycle 1's PASS.

**Environmental note (not a code defect, does not affect this verdict):** partway through this
cycle's live check, the shared Playwright browser session was repeatedly hijacked mid-task by a
concurrent agent run (navigations landed on `localhost:6120` — a different worktree/ticket's dev
server, observed mid-session on a "HEL-688 eval spotcheck" dashboard; my own session was also
logged out at least twice, consistent with the session cookie being host-scoped rather than
port-scoped and getting overwritten by the other session's own login). This matches the
previously-documented hazard (`project_concertino_parallel_playwright_hazard.md`). All decisive
live evidence above (the 0/2 re-repro, network-log confirmation, disable-behavior recheck) was
captured **before** the collisions began. Once the collisions started, further UI interaction was
abandoned rather than risk-corrupting a concurrent evaluator's own in-progress run — the remaining
checks in the orchestrator's ask ((b) ordinary-activation-path non-regression, ability to verify
the fix is load-bearing) were instead satisfied via code-diff tracing + the full green test suite
+ the red/green revert experiment documented in Phase 2, which together are conclusive on their
own.
- **Cleanup**: could not delete the "HEL-412 cycle2 eval test" pipeline fixture (id
  `6820d8b0-6824-4c59-a82f-0b00df0b532e`) via the UI due to the browser-session collision above —
  flagging plainly here rather than silently leaving it unmentioned, per the same standard applied
  to the environment note. This run's own dev servers (ports 5844/8751) were stopped cleanly by
  PID (confirmed via `lsof` before/after) — unaffected by the browser-tab collision, which was
  purely a shared-Playwright-MCP-session issue, not a server/port conflict.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- Delete the leftover "HEL-412 cycle2 eval test" pipeline (id
  `6820d8b0-6824-4c59-a82f-0b00df0b532e`) on `localhost:8751`'s shared dev DB next time a browser
  session is available — cosmetic only (matches the pattern of several other uncleaned `eval`-named
  pipelines already visible in that same pipeline list from prior sessions).
- The executor's self-flagged `PatchSetUndoInverse` spinoff (not propagating `enabled` on
  undo/redo-recreate) remains correctly out of scope; still worth filing as a follow-up ticket.
