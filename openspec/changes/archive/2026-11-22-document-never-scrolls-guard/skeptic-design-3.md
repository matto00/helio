## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD c405b68179c46b59e3f7f06940e3acc5d2031999. The branch equals main, and the only change is the untracked planning dir `openspec/changes/document-never-scrolls-guard/`.

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/document-never-scrolls-guard/HEL-1585`.
- **Round-2 CR1 (D4a double-count) is resolved.**
  - (a) The rationale is corrected. D4a now says the counter wraps `page.request.fetch` (`e2e/support/apiRequestCounter.ts:89-99`).
  - (b) The assertion is now `count429 === 0` and `maxWindow <= 90`, with `seedRequests` recorded only. This matches the hel1632 precedent.
  - (c) The seed must go through `page.request`, and the `request` fixture is explicitly forbidden.
  - (d) The PAT-bucket fallback is real. `backend/src/main/scala/com/helio/api/http/RateLimitDirective.scala:23-32,76-80` keys a session cookie first and a resolvable PAT as `pat:<tokenId>`. A separate cookie-less `APIRequestContext` holding a PAT therefore lands in its own bucket. The design still makes the executor confirm this before relying on it, which is correct.
  - Tasks 1.1 and 4.1 are updated to match.
- **Round-2 notes are folded in.**
  - There is no extra `page.goto` after login. `uiLogin` (`e2e/support/isolateLivePage.ts:31-40`) waits for `/home`, and `registerAndLogin` with default options does nothing else (`e2e/support/auth.ts:82-96`). The tour starting from where login lands is therefore accurate.
  - The wheel check now uses `document.elementFromPoint` at the hover coordinates.
- **Route list (D3) re-checked against `frontend/src/app/AppRoutes.tsx`.**
  - `ProtectedRoute` wraps `/connect/mcp` plus the `AppShell` routes from `/home` through `/combined-proposals/review`. D3's list covers all 16.
  - The public `/dashboards/:dashboardId/panels`, `/connectors/complete` and `/auth/callback` sit outside it and are correctly excluded.
  - The ">= 15 paths found" floor makes the regex fail loudly if the file is restructured.
- **Shell facts.**
  - `.app-shell` is a grid with `grid-template-rows: auto minmax(0, 1fr)` (`App.css:6-10`).
  - `.app-shell--tabs` exists with three rows (`App.css:302-312`), so recording tab-bar presence per route is meaningful.
  - Mutation D5(a) (`height` to `min-height`) would let the 1fr row grow to its content, so the long pipeline would push the document. It is a valid red mutation.
- **Helpers exist.** `evidencePath` is in `e2e/support/evidencePath.ts:11`. The scripts `check:e2e-types`, `check:e2e-evidence-paths` and `check:e2e-user-cleanup` exist in the root `package.json`. No `e2e/hel1585*` file exists yet, so the red-first ordering is still possible.
- **AC coverage.**
  - AC1 is covered by D1 and task 1.2.
  - AC2 is covered by D3, D4, D4a, D4b and D7, plus task 4.1. The CI cost is measured and stated.
  - AC3 is covered by the D4 wheel check.
  - AC4 is covered by D6 and tasks 3.1/3.2.
  - There is no scope drift and no Playwright config edit, so HEL-1816 is respected. No API or schema contract change is needed.

### Verdict: CONFIRM

### Non-blocking notes
- D4a remedy (1) is awkwardly worded ("split ... is NOT allowed, so instead trim browser traffic"). The meaning is clear, but the executor should not read it as permission to split.
- `registerAndLogin`'s doc comment warns about API seeding racing the live `/home` (HEL-1289/1300). D4 seeds while `/home` is live and allows one counted reload. If the context lists stay stale or flaky after seeding, the executor should prefer that one reload over ad-hoc waits.
- D4b's "no visible error state" check should use a concrete selector or text list, so it cannot match nothing silently.
