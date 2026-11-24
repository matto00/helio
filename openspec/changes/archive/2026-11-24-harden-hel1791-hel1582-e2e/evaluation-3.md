## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `136cef6a08510b990a16d885516a06b42f566122`, which is the diff since `cafed670c`:
- `7202c4d80`: red first
- `da3992796`: the change
- `136cef6a0`: evidence

Scope: the editor fold-in (the last AC in ticket.md, Decision 10, tasks section 6, C20, and the skeptic-design-3 notes).

### Phase 1: Spec Review — PASS

- **New AC is met.** Each editor theme test registers its own principal (`newActor(browser, "editor-${theme}")`). The board owner grants it `editor` on the beforeAll board, and its REQUEST-COUNT is logged under `editor-light` / `editor-dark`.
  - My fresh run: editor-light 41, editor-dark 41.
  - Committed fresh evidence:
    - `t6-1791-20x.txt`: 20/20 runs, editor max 41/41.
    - `t6-1791-throttle4x.txt`: 5/5 runs, 51 STRESS-ACTIVE lines, editor max 41/41.
  - Both are at most 60 (C20), so no fallback is needed. This matches the measured projection in skeptic-design-3.md.
- **Decision 10 shape:**
  - The beforeAll no longer creates a shared `editor`, and `seedBoard` now grants only `measurer`.
  - Each grant is issued through `boardOwner.context.request`, so it is counted against the board owner, which makes no page loads.
  - The board owner's REQUEST-COUNT is logged in afterAll before `deleteBoard`, i.e. after its last grant (skeptic note 1). It reads 19 in my run, and its max is 19 in both the 20x and the 4x evidence, at most 60.
- **Red first (C12):** `t6-red-burn-shared-editor.txt` and its generator are in `7202c4d80`, which comes before the spec change in `da3992796`.
  - It runs on the pre-fold-in spec.
  - The STRESS-ACTIVE line shows 78 requests burned and Retry-After 27 s.
  - The dark editor test then fails at a named assertion: `toHaveCount(7)` in `openStack` (spec :208), "Received: 0", with editor count429=2.
- **Skeptic notes:**
  - Note 1 is honoured: the board owner's count is logged in afterAll as a `console.log`.
  - Note 2 is honoured: the control burns the light editor before its context closes and proves the burn was still live afterwards.
  - Note 3 is honoured: the design.md Non-Goals and Risks entries are marked superseded/resolved.
  - Note 4 is honoured: the highest editor count is recorded per principal.
- root-cause.md, proposal.md, tasks.md 6.x, files-modified.md and ticket.md are consistent with the code and the evidence.
- C15-C20 are honoured.
- Decision 11 (do not address the hel1582 `:527` timeout) is respected. The hel1582 file is untouched by the fold-in, and `t6-1582-1run.txt` shows 8 passed.

### Phase 2: Code Review — PASS

Gates I ran fresh in WORKTREE_PATH. All passed (exit 0):
- `npm run lint`
- `npm run format:check`
- `check:e2e-types`
- `check:e2e-user-cleanup`
- `check:e2e-evidence-paths`

Fresh full hel1791 file (`--workers=2`, `nice -n 19`, lane DB): 10 passed in 45.1 s. Output: `.concertino/scratch/HEL-1830/eval3-1791-run1.txt` (main checkout).

| Principal | REQUEST-COUNT max-60s |
| --- | --- |
| owner-light/dark-390 | 29 |
| owner-light/dark-768 | 29 |
| owner-light/dark-1100 | 30 |
| editor-light | 41 |
| editor-dark | 41 |
| measurer | 38 |
| owner-live-regions | 13 |
| board-owner | 19 |

There were no 429s and no `HEL-1830 cleanup:` warnings. Afterwards the lane DB holds 0 `HEL1791%` dashboards, sources or pipelines, and 0 `hel1791-%` users.

- **No assertion was loosened.** The editor test still calls `checkCounterCard(page, "editor", ...)` over every width. The function and its assertions are byte-identical to cycle 1, and the editor-only caption check runs.
- **Cleanup and grants are correct.**
  - Each editor context is closed in the test's outer `finally`, after its count is logged. The page is closed in an inner `finally`.
  - Each grant is removed when afterAll deletes the board (board deleted, grants cascade).
  - The throwaway users are removed by the global teardown ("deleted 11 recorded throwaway user(s)").
- **The isolation control is real.** `t6-isolation-control-editor.txt` and its generator are committed.
  - After its own test, the light editor's remaining 79 requests are burned (Retry-After 52 s) while its context is kept open.
  - The dark editor test, as its own principal (41 charged, 0 429s), passes.
  - Afterwards `light editor GET /api/auth/me -> 429` proves the burn was live for the whole dark test.
- **The committed control is clean (re: the reported stale-Vite CSS).**
  - By its throwaway-user timestamps, the committed control ran after the mutation run (1795508685… vs 1795508570…).
  - In it, both editor tests pass the caption-visible assertion, which the caption mutation reliably reds. That proves the control was served unmutated CSS.
  - The worktree has no app-file modification now.
- **The caption mutation is real.** `t6-mutation-editor-caption.txt` appends `.mobile-panel-stack__item--form .counter-control__caption { display: none; }` to `MobilePanelStack.css`. Both editor tests red at the named assertion `editor light|dark 390px caption visible` (Received: hidden).
- Code quality: a small, focused change that reuses `newActor`, `postJson` and `logRequestCount`. No dead code; the shared `editor` variable is removed.

### Phase 3: UI Review — N/A

No trigger path changed. The e2e runs above are the behavioral verification.

### Overall: PASS

### Non-blocking Suggestions
- In `t6-mutation-editor-caption.txt`, the `git status --short` block (lines 3-4) sits before the run output and carries no "after revert" caption. C17 is satisfied in substance: the listing shows no app file, the worktree is clean now, and the control run after the mutation proves the CSS was reverted. A future mutation `.txt` should label the status block as taken after the revert, as `t1-mutation-owner-geometry.txt` does.
