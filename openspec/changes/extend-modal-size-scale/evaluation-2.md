## Evaluation Report — Cycle 2 (evaluation-2.md)

### Phase 1: Spec Review — PASS

All three cycle-1 change requests independently verified as addressed, against commit `ed7bc0a6` (on top of `1e23b6a1`):

1. **Double header (CR1) — fixed and independently re-verified live.** `PanelCreationModal.tsx` now passes the per-step title dynamically as `Modal`'s own `title` prop (`title={getStepTitle()}`), mirroring `AddSourceModal.tsx:286`'s existing pattern, with a stable `ariaLabel="Create panel"` kept explicit so the dialog's accessible name doesn't churn per step. The redundant body-level `<h2>`/`titleRef` are deleted; only the "Step N of M" eyebrow remains body-owned. Confirmed via Playwright screenshots at 1440/1100/375px: a single, clean header per step ("Choose panel type", "Choose a template", "Name your panel", etc.) with no duplication at any breakpoint tested.
2. **Planning docs (CR2) — updated and structurally validated.** `proposal.md`'s Non-Goals now scopes "save/discard semantics" precisely (persistence + trigger conditions unchanged; only the post-dismiss destination is unified) instead of a blanket "no change" claim, and its Modified Capabilities section now lists `panel-detail-modal` with an accurate explanation. The new spec delta at `openspec/changes/extend-modal-size-scale/specs/panel-detail-modal/spec.md` copies the *entire* original "Modal dismisses on Escape, backdrop click, and Cancel" requirement forward under a `## MODIFIED Requirements` header (not a fragment) and edits it correctly: two new scenarios ("Close (✕) button closes the modal from view mode", "Close (✕) button with no unsaved changes returns to view mode from edit mode") plus updated existing scenarios. Ran `openspec validate extend-modal-size-scale --strict` myself — **`Change 'extend-modal-size-scale' is valid`** — confirming the delta is structurally well-formed per the MODIFIED-requirements workflow, not just plausible-looking prose. The delta's content matches exactly what I independently verified live in cycle 1 (✕ button now returns to view mode in both the clean and dirty-then-confirmed cases, matching Escape/backdrop/Cancel; only a dismiss from view mode actually closes).
3. **`design.md`/`tasks.md` consistency** — Decision 4 is marked superseded with the corrected resolution in place; `tasks.md` strikes through the superseded 2.3 with a cross-reference and adds a clearly-scoped "## 5. Cycle 2" section mapping each change request to its task.

No new AC reinterpretation, no scope creep, no regression to the already-accepted cycle-1 findings (the ✕-button/discard-behavior unification itself is unchanged code — `PanelDetailModal.tsx`/`.test.tsx` have zero diff between `1e23b6a1` and `ed7bc0a6`, confirmed via `git diff`).

**Minor process note (non-blocking):** the fix commit incidentally includes `openspec/changes/extend-modal-size-scale/workflow-state.md` (an orchestrator-owned file — `CYCLE`, `LAST_EVAL_VERDICT`, `LAST_EVAL_REPORT` fields). This is almost certainly an overly broad `git add`/`git commit -a` rather than a deliberate edit; the content itself is accurate (reflects the real cycle-1 verdict/report path), so it's not a correctness problem, just a commit-hygiene slip worth a heads-up.

### Phase 2: Code Review — PASS

Gates (fresh run, in `WORKTREE_PATH`, no `CLEAN_WORKTREE`):
- `npm run lint` — PASS (zero warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (214 suites / **2309** tests, up from 2306 — the 3 new focus-trap cases)
- `npm --prefix frontend run build` — PASS (same pre-existing >500kB chunk-size warning, unrelated)
- `openspec validate extend-modal-size-scale --strict` — PASS (see Phase 1)

**CR3 (jsdom focus-trap coverage) — verified meaningful, not trivially passing.** The new `describe("Tab/Shift+Tab focus trap", ...)` block in `Modal.test.tsx` renders a real `Modal` with three distinct buttons, asserts `document.activeElement` identity (not just "some button") after `fireEvent.keyDown`, covers both directions (Tab-from-last→first, Shift+Tab-from-first→last), and includes a negative case (Tab from a non-boundary element is *not* intercepted) that would catch an over-eager trap implementation. This is exactly the technique the deleted `PanelCreationModal.test.tsx` 2.7/2.8 tests already proved works in jsdom for this exact hand-rolled-JS mechanism.

**`titleKey`/refocus implementation reviewed and independently confirmed correct (see Phase 3).** The self-caught `key`+`autoFocus` race-condition bug (an isolated repro, not app-code-dependent, matching this project's evidence-gated debugging standard) was fixed by switching to a ref+`useEffect` — I independently reproduced all three of the scenarios the executor's own notes describe (initial-open focus, step-change focus, refocus-after-"Keep editing") live against the running dev server and all three land correctly on the title `<h2>`, not `<body>`.

No new mechanical violations: no inline FQNs, all new CSS (`border-radius: var(--app-radius-sm)` on `.ui-modal__title`) uses tokens, `Modal.tsx` (195 lines) and `PanelCreationModal.tsx` (551 lines, effectively unchanged from cycle 1's 557) stay within the same file-size posture noted (non-blocking) in cycle 1 — no new file crossed the ~400-line threshold as a result of this cycle's changes. No dead code (the old `[step]`-keyed effect and `titleRef` were fully removed, not left as unused remnants).

### Phase 3: UI Review — PASS

Dev servers reused (already healthy) via `scripts/concertino/start-servers.sh` / `assert-phase.sh` — `PASS servers`.

- **Double-header defect (CR1) — confirmed gone** at 1440/1100/375px via fresh Playwright screenshots: single clean header per wizard step in every case.
- **Focus behavior — independently verified live, all three scenarios the executor's notes claim**:
  - Initial modal open: `document.activeElement` is the title `<h2>` ("Choose panel type").
  - Step change (clicking "Metric" → template step): focus moves to the new title ("Choose a template"); repeated through to the final step ("Name your panel") — confirmed at every step transition, not just once.
  - Refocus after dismissing the discard-confirm banner: typed a dirty title, clicked ✕ (discard banner appears, default focus on "Keep editing" as expected), clicked "Keep editing", confirmed focus returned to the title `<h2>` ("Name your panel"), not `<body>` — this is the exact race the executor's self-caught bug was about, and it works correctly now.
- **Tab/Shift+Tab wrap-around — re-verified, no regression**: Tab from the last focusable element (the "Create panel" submit button) wraps to the first (`.ui-modal__close`), confirming the shared trap effect in `Modal.tsx` still works correctly after this cycle's changes.
- **Discard flow end-to-end**: dirty → ✕ → discard-confirm banner → "Discard" → modal fully closes, no panel created. Matches existing `modal-dismiss-interactions` behavior.
- **No regression to other `Modal` consumers**: spot-checked `PanelDetailModal` (view mode, unchanged code) and `AddSourceModal` (a second dynamic-per-step-title consumer, `titleKey` omitted) — both render identically to before, no visual or console-error regressions from `Modal.tsx`'s `titleKey`/`tabIndex`/`aria-live` additions (which are the no-op-for-other-consumers claim in `files-modified.md`).
- **No console errors or warnings** across every flow tested (full wizard walkthrough, discard, close from view mode, `AddSourceModal` open/close).
- Breakpoints 1440 / 1100 / 375 all render cleanly for the corrected `PanelCreationModal`; `PanelDetailModal`/`AddSourceModal` sanity-checked at 1440 only (unchanged this cycle, already covered at all four breakpoints in cycle 1).

### Overall: PASS

### Non-blocking Suggestions

- (Carried from cycle 1, still non-blocking, unaffected by this cycle) `PanelCreationModal.tsx` (551 lines) and `PanelDetailModal.tsx` (417 lines, unchanged this cycle) remain over `CONTRIBUTING.md`'s ~400-line soft budget — consider proposing a split in a follow-up.
- Minor commit-hygiene note: `workflow-state.md` (orchestrator-owned) was incidentally included in the cycle-2 fix commit — likely an overly broad `git add -A`/`git commit -a`. Content is accurate, not a correctness issue; worth a reminder to scope commits to intended files going forward.
