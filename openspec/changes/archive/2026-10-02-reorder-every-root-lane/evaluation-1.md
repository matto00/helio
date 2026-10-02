## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 43cd8da5564c645cac77f5129ea01aba3e18fbc8 against live base e184391c.

### Phase 1: Spec Review — PASS
- Every AC addressed: wiring for every root's trunk lane (`useLaneReorder`, `LaneColumn`, `RootColumn`), `NOOP_MOVE` deleted, branch lanes render no controls, accessible names, focus follows, e2e red-on-main/green-after, payload construction untouched (contract-proof + backend test).
- CR2 AC ("add real coverage") was resolved via design Decision 6(ii) (evidenced unreachability + rewritten note). Escalation to the human is PENDING per orchestrator; not judged here beyond evidence soundness.
- Evidence soundness: `stepTree.test.ts` asserts exhaustively over every (from,to) pair of a two-root graph (with a branch lane) that `reorderLane` never empties/orphans a root. The remaining skew theory (`stepsRef` set in render vs graph ref set in a passive effect) is correct for React 18 discrete events (passive effects flush before the next discrete event). The rewritten note in `usePipelineDetailPage.ts` is honest: it says "defense-in-depth, no live path", names the evidence, and explicitly disclaims a hand-built-`newOrder` test as proof of reachability. No fabricated test. PASS on this point.
- Tasks ticked and match diff; no scope creep; dev-db-ids.md present.

### Phase 2: Code Review — PASS
Gates re-run by me in WORKTREE_PATH:
- `npm run lint` clean; `npm run typecheck` clean; `npm run format:check` clean.
- `npm test`: 409 suites / 4267 tests pass. `npm --prefix frontend run build` OK.
- `cd backend && sbt testFull`: 5233 succeeded, 0 failed; the new "HEL-1007: a permutation that reorders ONLY the non-first root's trunk..." test ran. The backend test is meaningful (permutes only root 2, asserts root 1 chain/head and ownership/heads of root 2 are right).
- Code: lane-scoped handlers keyed by step id with stable identity, drag state scoped to lane (cross-lane drop ignored), pendingFocus cleared on settle, `NOOP` for drag callbacks is a stable reference. No dead code, no new TODOs.

### Phase 3: UI Review — PASS
Dev servers confirmed serving this worktree (readlink /proc/<pid>/cwd: frontend 1193902 -> .../HEL-1007/frontend, backend 1193682 -> .../HEL-1007/backend).
- e2e: `DEV_PORT=6439 npx playwright test hel1007 + hel908-step-card-split + hel908-trunk-reorder-order` : 3 passed.
- Red on main-equivalent: I checked out e184391c in a throwaway detached worktree, ran its Vite on port 6477 against the same backend, and ran the same spec: FAILS at `expect(sortUp).toBeEnabled()` (button `disabled`, aria-label "Move step up"). Throwaway worktree and server removed.
- Live, DARK theme: root 1 Move up via keyboard (focus + Enter/Space) reorders; focus follows the moved step (same data-step-id, same direction; at index 0 focus correctly falls to the Move down button); root 0 untouched; accessible names "Move step up/down in <source name>"; edges disabled by position. Real HTML5 drag (dragstart/dragover/drop with DataTransfer; drop indicator rendered) in root 1 moved the last step to index 1; persisted after reload.
- Live, LIGHT theme (localStorage helio-theme=light): same keyboard operation and focus-follows verified; screenshot shows visible focus ring, controls legible. Branch lane (created via the Branch affordance): its card renders no drag handle and no Move buttons.
- 768px viewport: no horizontal overflow (scrollWidth == clientWidth). Only console error: pre-existing 404 on `/api/pipelines/:id/schedule` (no schedule set), unrelated.
- Screenshots: /home/matt/Development/helio/.playwright-mcp/eval-dark.png, eval-light.png (not load-bearing; not persisted).
- Dev-DB rows created by me (all deleted by exact id, 204 each): user hel1007-eval-1790966329341@example.com (user row remains; API cannot delete users), pipeline a589c0f3-541c-4fbd-a079-7470865a7aa0, sources 63c778a3-d8ff-427b-b6ee-13c9fbc1edc7, 0e8aa58b-7caf-42e5-bcb3-60d6ba4e5706. Re-run of the e2e specs created its own pipeline 0cac5e79-4e3d-4632-8f72-64134302ee98 (user hel1007-1790966268800-6211@example.com), deleted by the spec's finally; red run on main created another spec-owned pipeline likewise cleaned by the spec's finally (ids not echoed on failure).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- The CR2-coverage decision remains with the human (pending); if they require a hand-built-state test, label it as a defensive-branch unit test per design Decision 6.
- Test users created by e2e/eval runs accumulate in the dev DB (pre-existing practice).
