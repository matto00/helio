## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 58869e27544b85ebbf0ccebdccf48f839cd6e5ed. Base resolved live via resolve-review-base.sh: a2ae646e.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/duplicate-double-click-guard/HEL-706`.
- **Scope:** `git diff a2ae646e...HEAD --stat` lists 30 files. The code files are the three named surfaces (DashboardList, PanelCard, and the pipeline step via usePipelineDetailPage/PipelineDetailPage/PipelineRiverView/RootColumn/LaneColumn/StepCard), the new `hooks/useInFlightGuard.ts`, the step-card CSS rule, the tests, and the token-audit re-pin. Everything else is openspec change artifacts. There is no backend change and nothing unrelated. RootColumn is only a pass-through for the prop.
- **The guard is synchronous:** `useInFlightGuard.ts` checks `pendingRef.current.has(key)` and adds the key before calling `fn`. The pending state is cleared in `.finally`, so it clears on both success and failure. All three surfaces call this one hook, which is the single shared pattern the ticket asks for.
- **Gates (fresh run):** `npx jest useInFlightGuard DashboardList.test PanelCard.test PipelineDetailPage.test StepCard.test PipelineRiverView.test tokenAuditSweep` gave 7 suites and 294/294 passed.
- **Mutation tests** (run in scratch copies with node_modules symlinked; the worktree was never edited; copies deleted afterwards):
  - M1, ref check `if (pendingRef.current.has(key)) return;` removed: 1 failure, `useInFlightGuard › invokes fn once when two synchronous guardedRun calls share a key in the same tick`. **No page-level test went red.** This includes `PipelineDetailPage › HEL-706: two synchronous activations ... exactly once`.
  - M2, ref check removed and all three `disabled` wirings removed: 4 failures. They were the Dashboard and Panel "reopening the menu ... dispatches only once" tests and both pipeline-step HEL-706 tests (the double-activation one and the re-enable one).
  - Conclusion: the ref guard's same-tick re-entry protection is proven only by the direct hook test. The page tests prove that the surfaces are wired to the guard and disable while pending. Together that covers AC1, AC3 and AC4, because every surface routes through the one tested hook.
- **Token-audit re-pin (item 3):** for each re-pinned pair (883→888, 977→982, 1007→1012, 1216→1221, 1447→1452), line N of the base PipelineDetailPage.css equals line N+5 of HEAD, byte for byte (`padding: 1px 4px;`, `gap: 4px;`, `gap: 4px;`, `margin-right: 2px;`, `gap: 4px;`). The CSS diff has one hunk, `@@ -426,12 +426,17 @@`, which adds exactly 5 lines above all of these entries. The number of entries is unchanged and the check was not loosened.
- **Disabled CSS in the live app (item 2):** servers started with `PASS servers` on 6138/9045. On pipeline `ebf9617e…`, I set the `disabled` attribute on `.pipeline-detail-page__step-card-duplicate-btn` from the DOM. This tests the CSS rule only; the React wiring is covered by the unit tests above.
  - Light: enabled button has opacity 1 and cursor pointer. Disabled button has opacity 0.35 and cursor not-allowed.
  - Dark (the app's real `helio-theme=dark` setting plus a reload; body background rgb(18,17,16)): disabled button has opacity 0.35 and cursor not-allowed.
  - Screenshots (persisted): `/home/matt/Development/helio/.concertino/runs/HEL-706/evidence/.concertino/runs/HEL-706/skeptic/skeptic-hel706-light-disabled.png` and `.../skeptic-hel706-dark-disabled.png`. In both, the duplicate icon is visibly dimmed next to the enabled power toggle, which matches the existing move-btn `:disabled` treatment. The hover rule is now `:hover:not(:disabled)`, the same as move-btn. No new values were added; the change reuses the existing rule group. Console errors: 0.
- **Acceptance criteria:**
  - AC1 (one clone per double-activation): the ref guard plus `disabled`, covered by the hook test and the per-surface tests.
  - AC2 (re-enables after success or failure): `.finally` in the hook, with resolve and reject tests for all three surfaces. The M2 mutant turned the pipeline re-enable test red.
  - AC3 (per-surface tests): present, and each one goes red under M2.
  - AC4 (synchronous guard): implemented with a ref and proven by the hook test under M1.

### Verdict: CONFIRM

### Non-blocking notes

- `PipelineDetailPage.test.tsx`, the "HEL-706: two synchronous activations" test: its comment says both clicks fire "before any re-render commits" so the test proves the ref guard. That is false. `fireEvent` is wrapped in `act`, so the `disabled` state commits between the two clicks, and the test still passes with the ref check removed (M1). The behavior is still proven by `useInFlightGuard.test.ts`. Either correct the comment, or make the test hit the ref path, for example by calling the handler twice inside one `act`.
- Process note: I first saved the light-theme screenshot to the main checkout root, then moved it into the worktree run dir. Nothing was left in the main checkout.
- Tooling: no mtime-ordering evidence was used.
