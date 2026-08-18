## Skeptic Report — final gate (round 3, skeptic-final-3.md)

This round was explicitly authorized beyond the normal 2-round budget to re-verify the
comment-sweep fix in commit 5b3757ef. That narrow question checks out (see below) — but a
fresh, full re-review (as instructed) surfaced a severe, previously-undetected functional
regression in `PanelDetailModal`'s edit mode that is unrelated to the comment sweep. That
regression is blocking.

### What I verified (with evidence)

**1. Comment-sweep re-verification (the round's nominal focus) — clean.**
- Ran my own repo-wide grep sweep (`git grep -niE` across `frontend/`, `e2e/`,
  `openspec/specs/`, and the whole tracked tree) for every phrasing variant across all three
  rounds ("native ... focus containment", "already contains focus", "no jsdom replacement",
  "cannot exercise native", etc.). Confirmed no fourth code-level copy survives.
  `e2e/hel716-panel-creation-focus-trap.spec.ts:5-19`'s header comment (the file round 2
  flagged) now correctly states native `<dialog>` containment does NOT wrap focus and points
  at `Modal.tsx`/`Modal.test.tsx` — matches the fixed comments in `PanelCreationModal.tsx:212-219`
  and `PanelCreationModal.test.tsx:1166-1178`.
- Read `design.md`'s three annotated spots (Goals ~line 26-31, Risks ~line 118-124 and
  ~125-141): each now carries "Superseded during implementation" pointing at tasks.md
  1.6/5.3, consistent with the existing Decision 4 pattern. Accurate.
- Confirmed `openspec/specs/modal-dismiss-interactions/spec.md` and this change's own
  `specs/panel-detail-modal/spec.md` / `specs/modal-size-scale/spec.md` deltas describe only
  externally-observable behavior (no stale implementation-mechanism claims) — clean.
- Historical audit-trail files (`evaluation-1.md`, `skeptic-final-1.md`, `skeptic-final-2.md`,
  `skeptic-design-1.md`) correctly still *quote* the old claim as part of documenting what was
  wrong — appropriately left as-is, matches `files-modified.md`'s own account.
- `git diff main...HEAD --stat` confirms the diff is otherwise unchanged since round 2 except
  for commit 5b3757ef's comment-only edits (30 files, same shape as before).

**2. Gates re-run fresh, my own execution:**
- `npm run lint` (frontend/) — clean, zero warnings.
- `npm test` — 214/214 suites, 2309/2309 tests pass.
- `npm run build` — succeeds.
- `scripts/concertino/assert-phase.sh servers ...` → `PASS servers`.
- `DEV_PORT=6148 npx playwright test e2e/hel716-panel-creation-focus-trap.spec.ts` — 1/1
  passes against the live dev server (Tab/Shift+Tab wrap-around confirmed fresh).

**3. Live UI pass — `PanelCreationModal` is clean.** Logged in, opened "Add panel" via
Playwright, walked through all 4 steps (type → template → data type → name). Single header
per step confirmed at every step (no double-heading regression). Escape on a genuinely dirty
step-4 form (typed a title) correctly shows the inline discard-confirm banner with "Keep
editing" auto-focused; dismissing it correctly refocuses the modal's own title `<h2>`
(verified via `document.activeElement`). Close button while dirty re-shows the banner instead
of closing silently. All matches the design/tasks documentation.

**4. Live UI pass — `PanelDetailModal` — found a severe, blocking, previously-undetected
regression in edit mode.**

Opened the "Total value" Metric panel (view mode, `size="full"`) — clean, single header +
Edit button, light and dark themes both fine. Clicked "Edit" → edit mode (`size="md"`,
`height: min(680px, 90vh)` per `PanelDetailModal.css:7-9`). At a 1440×900 viewport — the exact
width this change's own evaluation reports (`evaluation-1.md`/`-2.md`) say they tested at —
**the footer (`Cancel` / `Save panel settings` buttons) is completely invisible**, and after
editing the title to make the form dirty, **the discard-confirmation warning banner is also
completely invisible**, for a plain, unremarkable Metric-panel edit form — no chart/table
config needed to trigger it.

Root cause, confirmed via direct measurement (`document.querySelector` +
`getBoundingClientRect()` + `document.elementFromPoint()`, screenshots at each step):

- `frontend/src/shared/ui/Modal.css:63-67` — `.ui-modal__inner { display:flex;
  flex-direction:column; max-height: 90vh; }`. This is Modal's own shared flex wrapper
  (header + `.ui-modal__body` + footer). It sizes itself against a hardcoded `90vh`,
  independent of whatever height the actual `<dialog>` box has.
- `frontend/src/features/panels/ui/PanelDetailModal.css:7-9` — `.panel-detail-modal { height:
  min(680px, 90vh); overflow: hidden; }`, applied to the `<dialog>` itself via `Modal`'s
  `className` prop (per design.md Decision 1 — the sanctioned mechanism for a consumer to
  have a fixed height narrower than 90vh).
- At any viewport taller than ~756px (`90vh > 680px` — true for the vast majority of real
  desktop/laptop displays: 1440×900, 1920×1080, 2560×1440, etc.), `min(680px, 90vh)` picks the
  fixed `680px` for the dialog's own box, but `.ui-modal__inner` still sizes itself up to
  `90vh` (measured 810px at 1440×900 — 130px taller than the dialog's own 680px box).
  Because the dialog has `overflow: hidden`, everything past that 680px cut line is clipped
  from both painting *and* hit-testing — this reliably swallows the entire `.ui-modal__footer`
  and, once shown, the `.panel-detail-modal__discard-warning` banner.
- Directly confirmed the hit-testing consequence: `document.elementFromPoint()` at the "Save
  panel settings" button's own on-screen center resolves to the `<dialog>` element itself, not
  the button — a real mouse click there hits `Modal.tsx:164`'s backdrop-click handler
  (`if (e.target === dialogRef.current) onClose()`) instead of submitting the form.
- Confirmed the mechanism directly: resizing the viewport to 700px tall (where
  `min(680px, 90vh)` picks `90vh = 630px`, which now *coincides* with `.ui-modal__inner`'s own
  `max-height: 90vh`) makes the footer render correctly — screenshot attached in my working
  session confirms Cancel/Save both visible and correctly positioned at that height.
- Confirmed this is a genuine regression, not pre-existing, against the pre-migration code
  (commit `68bc8381`, `PanelDetailModal.css:28-32`): `.panel-detail-modal__inner { height:
  100%; }` was the dialog's *only* flex wrapper and always matched the dialog's real
  (possibly-680px-capped) box; the scrollable region was the form itself
  (`.panel-detail-modal__content { flex: 1; overflow-y: auto; }` in the old
  `PanelDetailModal.binding.css:3-5`), with the discard-warning and footer as flex siblings
  *outside* that scroll region — always visible. The migration moved the `overflow-y: auto`
  responsibility up to `Modal`'s own shared `.ui-modal__body`, but left `.ui-modal__inner`'s
  independent `90vh` sizing unreconciled with a consumer's narrower `height` override.

Screenshots taken during this session (in the worktree root, not committed):
`hel716-detail-edit-light.png`, `hel716-detail-edit-fresh.png` (clean re-open, 1440×900, no
footer visible), `hel716-detail-close-warning-light.png` /
`hel716-detail-close-warning-scrolled.png` (discard-warning triggered but off-screen even at
max internal scroll), `hel716-detail-edit-short-viewport.png` (700px-tall viewport — footer
renders correctly, confirming the mechanism).

**Why this was missed by every prior pass:** `evaluation-1.md`'s Phase 4 happy-path note
claims "Save/Cancel footer present in edit mode" and both evaluation rounds report testing at
"1440/1100/768/375px" — those are *width* breakpoints only; nothing indicates a height check.
The default height in this environment's Playwright session is 900px (confirmed via
`window.innerHeight` during my own session) — well past the 756px threshold — so this should
have been visible to a careful look at 1440×900, but a cursory pass could easily miss a footer
that's invisible rather than present-but-wrong. Two prior skeptic-final rounds also passed
without catching it, likely for the same reason (their focus was the stale-comment finding,
not a fresh functional pass of the edit-mode form).

**Severity / scope:** This breaks the "Save panel settings" affordance for editing *any* panel
whose edit form is tall enough to exceed 680px total content height, at *any* viewport ≥~756px
tall — i.e., most real desktop/laptop usage. It also makes the entire vetoable-close-request
flow this ticket is centered on (design.md Decision 2) practically unusable in
`PanelDetailModal`: Escape/backdrop/✕/Cancel all correctly *trigger* the discard-confirmation
state (confirmed present in the DOM), but the confirmation itself is invisible, so the modal
appears completely frozen/unresponsive to every dismiss vector when dirty. This directly
contradicts ticket AC1 ("Both modals open/close/animate/trap-focus identically to every other
Modal-based surface in the app" — no other current `Modal` consumer combines a sub-90vh fixed
height with `Modal`'s shared body/footer, so none of them hit this) and design.md's Non-Goal
("No change to panel creation/edit business logic, save/discard semantics, or visual design").

### Verdict: REFUTE

### Change Requests

1. **(Blocking)** Fix `.ui-modal__inner`'s sizing in `frontend/src/shared/ui/Modal.css:63-67`
   so it always matches the actual `<dialog>` box height rather than independently capping at
   `90vh` — e.g. `height: 100%` (the outer `.ui-modal` class already caps the dialog itself at
   `max-height: 90vh`, so `.ui-modal__inner` only needs to fill whatever height the dialog
   actually ends up with, including a consumer's narrower override like
   `PanelDetailModal.css:7-9`/`:12-14`). After the fix, re-verify live at a ≥900px-tall
   viewport (not just the default/short one this bug hides in) that: (a) the footer
   (Cancel/Save) is visible in `PanelDetailModal` edit mode for an ordinary panel with no
   scrolling required; (b) the discard-confirmation banner is visible immediately when
   triggered via Escape/backdrop/✕/Cancel while dirty, without needing to scroll; (c) sanity-
   check `PanelDetailModal` view mode (`height: min(88vh, 900px)`) and `PanelCreationModal`
   (content-driven height, no override) are unaffected. Add this viewport-height case
   (explicitly ≥900px tall, not just the width breakpoints already covered) to the
   Evaluator/Skeptic's standard verification checklist for this change going forward, since a
   short default viewport silently hides the defect.

### Non-blocking notes

- The comment-sweep fix (commit 5b3757ef) itself is correct and complete — no further action
  needed there once the change request above is resolved.
