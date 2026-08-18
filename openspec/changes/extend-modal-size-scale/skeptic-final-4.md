## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Second human-authorized extra round beyond the ordinary 2-round budget, specifically to
independently re-verify commit `1f80579b`'s fix for the severe tall-viewport footer/discard-banner
invisibility bug round 3 found. Cold re-review — nothing here is taken from the executor's commit
message or round 3's report without independent reproduction.

### What I verified (with evidence)

**Ground truth re-established cold:**
- Read `ticket.md` fresh: AC1 "Both modals open/close/animate/trap-focus identically to every
  other `Modal`-based surface"; AC2 "No hand-rolled `<dialog>` element remains outside
  `shared/ui/Modal.tsx`".
- `git log --oneline -6`: `1f80579b` sits on `5b3757ef`/`cbc24392`/`ed7bc0a6`/`1e23b6a1`; working
  tree clean before and after my testing (`git status --short` empty both times).
- Read `git show 1f80579b` in full myself (not summarized) — touches exactly `Modal.css` (17
  lines) plus the new e2e spec and openspec bookkeeping. No other source file changed.
- Read `Modal.css`, `Modal.tsx`, `PanelDetailModal.css`, `PanelDetailModal.tsx`,
  `PanelCreationModal.css`/`.tsx` directly to build my own mental model of the box-sizing chain
  before touching the browser, rather than trusting the commit message's narrative.

**1. CSS fix — live verification at 1440×900 (was the exact regressing viewport):**
- Opened `PanelDetailModal` edit mode on a real Metric panel (view → Edit). Screenshot
  (`hel716-edit-1440x900.png`): footer (Cancel/Save) fully visible, no clipping.
- Dirtied the title field, clicked Cancel to trigger the discard banner. Screenshot
  (`hel716-skeptic-discard-banner-1440x900.png`): banner **and** footer simultaneously visible.
- Ran my own `document.elementFromPoint` hit-test (independent of the e2e spec's assertions,
  written fresh in this session) against the Discard, Keep-editing, and Save buttons' actual
  on-screen centers: all three resolved to `BUTTON` elements that are the buttons themselves
  (`isSameOrChild: true` for all three) — not the `<dialog>` backdrop. This is the exact
  mechanism of the original bug (clicks silently hitting the backdrop and firing `onClose`
  instead of the intended action); confirmed fixed by direct measurement, not by re-reading the
  claim.
- Discarded my test edit, confirmed the panel title reverted to "Edited" (no residual test data
  left behind), `git status --short` still clean.

**2. Dark-theme parity at the same viewport:**
- Toggled dark theme, reopened edit mode: screenshot (`hel716-skeptic-dark-edit-1440x900.png`)
  — footer visible, correct dark tokens.
- Dirtied + triggered discard banner in dark: screenshot (`hel716-skeptic-dark-discard-1440x900.png`)
  — banner and footer both visible, no light-theme bleed-through, no unstyled flash.
- Discarded, reverted cleanly.

**3. View mode and PanelCreationModal unaffected (regression check):**
- `PanelDetailModal` view mode (`size="full"`, `height: min(88vh, 900px)`) at a genuinely tall
  1920×1200 viewport: screenshot (`hel716-skeptic-view-1920x1200.png`) — dialog renders at its
  correct 900px cap, content centered, no clipping, no footer expected/rendered (view mode has
  none).
- `PanelCreationModal` (content-driven height, no `className` height override) at 1440×900:
  screenshot (`hel716-skeptic-creation-1440x900.png`) — `dialogHeight` 525.17px, `.ui-modal__inner`
  523.17px (the 2px delta is exactly the `.ui-modal`'s 1px top+bottom border, expected — not a
  clipping regression). Fully rendered, no scrollbar, no cut content.

**4. Third viewport scenario (sanity-check for a new edge case from `height: 100%` itself), per
the round's explicit instruction:**
- Very tall desktop (1920×1200): view mode confirmed above, unaffected.
- Narrow-but-tall mobile viewport (390×1200) — exercises `PanelDetailModal.mobile.css`'s
  `@media (max-width: 430px)` full-screen override (`height: 100dvh`), a code path none of the
  three prior skeptic rounds exercised together with height. Opened edit mode, dirtied the title,
  triggered the discard banner: screenshot (`hel716-skeptic-mobile-discard-390x1200.png`) —
  banner and footer both visible at the bottom, no clipping. Direct measurement:
  `dialogHeight: 1200, innerHeight: 1200` (exact match, both fill the full 100dvh), and
  `document.elementFromPoint` hit-tests on Discard and Save both resolved to the buttons
  themselves. `height: 100%` composes correctly with the mobile full-screen override — no new
  edge case found.

**5. Stale-comment sweep re-confirmed clean (quick re-check per the round's instruction, not a
full re-audit):**
- `grep -rn "focus containment now applies\|no jsdom replacement\|native containment already
  handles" frontend/src e2e` — zero matches (exit 1). The third stale copy round 2 found and
  round 3 confirmed fixed is still fixed.
- Read `e2e/hel716-panel-creation-focus-trap.spec.ts:1-20` directly: header comment states the
  corrected mechanism (native `<dialog>` prevents escape but doesn't wrap focus; the wrap trap
  lives in `Modal.tsx`; this file is real-browser coverage of that shared mechanism, not "the
  only possible coverage"). Accurate.
- AC2 re-check: `grep -rn "<dialog" frontend/src --include="*.tsx"` — exactly one real JSX
  `<dialog>` element (`Modal.tsx:174`); every other hit across 15 files is a comment or prose
  reference to the native element, none a second hand-rolled dialog. **AC2 holds.**
- AC1: both modals render on the shared `Modal` (confirmed via `dialog.className` containing
  `ui-modal`/`ui-modal--md`/`ui-modal--full` plus the consumer's own class throughout my live
  session); Tab/Shift+Tab wrap re-verified passing via the dedicated e2e spec (below); vetoable
  close (Escape → discard banner rather than immediate close) directly observed working in edit
  mode at every viewport I tested. **AC1 holds.**

**6. All gates re-run fresh myself, output read directly (not pasted from another report):**
- `npm run lint` (frontend/) — exit 0, zero warnings.
- `npm run format:check` — `All matched files use Prettier code style!`
- `npm test` — fresh run: `Test Suites: 214 passed, 214 total` / `Tests: 2309 passed, 2309 total`.
- `npm run build` — succeeds (`vite build`, pre-existing >500kB chunk-size warning only, unrelated
  to this change).
- `npx playwright test e2e/hel716-panel-detail-tall-viewport-footer.spec.ts
  e2e/hel716-panel-creation-focus-trap.spec.ts` — both pass. Re-ran the tall-viewport spec a
  second time in isolation to rule out a one-off pass (tooling-sensitivity discipline for a
  layout-dependent test) — passed both times, stable.
- Servers: `scripts/concertino/assert-phase.sh servers` → `PASS servers` (reused already-healthy
  dev servers).
- `browser_console_messages(level: error)` throughout my session — 0 errors at any point.

### Verdict: CONFIRM

The `height: 100%` fix in `Modal.css` genuinely resolves the tall-viewport regression round 3
found — verified independently via direct DOM measurement and real click hit-testing, not by
re-reading the commit's claims, at the original regressing viewport (1440×900), in both themes,
and at two additional viewport scenarios (1920×1200 very-tall, 390×1200 narrow-but-tall mobile)
that specifically probe for a new edge case from the fix itself. None found — `PanelDetailModal`
view mode and `PanelCreationModal` are unaffected, exactly as the fix's stated design (a plain
`.ui-modal` already caps at `max-height: 90vh`, so `height: 100%` on the inner wrapper is a no-op
for any consumer that doesn't set its own narrower fixed height). The stale-comment sweep from
prior rounds is still clean, AC1 and AC2 both hold, and every gate (lint, format, full 2309-test
suite, build, both e2e specs) passes fresh. Ships.

### Non-blocking notes

- Carried forward from round 2 (still accurate, still non-blocking): `PanelCreationModal.tsx`
  (551 lines) and `PanelDetailModal.tsx` (417 lines) remain over `CONTRIBUTING.md`'s ~400-line
  soft budget, both pre-existing and both reduced by this change — worth a follow-up split
  proposal, not a blocker for this ticket.
- The repo root (`~/Development/helio`, the main worktree) has accumulated a large number of
  stray screenshot PNGs from parallel Playwright MCP sessions across unrelated tickets/rounds
  (pre-existing, documented pattern — not introduced by this change). I added a handful more
  during this round's live verification (`hel716-skeptic-*.png`); flagging for the same cleanup
  this repo already has pending, not a new issue.
