## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established cold** (not from evaluator/executor narration):
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/modal-size-scale/spec.md`, `specs/panel-detail-modal/spec.md`) directly from
  `openspec/changes/extend-modal-size-scale/`.
- Read the full diffs of `Modal.tsx`, `Modal.css`, `PanelCreationModal.tsx`,
  `PanelDetailModal.tsx`, `PanelDetailModal.css` via `git diff main...HEAD`.
- Read `evaluation-1.md`/`evaluation-2.md` only as claims to verify, not as fact.

**Gates re-run fresh, output read myself:**
- `npm run lint` — PASS (zero warnings).
- `npm run format:check` — PASS.
- `npm test` (full suite, not filtered) — PASS, 214 suites / 2309 tests.
- `npm --prefix frontend run build` — PASS (same pre-existing >500kB chunk warning, unrelated).
- `openspec validate extend-modal-size-scale --strict` — PASS: "Change 'extend-modal-size-scale' is valid".
- `grep -rn "<dialog" frontend/src --include="*.tsx"` — only one match, `Modal.tsx:174`.
  **AC2 ("No hand-rolled `<dialog>` element remains outside `shared/ui/Modal.tsx`") holds.**

**Live verification via Playwright against the running dev server** (servers reused,
`assert-phase.sh servers` → `PASS servers`), at 1440px, dark then light theme:

1. **PanelCreationModal single-header check (evaluator's CR1 fix).** Screenshots at every
   step ("Choose panel type", "Choose a template", "Choose a data type", "Name your panel")
   show exactly one visible header per step — no duplicate/stacked "Create panel" title.
   Confirmed in both dark and light theme.
2. **`titleKey` refocus mechanism — all three scenarios exercised live, not just read:**
   - Initial open: `document.activeElement` = the title `<h2 class="ui-modal__title">`
     ("Choose panel type").
   - Step change (type → template → datatype → name): refocus confirmed at every
     transition via `document.activeElement` reads, landing on each new step's title text
     each time.
   - Refocus after dismissing the discard-confirm banner: typed a real title (dirtying the
     form via `browser_type`, not a raw DOM `.value` set — see note below on why that
     distinction mattered), clicked ✕, confirmed the discard banner's default focus is
     "Keep editing", clicked "Keep editing", confirmed `document.activeElement` returned to
     the title `<h2>` ("Name your panel"), not `<body>`. This is exactly the race the
     executor's self-reported `key`+`autoFocus` bug was about; the ref+`useEffect` fix works.
3. **Tab/Shift+Tab focus-trap wrap-around, live in a real browser (not jsdom):** focused the
   last focusable element ("Create panel" submit button) and pressed Tab → landed on
   `.ui-modal__close` (first element). Pressed Shift+Tab from there → landed back on "Create
   panel" (last element). Both directions confirmed correct.
4. **Discard flow end-to-end**: dirty title → ✕ → discard-confirm banner → "Discard" →
   modal closes fully, no panel created.
5. **PanelDetailModal unified dismiss-vector behavior — all scenarios in the spec delta
   exercised live, matching it exactly:**
   - View mode, click ✕ → modal closes fully (confirmed: panel article reappears, dialog
     gone from the accessibility tree).
   - Edit mode, no unsaved changes, click ✕ → returns to view mode, modal stays open
     (confirmed via screenshot: "Edit" button + view content reappear, same dialog).
   - Edit mode, dirty (typed via `browser_type.fill`, confirmed the "Unsaved changes" badge
     appeared, proving the controlled-input dirty-state actually registered), press Escape →
     discard-confirm banner appears ("You have unsaved changes. Discard them?"); clicked
     "Discard" → title reverted to original, modal returned to view mode (did not close).
   - View mode, press Escape → modal closes fully.
   - This exactly matches the new `specs/panel-detail-modal/spec.md` MODIFIED-requirements
     scenarios, and I independently confirmed `openspec validate --strict` accepts the delta.
6. **No regression to a second, untouched `Modal` consumer**: opened `AddSourceModal`
   (`/sources` → "Add source") — single clean header, dynamic per-step title, no
   `titleKey`-related artifacts, renders identically in light theme too.
7. **Light/dark parity**: both modals and `AddSourceModal` screenshotted in light theme —
   clean, no missing token coverage, no unstyled flashes.
8. **No console errors/warnings** across every flow above (`browser_console_messages`
   checked at multiple points, 0 warnings/errors).

**AC1 ("Both modals open/close/animate/trap-focus identically to every other `Modal`-based
surface")**: verified via the Tab-wrap test (§3), the shared `ui-modal-in` animation now
applying to both migrated modals (via `Modal.css`'s shared size-class system, confirmed in
the CSS diff — no per-consumer animation override survives), and the unified `onClose`
plumbing in both `PanelCreationModal.tsx`/`PanelDetailModal.tsx` (`git diff` read in full —
no hand-rolled `dialogRef.current?.close()` calls remain in either file).

### One real defect found: stale/incorrect comments contradicting the code's actual behavior

Two comments — both in the exact area this two-cycle review process scrutinized most
heavily (task 1.6's self-correction, then CR3's jsdom-coverage fix) — were **never updated**
and now assert something demonstrably false about how the codebase's shared focus-trap
mechanism works:

- `frontend/src/features/panels/ui/PanelCreationModal.tsx:212-215`:
  ```
  // HEL-716 — the manual Tab/Shift+Tab focus-trap effect (F-110/1.6/1.7) is
  // retired: native <dialog> + showModal() focus containment now applies,
  // same as every other Modal consumer (see openspec design.md Decision "3.
  // Retire every hand-rolled <dialog>").
  ```
- `frontend/src/features/panels/ui/PanelCreationModal.test.tsx:1165-1173`:
  ```
  // 2.7/2.8 — Tab/Shift+Tab wrap-around were previously covered here against
  // the manual focus-trap `useEffect` (HEL-716 deleted it — see tasks.md
  // 2.2). Native `<dialog>` + `showModal()` focus containment now applies,
  // same as every other `Modal` consumer, but jsdom stubs `showModal` as a
  // no-op and implements no real focus containment, so there is no jsdom
  // replacement assertion possible (see openspec design.md Risks/Trade-offs
  // and tasks.md 4.5). ...
  ```

Both claims are false as of the code actually shipping:
1. **"Native `<dialog>` + `showModal()` focus containment now applies"** — this is the exact
   premise `tasks.md` item 1.6 documents as a **"mistaken assumption"**, probe-confirmed
   false on two Chromium versions (native containment does not wrap focus; it falls through
   to `<body>`). `Modal.tsx:121-131`'s own doc comment correctly explains this and states the
   trap was "moved here and generalized" — directly contradicting the two comments above,
   which were apparently written before 1.6's fix and never reconciled with it.
2. **"there is no jsdom replacement assertion possible"** (test file) — false as of cycle 2's
   CR3 fix: `Modal.test.tsx` now has exactly that replacement (`describe("Tab/Shift+Tab focus
   trap", ...)`, 3 cases, verified passing in the fresh full-suite run above).

This is not a nitpick about phrasing — it actively misinforms a future reader about a
shared, accessibility-relevant mechanism used by all 13 `Modal` consumers: someone reading
`PanelCreationModal.tsx:212` today would conclude no JS-level trap exists and native
containment is sufficient, which is precisely backwards. It sat untouched through cycle 2
despite that cycle deliberately touching the immediately-adjacent code (`handleClose`,
`cancelDiscard`, the `Modal` invocation) for CR1, and despite CR3 adding the very jsdom
coverage the test-file comment claims doesn't exist — both cycles' automated evaluation
passes focused on functional/mechanical checks and did not catch this, which is exactly the
kind of blind spot this role exists to close.

### Verdict: REFUTE

The implementation itself is solid and I could not find a functional, AC, or design
regression anywhere I probed (extensively, live, in both themes, across both modals and a
sibling untouched consumer). The one finding below is narrow, cheap to fix, and does not
require touching any behavior — but it is a real, verifiable, specific defect in shipped
code comments that contradicts the code's actual behavior in the exact file this review
process spent two cycles on, so I'm not waving it through.

### Change Requests

1. **Fix the stale/incorrect focus-trap comments.**
   - `frontend/src/features/panels/ui/PanelCreationModal.tsx:212-215` — rewrite to state
     that native `<dialog>` containment does *not* wrap focus (probe-confirmed false, see
     `tasks.md` 1.6), and that the Tab/Shift+Tab wrap trap now lives in `Modal.tsx` (shared
     across all consumers), not "native containment now applies."
   - `frontend/src/features/panels/ui/PanelCreationModal.test.tsx:1165-1173` — update to
     state that jsdom coverage for this mechanism *does* exist now, in
     `Modal.test.tsx`'s `"Tab/Shift+Tab focus trap"` describe block (added for CR3), rather
     than asserting "there is no jsdom replacement assertion possible."

### Non-blocking notes

- Carried from both prior cycles, still accurate and still non-blocking:
  `PanelCreationModal.tsx` (551 lines) and `PanelDetailModal.tsx` (417 lines) remain over
  `CONTRIBUTING.md`'s ~400-line soft budget — both pre-existing and both reduced by this
  change, worth a follow-up split proposal.
- `evaluation-2.md`'s note about `workflow-state.md` being incidentally included in the
  cycle-2 commit is accurate and harmless (content matches reality) — a commit-hygiene
  reminder, not a defect.
