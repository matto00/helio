## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Diff scope**: `git diff main...HEAD -- frontend/src/features/panels/ui/PanelCreationModal.css` shows exactly
  a one-line fill-mode change (`both` → `backwards`) plus an explanatory comment on
  `.panel-creation-modal[open]`, byte-for-byte mirroring the shipped `frontend/src/shared/ui/Modal.css:14-22`
  pattern (`ui-modal[open]` already `backwards`, comment nearly identical). No other production code touched.

- **AC1 (popover aligns to trigger at 390×844, options tappable)** — verified live, independently, in both
  themes, not by trusting the evaluator's numbers:
  - Started servers via `scripts/concertino/start-servers.sh` + `assert-phase.sh servers` → both PASS.
  - Resized Playwright viewport to 390×844, logged-in session already present, drove the real flow: Add panel →
    Chart → Start blank → data type `skeptic-output` → Next → "Name your panel" step, opened the "Chart type"
    combobox.
  - `getBoundingClientRect()`/`getComputedStyle` read directly: trigger `bottom = 489.5`, listbox `top = 493.5`
    (aligned, ~4px gap), `left` matches exactly (21 = 21), `getComputedStyle(dialog).transform === "none"` at
    rest — reproduces the evaluator's numbers exactly, independently obtained.
  - Clicked the "Bar" option; the combobox value genuinely updated to "Bar" — confirms real tappability, not
    just visual alignment.
  - Repeated the entire flow in **light theme** (toggled via the theme button, discarded the in-progress panel
    first since the dialog is modal): identical rects (`bottom=489.5`/`top=493.5`/`left=21=21`,
    `transform: none`). Screenshots (`chart-type-popover-open.png` dark, `chart-type-popover-open-light.png`
    light) show a cleanly aligned, correctly styled popover in both themes — no visual regression, token usage
    (surface/border/text colors) consistent with the rest of the app chrome.
  - Zero console errors throughout the full flow in either theme (`browser_console_messages` level=error →
    0 messages both times).

- **AC2 (audit accuracy — only `PanelCreationModal.css` afflicted)** — re-derived independently, not trusted
  from the design doc or evaluator narrative:
  - `grep -rln "<dialog" src --include=*.tsx` → real `<dialog>`-rendering components are exactly
    `PanelCreationModal.tsx`, `PanelDetailModal.tsx`, `shared/ui/Modal.tsx` (the other hits are `.test.tsx`
    files, not components).
  - `find src -iname "PanelDetailModal*.css"` + `grep -n "animation\|\[open\]"` on all five files → no match;
    `PanelDetailModal` has no entrance-animation/`[open]` rule at all, confirming it's structurally immune
    regardless of the `Select`-heavy editors it hosts.
  - `shared/ui/Modal.css:14-22` already `backwards` since the cited precedent commit — read directly, confirmed.
  - `grep -n "usePortalPopover"` + `grep -n "document.body"` on `ActionsMenu.tsx`, `UserMenu.tsx`,
    `DashboardAppearanceEditor.tsx` → all three `createPortal(..., document.body)` unconditionally (no
    `closest("dialog")` branching), so the containing-block condition structurally cannot apply to them.
  - `Select.tsx:51` is the only conditional portal target (`closest("dialog[open]") ?? document.body`) — every
    dialog it could resolve to is covered by the bullets above. Audit claim checks out against ground truth.

- **AC3 (regression coverage is meaningful, not a tautology)** — reproduced myself, not trusted from the
  evaluation report:
  - Backed up the fixed CSS, reverted `.panel-creation-modal[open]`'s animation to the pre-fix `both`, ran
    `npx jest --config jest.config.cjs --testPathPatterns=PanelCreationModal.css.test` → **genuinely failed**:
    `Expected pattern: /\bbackwards\b/, Received string: "animation: panel-creation-modal-in
    var(--transition-slow) both;"`. Restored the fix from backup, confirmed `git diff` on the CSS file is
    clean again (no stray changes left behind).

- **Gates, re-run fresh myself**:
  - `npx jest --config jest.config.cjs --testPathPatterns=PanelCreationModal` → 2 suites, 48 tests, all pass.
  - `npx eslint src/features/panels/ui/PanelCreationModal.css.test.ts` → clean, no output.
  - `npx prettier --check` on both touched files → "All matched files use Prettier code style!"
  - `npm run lint` (full `eslint src --max-warnings=0`) → clean, no output.
  - `npm test` (full suite) → 107 suites / 1138 tests, all pass.
  - `npm run build` (`vite build`) → succeeds, no errors (one pre-existing unrelated chunk-size advisory).

- **No regression to sibling popovers / entrance animation**: `Modal.css`/`Modal.tsx`/`Select.tsx`/
  `usePortalPopover` are untouched per `git diff --stat` (only `PanelCreationModal.css` +
  `PanelCreationModal.css.test.ts` + OpenSpec artifacts changed). The `to` keyframe (`opacity:1; transform:none`)
  equals the dialog's resting style (confirmed both by the second test assertion and by the live
  `getComputedStyle(dialog).transform === "none"` reading above), so dropping the forwards fill is visually
  identical at rest — no entrance-animation regression observed in either theme's screenshot.

- **Tasks/artifacts consistency**: `tasks.md` 1.1–3.2 all checked and match the implemented diff exactly;
  `files-modified.md`'s root-cause narrative (probe output, audit reasoning) is consistent with what I
  independently re-derived above — no drift between planning artifacts and the shipped code.

### Verdict: CONFIRM

### Non-blocking notes
- The design doc's suggested follow-up (fold `PanelCreationModal` onto the shared `Modal` primitive to prevent
  this class of divergence recurring) remains reasonable as a spinoff, not a blocker for this ticket.
