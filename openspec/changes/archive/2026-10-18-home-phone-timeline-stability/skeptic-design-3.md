## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD 6477341111d4b4ec6d0368e5a1f46e473325f226 (`bug/home-phone-timeline-shift/HEL-1665`; the change dir is untracked). Artifacts reviewed: ticket.md (including "Scope for this run"), proposal.md, design.md, tasks.md, specs/home-page/spec.md, workflow-state.md (C1/C2), skeptic-design-1.md and skeptic-design-2.md. I did not start any servers. The ground truth is the live source plus HEL-1642's persisted screenshots. `git diff 08e65e17e HEAD` is empty for `HomePage.css`, `HomeOpeningLine.tsx` and `theme.css`, so those screenshots still show this code. That is a content-identity check, not an mtime inference.

### What I verified (with evidence)

- **cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/home-phone-timeline-shift/HEL-1665`.
- **Round-1 revisions**
  - CR1 (§4): parked. Decision 0 names the rule. Addressed.
  - CR2 (head height): Decision 1a now uses a token-derived shelf-head `min-height`. Addressed.
  - CR3 (arithmetic): the Context now reads ≈84px / ≈648 / ≈49px. Addressed.
  - CR4 (content bound): the spec states the bounds, and the design lists the card foot, the legend and the opening line. Addressed, except for the false line-count premise in CR1 below.
  - CR5 (per-frame sampling, both resolution orders): Decision 6. Addressed.
  - CR6 (pinned base): C1, and Decision 6 pins on base. Addressed.
- **Round-2 revisions**
  - CR1(a): scoped to `.home-section > .home-section__head` or a modifier class. Addressed. This works because `PipelineRunsCard.tsx:30` puts the runs head inside `.home-card-panel`, not `.home-section`.
  - CR1(b): the runs-card head and the first timeline row are now pinned. The side cards are not, but `.home-page__grid` (`HomePage.css:180-185`) is `align-items: start`, so their tops equal the runs-card top, which is already pinned. Effectively addressed (see note).
  - CR1(c): the zero-dashboard exception is stated in the spec. Addressed in the spec and design, but the proposal still contradicts it (CR2.4).
  - CR2: the legend is listed as a mover and shown while loading (Decision 3, matching `PipelineRunsCard.tsx:34`, where the legend is gated on `summary !== null`). The content start is sampled, and the spec names both edges. Addressed.
  - CR3(a)/(b)/(c): a bound-case e2e and a line-count precondition were added. The premise behind them is wrong at desktop (CR1 below).
  - CR4(a)-(d): the Context is corrected, Decision 0 lists the clamp option with the dvh/svh reasoning, task 3.5 adds a hand-off, and C2 plus the ticket's "Disposition" cover the PR wording and the AC2 judgement. Addressed.
- **The default sentence is ONE line at desktop, not two.**
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1642/evidence/home-1280-light-viewport.png` renders "All quiet: nothing has changed, failed or been missed." on a single line, x≈80→659 (≈579px). `home-820-light-viewport.png` shows the same single line at 820.
  - Why it fits: `.home-opening__sentence` is `max-width: 40ch` at `--text-2xl` (24px), with line-height 1.25 (`HomePage.css:26-35`). At ≤430 it drops to `--text-xl` (`HomePage.css:735-739`).
  - Phones (derived from the same screenshot, ≈10.7px/char at 24px, so ≈8.9px/char at 20px): the sentence needs ≈482px against ≈351px available at 375 and ≈406px at 430. So two lines on phones is correct.
  - The claim of "two lines at 375, 430 **and 1280**" (ticket.md Scope) and "two lines at phone **and desktop** widths" (design Context) is false at 1280.
- **The fixture sentence is reachable.** `buildSummarySentence.ts` gives the "All quiet" default when the changed, failed, stuck and missed counts are all 0. HEL-1642's 1280 screenshot shows it with four freshly seeded dashboards, so new dashboards do not count as "changed". A three-line bound case is reachable at 375 with the changed + failed + stuck clauses.
- **Spec delta:** the MODIFIED header matches `openspec/specs/home-page/spec.md:165` verbatim, and the original paragraph and scenarios are carried over unchanged.

### Verdict: REFUTE

Item 1's mechanism and the item-2 park are sound, and every round-1 and round-2 revision is genuinely reflected in the design. But Decision 4 rests on a premise that the persisted 1280 screenshot disproves. As written, it would introduce a ≈30px desktop load shift that the base does not have. Base is 28px skeleton → 30px line, ≈2px. And the planned 1280 shift test cannot go green, because its two-line precondition is false at 1280. The proposal also still carries stale text that contradicts the design.

### Change Requests

1. **Decision 4, ticket.md Scope, design Context, Decision 6 and the spec: the placeholder line count must follow the default sentence's line count at each width, not "two lines" everywhere.**
   - The default sentence is one line at 1280 and 820 (screenshots above) and two lines at ≤430.
   - Required:
     - (a) Size the placeholder per canonical breakpoint, all tokens and no new breakpoint value: two sentence lines inside the existing `@media (max-width: 430px)` block, and one sentence line otherwise. Measure, and record in evidence, the default sentence's line count at 375, 430, 768/820 and 1280 before choosing.
     - (b) Correct the false "two lines at … 1280" in ticket.md "Scope for this run" and "phone and desktop widths" in design Context.
     - (c) Decision 6's precondition becomes "the settled sentence has the default's line count for that width": 2 at 375/430, 1 at 1280. Do not assert two lines at 1280×900.
     - (d) Rewrite the spec's "for a user with … a two-line opening sentence" condition and the "Timeline does not move on load" scenario WHEN clause as "with the default (all-quiet) opening sentence". State its line counts per width, or the reserved height per width range.
     - (e) Add a mutation to task 3.2 that would catch this class of error: the phone two-line rule applied at desktop must turn the 1280 shift case red.

2. **Stale contradictions in proposal.md (the brief asked for these to be flagged; each contradicts design.md or spec.md):**
   1. "What Changes", bullet 3, says "the opening line's placeholder equals one sentence line". Design Decision 4 says two lines. After CR1, the correct wording is "per width".
   2. "What Changes", bullet 1, says the expander alone means "the shelf head's height then no longer depends on whether the link is rendered". That is the round-1 misreading (the link's 21px line box against the eyebrow's 15px). Merge it with bullet 3 and attribute head stability to the shelf-head `min-height`. This was a round-2 note and is still unfixed.
   3. "Impact" says "possibly `DashboardShelf.tsx` / `PipelineRunsCard.tsx` / `HomeOpeningLine.tsx` (only if the probe finds a contributor there)". Decisions 2-4 now definitely edit all three, so state that.
   4. "Impact" says "Desktop (fine pointer, >768px) Home layout is unchanged". The spec allows the zero-dashboard shelf head to be up to ≈6px taller at desktop. Add the same exception.
   5. "Why/What Changes" says "the owner-approved HEL-1642 phone shelf". Round 2 could not verify the "owner-approved" label from the tree. Say "shipped" instead.

3. **design.md Goals is stale.** It says the timeline "moves 0px … for the shelf and **a one-line opening sentence**". That contradicts Decision 4 and the spec, which both say two lines. Align it with the per-width wording from CR1.

### Non-blocking notes

- Round-2 CR1(b) asked for the side cards' tops to be pinned. With `align-items: start`, the pinned runs-card top already fixes them at 1280. Pinning `.home-page__side`'s first card top costs nothing and documents this.
- After CR1, a user with one failed run sees "One run failed, everything else is quiet." on one line at 375 (HEL-1642 `home-375x667-light-viewport.png`). On phones, then, the most common non-quiet state still moves by one line. The item-1 residual in the task 3.5 hand-off should name this explicitly, and so should the PR body.
- The disposition has no checkbox in tasks.md. C2 plus the ticket's "Disposition" paragraph are adequate, but a one-line task 3.7 ("PR body references HEL-1665 without a closing keyword; verify the Linear state after merge") would make the final gate's check mechanical.
