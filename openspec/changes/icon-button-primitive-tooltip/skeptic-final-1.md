## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established fresh (not from evaluator narrative):**
- Read `ticket.md` (2 ACs), `proposal.md`, `design.md`, `openspec/specs/icon-button/spec.md`,
  `files-modified.md`, `evaluation-1.md`, `evaluation-2.md` directly from the worktree.
- `git diff main...HEAD --stat` — 47 files changed, matches `files-modified.md`'s inventory.
- Read `frontend/src/shared/ui/IconButton.tsx` and `IconButton.css` in full — required `aria-label:
  string` (no `?`), `title` defaults to `ariaLabel` (`title={title ?? ariaLabel}`), ghost/secondary/
  danger variants at xs/sm/md sizes mapped to `--control-sm`/`--control-md`/24px, mobile 44px floor —
  matches `openspec/specs/icon-button/spec.md`'s four requirements exactly.
- `git diff main...HEAD -- DESIGN.md` — new "Icon-only buttons" subsection under §5, `IconButton`
  registered in §6's shared-primitives list. AC-1 ("`IconButton` exists in `shared/ui/`, documented in
  DESIGN.md §5/§6") is met.

**Gates re-run fresh, myself, in the worktree (not trusted from evaluation-2.md's paste):**
- `npm run lint` → 0 errors/warnings (`eslint src --max-warnings=0`).
- `npm test` (full suite) → **216 suites / 2329 tests passed**, matches evaluator's cycle-2 count exactly.
- `npm run format:check` → Prettier clean.
- Targeted re-run of every migrated call site's test file (`IconButton`, `SidebarItemList`,
  `DashboardList`, `Modal`, `PreferencesEditor`, `CommandBar`, `Sidebar`, `RefinementChatDrawer`,
  `StepCard`, `PanelList`, `Toast`, `DashboardAppearanceEditor`, `SidebarBody`) → 34 suites / 440 tests
  passed.

**Cycle-1 regression fix independently re-verified (not taken on faith):**
- `git diff main...HEAD -- frontend/src/shared/chrome/SidebarItemList.tsx` — confirms the add button is
  now `<IconButton icon="+" variant="secondary" size="xs" aria-label={...} onClick={onAdd} />`, and the
  filter-clear button gained `title="Clear filter"`.
- Grepped every class deleted in this diff (`.cmd-btn--icon`, `.ui-modal__close`,
  `.preferences-editor__icon-btn`, `.refinement-drawer__close`, `.dashboard-list__add`) across all of
  `frontend/src` myself — zero live `className`/CSS-selector references remain; only historical/pointer
  comments. Matches evaluation-2.md's re-grep claim.
- Live in the browser (servers already healthy, `assert-phase.sh servers` → `PASS servers`): navigated
  to `/pipelines` and inspected `[aria-label="New pipeline"]` via `getComputedStyle` —
  `ui-icon-btn ui-icon-btn--secondary ui-icon-btn--xs`, `border: 1px solid rgba(242,239,233,0.09)`,
  `border-radius: 6px`, `title="New pipeline"`, 24×24. Regression is genuinely fixed, in both light and
  dark theme (screenshotted both — light-mode sidebar "+ " button renders with correct border/background,
  parity holds).

**Independent app-wide audit of the AC-2 claim ("every icon-only interactive element ... has a visible
or accessible tooltip/label") — this is where I found a real gap:**

`files-modified.md`'s "Audited, no change needed" section states: *"A full-codebase sweep of every
`<button>` containing a `FontAwesomeIcon`/`lucide-react`/`<svg>` child with no visible text found zero
instances missing `aria-label`."* I ran my own independent sweep, widened beyond that exact methodology
(which is scoped to icon-*component* children and misses plain-glyph buttons), and found one:

**`frontend/src/features/panels/ui/PanelCard.tsx:270-276`** — the panel-card delete-confirmation's
cancel button:
```tsx
<button
  type="button"
  className="panel-grid-card__delete-cancel-btn"
  onClick={onCancelDelete}
>
  ×
</button>
```
No `aria-label`, no `aria-labelledby`, no `title` — an icon-only control (a bare "×" glyph, not
descriptive text) with neither an accessible name nor a visible tooltip. Confirmed **live** (not just by
reading source): opened a panel's actions menu → Delete → the confirm/cancel pair renders (screenshot:
`panel-grid-card__delete-confirm-btn` "Confirm" next to the bare "×"); `document.querySelector('.panel-
grid-card__delete-cancel-btn')` in the live DOM returns `{ ariaLabel: null, title: null, text: "×" }`.
No test file covers this button's accessible name either (`PanelCard.test.tsx` has zero references to
`delete-cancel-btn`).

This is not a stylistic nitpick — it is a **textbook match** for the exact defect scenario this
change's own `openspec/specs/icon-button/spec.md` was written to close: *"WHEN an icon-only `<button>`
is rendered with no `aria-label`, no `aria-labelledby`, and no `title` THEN it is a defect against this
requirement, regardless of which component renders it."* `PanelCard.tsx` is never mentioned anywhere in
`files-modified.md`, `tasks.md`, `evaluation-1.md`, or `evaluation-2.md` — it was missed by the audit in
both cycles because the audit's stated search methodology (grep for `FontAwesomeIcon`/`lucide-react`/
`<svg>`) structurally cannot catch a plain-character glyph button. I widened the search (grep for `×`,
`+`, and other bare-glyph button content app-wide) and this was the only unaddressed instance — every
other `×`/`+`/`−` glyph button found (`DataTypePicker.tsx`, `PanelList.tsx`'s zoom controls,
`SidebarItemList.tsx`/`DashboardList.tsx`'s add buttons) already carries a correct `aria-label`.

### AC traceability

- **AC-1** ("`IconButton` exists in `shared/ui/`, documented in DESIGN.md §5/§6") — **met**. Traced to
  `frontend/src/shared/ui/IconButton.tsx` + `DESIGN.md`'s new §5 subsection + §6 list entry.
- **AC-2** ("Every icon-only interactive element in the app has a visible or accessible tooltip/label")
  — **not met**. `PanelCard.tsx:270-276`'s delete-cancel button is a live, reachable counterexample.

### Verdict: REFUTE

### Change Requests

1. **`frontend/src/features/panels/ui/PanelCard.tsx:270-276`** — the delete-confirmation cancel button
   (`className="panel-grid-card__delete-cancel-btn"`, glyph `×`) has neither `aria-label` nor `title`.
   Add one (matching the sibling `panel-grid-card__delete-confirm-btn`'s pattern is the minimum fix —
   e.g. `aria-label="Cancel delete"` — or migrate both buttons onto `IconButton`/labeled equivalents if
   that's the more consistent choice given this ticket's own stated preference). This is the one
   remaining concrete counterexample to AC-2; fixing it closes the AC.
2. Given this file was missed despite two evaluation cycles' "audited, no change needed" sign-off,
   re-run (or widen) the app-wide sweep once more before the next evaluation pass — specifically to
   catch bare-glyph (non-`FontAwesomeIcon`/`lucide-react`/`<svg>`) icon-only buttons, which is exactly
   the blind spot that let this one through. I did not find any other instance in my own pass, but the
   executor should re-verify with the widened methodology rather than take my single pass as exhaustive.

### Non-blocking notes

- The `IconButton` primitive itself, the DESIGN.md documentation, the cycle-2 regression fix
  (`SidebarItemList.tsx`), and every other migrated call site I spot-checked (light + dark theme,
  `/pipelines` and `/` routes) are sound, behavior-preserving, and match the design/spec artifacts
  exactly — no other defects found. This REFUTE is scoped to the single AC-2 gap above.
- Environmental note (not a defect in this change): this worktree's `scripts/concertino/` directory is
  missing `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh` (gitignored, not copied into the
  worktree — `emit-event.sh`'s own header comment documents this as expected and names the fallback: run
  the main checkout's copy). I invoked the main checkout's copies directly, as that comment prescribes;
  this did not touch any file under review.
