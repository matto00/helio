## Skeptic Report — final gate (round 2, skeptic-final-2.md)

### What I verified (with evidence)

**Ground truth re-established cold** (not from the orchestrator's note or round 1's report,
treated as claims to verify):
- Read `ticket.md` fresh (AC1: "Both modals open/close/animate/trap-focus identically to every
  other `Modal`-based surface"; AC2: "No hand-rolled `<dialog>` element remains outside
  `shared/ui/Modal.tsx`").
- Read `skeptic-final-1.md`, `files-modified.md`, `evaluation-2.md` only as claims.
- Read `git log --oneline -10` — confirmed `cbc24392` sits on top of `ed7bc0a6`/`1e23b6a1`,
  working tree clean.
- Read the full `git show cbc24392` diff myself (not summarized): it touches exactly
  `PanelCreationModal.tsx` (comment block above `handleClose`, lines 212+) and
  `PanelCreationModal.test.tsx` (comment block at the end of the "accessibility (dismiss +
  focus trap)" describe block) — zero lines of executable code changed in either file (no
  diff to `handleClose`'s body, no diff to any test assertion), plus report/doc bookkeeping
  files (`evaluation-2.md`, `skeptic-final-1.md`, `tasks.md`, `files-modified.md`,
  `workflow-state.md`). Confirms the "comment-only, no behavior change" claim.

**The two comments round 1 flagged — read fresh, confirmed now accurate:**
- `PanelCreationModal.tsx:212-219` now correctly states native `<dialog>` containment does
  *not* wrap focus and that the trap was "relocated and generalized into the shared
  `Modal.tsx`." Cross-checked against `Modal.tsx:121-131`'s own doc comment (read directly) —
  consistent.
- `PanelCreationModal.test.tsx:1165-1178` now correctly points at `Modal.test.tsx`'s
  `"Tab/Shift+Tab focus trap"` describe block as the jsdom replacement coverage. Read
  `Modal.test.tsx:199-`: that block exists, 3 cases, matches the description.

**Checked for other stale copies of the same misinformation in touched files — found one:**
`grep -rn "focus containment|showModal|native <dialog>"` across every file this change
touches (`Modal.tsx`, `Modal.test.tsx`, `PanelCreationModal.tsx/.test.tsx`,
`PanelDetailModal.tsx/.test.tsx`, and `e2e/hel716-panel-creation-focus-trap.spec.ts`) turned
up a third, uncorrected copy — see Change Requests below.

**Gates re-run fresh myself, output read (not pasted from another report):**
- `grep -rn "<dialog" frontend/src --include="*.tsx"` — still exactly one real `<dialog>`
  element (`Modal.tsx:174`); every other hit is a comment. **AC2 holds.**
- `npm run lint` (from `frontend/`) — exit 0, zero warnings.
- `npm run format:check` — `All matched files use Prettier code style!`
- `npm test` — fresh run, silent mode: `Test Suites: 214 passed, 214 total` /
  `Tests: 2309 passed, 2309 total`. Matches the claimed counts.

**Live verification against the running dev server (servers reused —
`assert-phase.sh servers` → `PASS servers`), logged-in session, both themes:**
- Opened `PanelCreationModal` ("Add panel"). Snapshot confirms a single header
  (`heading "Choose panel type" [active]`) — no double-header regression.
  `document.activeElement` on open = the title `<h2 class="ui-modal__title">`, matching the
  `titleKey` mechanism.
- **Live Tab-wrap reproduction, not just re-reading round 1's claim:** focused the last
  focusable element inside the dialog (the "Timeline" panel-type button, confirmed via
  `querySelectorAll` count=10) via `element.focus()`, pressed `Tab`, read
  `document.activeElement` — landed on `.ui-modal__close` (first element). This is the exact
  mechanism both fixed comments now describe correctly; reproduced it live myself rather than
  trusting the comment or round 1's narrative.
- Closed via Escape — modal fully closed (dialog gone from the DOM query), no console
  errors/warnings (`browser_console_messages` — 0/0).
- Opened `PanelDetailModal` (clicked the "Total value" panel). Confirmed
  `dialog.className` includes `ui-modal--full panel-detail-modal panel-detail-modal--view`
  and the title reads "Total value" — matches design.md Decision 1's `size="full"` for view
  mode. Screenshotted in light theme: clean single header (title, "Edit" button, close), no
  visual regression.
- Toggled to dark theme, reopened the same modal, screenshotted again: dialog background
  computed style `rgb(38, 35, 32)` / text `rgb(242, 239, 233)` — correct dark-token
  application, no unstyled/light flash, matches the app's dark palette. No console
  errors/warnings.
- No functional or visual regression found anywhere I probed, consistent with round 1's
  extensive finding of the same.

### One real defect found: a third, uncorrected copy of the exact misinformation the fix commit was supposed to eliminate

`e2e/hel716-panel-creation-focus-trap.spec.ts:5-13` (wholly new in this change — added in
`1e23b6a1`, confirmed via `git log --follow` showing only that one commit touched it; **never
touched by the `cbc24392` fix commit**, confirmed via that commit's diff) still reads:

```
// PanelCreationModal's manual Tab-wrap focus trap was deleted as part of
// migrating onto the shared `Modal` primitive (native <dialog> + showModal()
// focus containment now applies, same as every other Modal consumer). jsdom
// stubs showModal() as a no-op and implements no real focus containment, so
// the deleted manual trap's Tab/Shift+Tab wrap-around jsdom assertions
// (Modal.dismiss-interactions spec) have no jsdom replacement — this
// real-browser check is that replacement, exercising native containment
// against the running dev server ...
```

This is word-for-word the same false claim round 1 required fixing in the other two files:
"native `<dialog>` + `showModal()` focus containment now applies, same as every other Modal
consumer" is the exact premise `tasks.md` 1.6 documents as probe-confirmed false (native
containment does not wrap focus; Chromium falls through to `<body>`), and "jsdom ... implements
no real focus containment, so ... no jsdom replacement [is possible]" is false as of cycle 2's
CR3, which added exactly that replacement to `Modal.test.tsx`.

This is not a minor miss — it is arguably worse than the two comments already fixed, for two
reasons specific to this file:
1. **Both just-fixed comments now explicitly point a future reader at this exact file** as the
   real-browser coverage ("This modal's own real-browser Playwright coverage
   (`e2e/hel716-panel-creation-focus-trap.spec.ts`) remains as the real-`<dialog>` end-to-end
   check" — `PanelCreationModal.test.tsx`'s new comment). A reader who follows that pointer
   lands directly on this file's header comment, which still asserts the opposite of what they
   were just told.
2. The test *itself* (the assertions, lines 26-77) is written correctly and does exercise the
   real mechanism — it's only the header comment's narrative that's stale, exactly the same
   "code is right, comment lies about why" pattern as the two already-fixed instances.

This sat untouched through the round-1 → fix-commit cycle despite the fix commit's own stated
purpose being to eliminate precisely this claim everywhere it appears, and despite this file
existing since the very first implementation commit (`1e23b6a1`) — it predates even the
original two stale comments' authorship point of divergence from reality.

### Verdict: REFUTE

No functional, AC, or visual/design regression anywhere I probed, fresh, live, in both
themes — the implementation is solid and unchanged in behavior since round 1's extensive
sign-off. But the round-1 change request was specifically "fix the stale/incorrect
focus-trap comments" so a future reader isn't misinformed about a shared,
accessibility-relevant mechanism, and one more instance of that exact misinformation — in a
file the just-fixed comments now actively direct readers toward — survived the fix commit.
The fix is incomplete, not wrong; narrow and cheap, but real.

### Change Requests

1. **Fix the stale/incorrect header comment in `e2e/hel716-panel-creation-focus-trap.spec.ts:5-13`.**
   Rewrite to match the corrected understanding now in `PanelCreationModal.tsx`/`.test.tsx`:
   native `<dialog>` + `showModal()` makes outside content inert but does **not** wrap focus
   back to the first/last element (probe-confirmed false, `tasks.md` 1.6); the wrap trap was
   relocated + generalized into the shared `Modal.tsx` (`tasks.md` 1.6), which now has its own
   jsdom coverage in `Modal.test.tsx`'s `"Tab/Shift+Tab focus trap"` describe block (cycle 2
   CR3). This file's role is then accurately: a real-`<dialog>`, real-browser end-to-end check
   of that same shared mechanism as exercised through the migrated `PanelCreationModal`
   specifically — not "the only possible coverage because jsdom can't do it at all."
2. **Grep sweep before resubmitting**: `grep -rn "focus containment now applies\|no jsdom replacement" frontend/src e2e` to confirm no fourth copy was missed — I ran this and found none beyond item 1, but it's cheap insurance given this is now the second time an instance was missed.

### Non-blocking notes

- `openspec/changes/extend-modal-size-scale/design.md`'s Goals section (line 27) and
  Risks/Trade-offs section (lines 118-121) also still carry the pre-1.6 "native containment
  already handles this" framing, unlike Decision 4 which was explicitly marked superseded for
  the double-header finding. Round 1 didn't flag this (design.md documents planning-time
  reasoning, and `tasks.md`'s 1.6 entry + `files-modified.md`'s "Deviation from tasks.md"
  section already carry the accurate as-built story), so I'm not making it a blocking item
  now either — but if this change is revisited for the e2e-spec fix, it would be cheap to add
  a matching "(superseded — see tasks.md 1.6)" annotation there too for full consistency.
- Carried from prior cycles, still accurate and still non-blocking: `PanelCreationModal.tsx`
  (551 lines) and `PanelDetailModal.tsx` (417 lines) remain over `CONTRIBUTING.md`'s ~400-line
  soft budget — both pre-existing and both reduced by this change, worth a follow-up split
  proposal.
