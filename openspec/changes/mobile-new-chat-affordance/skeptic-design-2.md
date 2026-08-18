## Skeptic Report — design gate (round 2, skeptic-design-2.md)

This is a fresh, from-scratch review of the CURRENT files on disk, superseding
`skeptic-design-1.md` (which CONFIRMed the pre-correction plan, before the user's
mid-planning correction redirected the investigation to Finding B). I did not read
`skeptic-design-1.md`'s verdict as evidence for this round — only as a pointer to
what changed since (workflow-state.md's log entry corroborates the same history).

### What I verified (with evidence)

1. **"Open assistant" quick-launcher is an overlay, not a route nav — CONFIRMED.**
   `frontend/src/app/CommandBar.tsx:224-233`: the `faComments` `IconButton` has
   `aria-label="Open assistant"`, `onClick={onOpenQuickLauncher}`. Its consumer,
   `frontend/src/features/assistant/ui/QuickLauncherOverlay.tsx:71-78`, renders
   `<Modal open={open} onClose={onClose} title="Assistant" size="lg" ...>` from
   `shared/ui/Modal.tsx`. Matches design.md D4's first bullet exactly.

2. **"Review proposal" routes through the destination page's own `Modal` — CONFIRMED
   for all four kinds, not just the three named in D4.** `ProposalHandoff.tsx:40-127`
   does a plain `navigate(path, {state})` for all four `extraction.kind` branches
   (dashboard → `/proposals/review`, patch → `/patch-sets/review`, pipeline →
   `/pipeline-proposals/review`, combined → `/combined-proposals/review`), no overlay
   itself. Read all four destination render components directly:
   - `ProposalReview.tsx:92-99` → `<Modal open ... size="lg" ...>`
   - `PipelineProposalReview.tsx:49-57` → `<Modal open ... size="lg" ...>`
   - `CombinedProposalReview.tsx:101-109` → `<Modal open ... size="lg" ...>`
   - `PatchSetReview.tsx:90-97` → `<Modal open ... size="lg" ...>`
   Confirmed via `AppRoutes.tsx:99-116` that all four routes map to the corresponding
   `*ReviewPage` components, which in turn render these four `*Review` components
   (`grep` confirmed each `*ReviewPage.tsx` imports and renders its `*Review` sibling).
   Both reported trigger flows genuinely converge on the same shared `Modal` primitive.

3. **`Modal.tsx`/`Modal.css` genuinely touched in today's batch — CONFIRMED.**
   `git log --oneline -- frontend/src/shared/ui/Modal.tsx frontend/src/shared/ui/Modal.css`
   shows `c6105095 HEL-718` (current HEAD) and `cccbdba3 HEL-716 Extend Modal size
   scale and retire hand-rolled dialog lifecycles` as the two most recent touches,
   both same-day (`git log -1 --format="%ad"` on `c6105095` = `Tue Aug 18 15:00:55
   2026 -0700`), consistent with ticket.md's "right after today's 7-ticket batch."

4. **D5's two candidate mechanisms are grounded in the real CSS, not fabricated.**
   Read `Modal.css` in full: `.ui-modal` (line 3-12) sets only `max-height: 90vh`, no
   explicit `height`, matching D5#1's premise. `.ui-modal__inner` (line 62-80) is
   `height: 100%`, and the in-file comment (lines 62-75) literally reads "HEL-716
   (skeptic-final-3.md): this must fill whatever height the actual `<dialog>` box
   ends up with... previously left `.ui-modal__inner` sizing itself up to its own
   independent 90vh... at any viewport taller than ~756px, this grew the inner flex
   column past the dialog's real (680px) height... clipped" — this is a verbatim
   match for design.md's D5#1 description of "a prior HEL-716 skeptic round already
   patched one instance of this class of bug... for a different symptom." Not
   invented. D5#2 (mobile `vh`/dialog-centering) is stated as an untested hypothesis,
   appropriately hedged ("Neither is asserted as confirmed") rather than asserted as
   fact — correct posture for a design document, not hand-waving.

5. **tasks.md section 1 correctly sequences reproduce-then-fix.** 1.1/1.2 (reproduce
   both flows live with screenshot/console/computed-style capture) precede 1.3
   (compare), 1.4 (identify mechanism from the concrete numbers), 1.5 (fix). No
   jump-to-fix on the static hypothesis alone. 1.7 has an explicit escalate-don't-
   silently-close fallback if live evidence doesn't reproduce.

6. **Finding A / Finding B scope separation is clean throughout** — ticket.md's
   Correction section, proposal.md's "What Changes"/"Impact", design.md's
   Goals/Decisions (explicitly labeled "Finding A"/"Finding B" per bullet), and
   tasks.md's section headers ("Finding B... priority — do first" / "Finding A")
   all keep the two findings distinct with no conflation. tasks.md 4.1 explicitly
   requires documenting them "as separate root causes, never conflated."

7. **CommandBar's "Open assistant" icon is genuinely reachable/unhidden on mobile**,
   which the Finding B premise depends on. `App.css`'s `@media (max-width: 768px)`
   block (read in full) hides `.undo-redo-btn`, `.dashboard-appearance-editor`, and
   `.app-command-bar .save-state-indicator` — but has no rule hiding the quick-
   launcher/theme-toggle `IconButton`s. Consistent with design.md D1's claim that
   this control is "genuinely unconditional."

### A real defect found: tasks.md 1.6's "widen the audit" spot-check list is wrong

design.md D6 step 5 states "Modal has 14 consumers today" and names 15 of them (a
first inaccuracy — the count doesn't match its own list), directing the audit to
"spot-check at least the size=\"lg\"/\"xl\" ones." I enumerated every file that
renders `<Modal` directly (excluding the primitive and tests):
`grep -rln '<Modal' frontend/src --include="*.tsx" | grep -v test | grep -v shared/ui/Modal.tsx`
→ **16 files**, one full point higher than design.md's own list (`MfaEnrollModal.tsx`
is a real 16th consumer, entirely absent from D6's named list).

I then read each Modal invocation's actual `size` prop directly (not grepped
in isolation — read the surrounding JSX to confirm it's the `Modal`'s own prop):

| Component | Actual `size` |
|---|---|
| QuickLauncherOverlay | `lg` |
| ProposalReview | `lg` |
| PipelineProposalReview | `lg` |
| CombinedProposalReview | `lg` |
| PatchSetReview | `lg` |
| PanelCreationModal | `lg` |
| **CreateMetricModal** | **`lg`** |
| **PipelinePreviewModal** | **`lg`** |
| **RunHistoryModal** | **`lg`** |
| PanelDetailModal | `full` (view mode) / `md` (edit mode) |
| **CreatePipelineModal** | **`sm`** |
| **ShapePickerModal** | **`sm`** |
| PipelineScheduleDialog | `sm` |
| PipelineShareDialog | `md` |
| MfaEnrollModal | `md` |
| AddSourceModal | `md` |

`tasks.md` §1.6's concrete spot-check list is: *"PatchSetReview, PanelDetailModal,
PanelCreationModal, CreatePipelineModal, ShapePickerModal, at minimum"* — under the
explicit banner "Spot-check the `size=\"lg\"/\"xl\"` Modal consumers." But two of
those five named items (`CreatePipelineModal`, `ShapePickerModal`) are **actually
`size="sm"`**, and the list **omits three genuinely `size="lg"` consumers**
(`CreateMetricModal`, `PipelinePreviewModal`, `RunHistoryModal`) that design.md's
own D6 inventory lists by name one paragraph earlier in the same document.

This is not cosmetic. tasks.md is the operative, literal checklist an executor
follows — that's its purpose as distinct from design.md's prose. A faithful
execution of §1.6 as written would spend effort re-testing two `sm` modals
unlikely to hit a height-collapse-style regression (D5's mechanisms are about an
oversized/undersized flex-column body relative to the dialog box, not primarily a
width concern) while never touching three real `lg` consumers that are exactly the
class of consumer D6's own selection criterion says to prioritize. Given the
user's explicit mid-planning ask — "widen the check to any other action routing
through the same component" — this directly undercuts the one part of the plan
built specifically to satisfy that ask. It's a genuine internal contradiction
between design.md's own consumer inventory and tasks.md's concrete instruction
(the "Internal contradictions" / "Ambiguity" categories this gate exists to catch),
not a matter of subjective taste, and it's cheap to fix now versus discovered after
an executor has already "completed" an audit that quietly skipped the highest-risk
consumers.

### Verdict: REFUTE

The core hypothesis (D4), the CSS-grounded candidate mechanisms (D5), the
live-verify-before-fix procedure (D6/tasks §1.1-1.5), and the Finding A/B scope
separation are all sound and evidence-grounded — I could not fault any of them
against the actual source. The one substantive defect is narrow but concrete and
directly relevant to the priority track's explicit purpose.

### Change Requests

1. **Fix `tasks.md` §1.6's spot-check list to match the actual codebase.** Replace
   `CreatePipelineModal` and `ShapePickerModal` (both genuinely `size="sm"`, not
   `lg`/`xl`) with the three real `size="lg"` consumers the list currently omits:
   `CreateMetricModal`, `PipelinePreviewModal`, `RunHistoryModal`. If the executor
   wants to keep the two `sm` ones as extra insurance that's fine, but the "at
   least the size=lg/xl ones" criterion must actually be satisfied by the named
   list, not just by the word "minimum." Also decide explicitly whether §1.6
   intends to spot-check all three of `ProposalReview`/`PipelineProposalReview`/
   `CombinedProposalReview` (only one of the four `ProposalHandoff` kinds is
   guaranteed to be exercised by §1.2's single repro) or just `PatchSetReview` as
   currently named — as written, two of those four `lg` review Modals could go
   completely untested across the whole task list.
2. **Correct design.md D6 step 5's consumer count/list** (`frontend/src/shared/ui/Modal.tsx`
   is imported by 16 files total, not "14" — `MfaEnrollModal.tsx` is missing from
   the named inventory, size `md` so it doesn't change the lg/xl spot-check scope,
   but the stated count should be accurate since it's the number the "widen the
   audit" step's completeness is being judged against).

### Non-blocking notes

- `PanelDetailModal`'s `size` is conditional (`full` in view mode, `md` in edit
  mode) — worth the executor explicitly testing it in **view** mode (the `full`
  variant) at 390×844, since that's the size that actually falls in the
  "large/most-likely-to-collapse" bucket D6 is targeting; `tasks.md` doesn't
  currently say which mode to test.
