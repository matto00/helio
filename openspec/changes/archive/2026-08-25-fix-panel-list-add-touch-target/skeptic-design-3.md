## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- **Read all artifacts fresh** (`cat` of proposal.md, design.md, tasks.md,
  specs/panel-list-mobile-touch-targets/spec.md, ticket.md) — no reliance on
  rounds 1/2 narratives.

- **CR from round 2 (width floor stated consistently) — RESOLVED.**
  - spec.md requirement title is now "Panel-list controls meet the mobile
    touch-target floor" (no "header"), and the requirement text reads
    "SHALL render at least 44px tall and 44px wide".
  - spec.md zoom-widget scenario: "rendered heights AND widths are both >= 44px".
  - design.md Decision 2: "floors both `min-height: 44px` and `min-width: 44px`".
  - tasks.md 3.2: "Add `min-height: 44px` AND `min-width: 44px`"; 1.2 and 4.2 both
    measure `.height` AND `.width`. Four artifacts now agree on both axes.

- **Location fix accuracy — VERIFIED against the file, not the claim.**
  `cat -n frontend/src/features/panels/ui/PanelList.css`:
  - Lines 162-171 are `@media (max-width: 768px)` containing `.panel-list`
    (padding/min-height) and `.panel-list__header { flex-direction: column }` —
    exactly as design.md now describes.
  - Line 189 block is `@media (max-width: 768px) { .panel-list__zoom-widget {
    bottom: calc(var(--bottom-nav-height) + var(--space-3)) } }` with the HEL-774
    comment above it — exactly "only scopes .panel-list__zoom-widget's bottom
    clearance". Correction is accurate.

- **Decision 2's factual premises — VERIFIED.**
  - `.panel-list__zoom-button, .panel-list__zoom-reset` (116-133): `height: 22px`,
    no width; `.panel-list__zoom-button` (135-138): `width: 22px; padding: 0`.
    design.md's parenthetical ("`.panel-list__zoom-button` is also `width: 22px`")
    correctly qualifies which selector carries the width.
  - `@media (max-width: 430px) { .panel-list__zoom-widget { display: none } }` at
    175-179 — confirms the 431–768px visible band and why tasks 4.2 forbids
    measuring at 430px (would read 0×0).
  - `.panel-list__count` (line 34) exists and is a badge — valid discriminator.
  - Cascade soundness: `min-width` beats `width` in the used-value computation
    regardless of specificity, so flooring the 22px `width` works; and the new
    rules land after the base rules (162+ > 138), satisfying the HEL-535 lesson.

- **Convention reference — VERIFIED.** `EmptyState.css:217-228` is indeed the
  `@media (max-width: 768px) { .ui-empty-state__cta { min-height: 44px } }` floor,
  placed after the base rules.

- **Normative rule — VERIFIED.** DESIGN.md "Control metrics" (≈lines 198-201):
  "interactive controls reachable on phone ... get a literal `44px`
  min-height/min-width tap-target floor" — the both-axes reading the artifacts
  now encode is correct on the merits, and the min-height floor (not `::after`)
  is the right branch here since these controls may grow.

- **AC coverage traced:** AC1 → tasks 2.1; AC2 → 3.1/3.2; AC3 (measurement +
  discriminator) → 1.1/1.2/4.1/4.2/4.3; AC4 (::after not used) → Decision 1;
  AC5 (guard scope call) → Decision 3 + task 5.1 (escalate, not silently drop).
  No AC uncovered; no task outside the ticket's scope.

- **No placeholders/TODOs/TBDs** in any artifact; no internal contradictions found
  on re-read.

### Verdict: CONFIRM

The round-2 change request is fully resolved and the location correction is
factually accurate against the file. The plan is internally consistent and
implementable as written.

### Non-blocking notes

- **DESIGN.md section citations are off (inherited from the ticket).** The 44px
  floor text lives in the "Control metrics" subsection of **§3 Tokens**
  (DESIGN.md:196-201), not §5 (Buttons, starts line 273) or §8 (Accessibility
  baseline, line 378) — I grepped both sections and neither contains "44"/"tap"/
  "touch". design.md Decision 2 says "DESIGN.md §5's touch-target floor" and
  proposal.md says "DESIGN.md §8". The substantive rule they cite is correct; only
  the section pointer is wrong. Not implementation-blocking.
- proposal.md's "What Changes" still describes the sibling fix as "fix any found
  the same way" (i.e. framed around `min-height`). design.md/tasks.md/spec.md all
  make the both-axes requirement explicit, so no implementer would miss it, but a
  one-line "(both axes for the zoom buttons)" in the proposal would make the
  summary self-consistent.
- `.panel-list__zoom-reset` has no declared `width`; its rendered width may already
  exceed 44px from padding + label. Tasks 1.2/4.2 measure it either way, so this is
  handled — just don't be surprised if its baseline reading is not ~22px wide.
