## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 6477341111d4b4ec6d0368e5a1f46e473325f226 (`bug/home-phone-timeline-shift/HEL-1665`, equal to origin/main; the change dir is untracked). Artifacts: ticket.md (including "Scope for this run"), proposal.md, design.md, tasks.md, specs/home-page/spec.md, and skeptic-design-1.md. No servers were started. Pixel figures below come from the live CSS and tokens and from HEL-1642's persisted evidence (`/home/matt/Development/helio/.concertino/runs/HEL-1642/evidence/`). Where a figure is derived rather than measured, I say so.

### What I verified (with evidence)

- **The cwd guard passed:** `READY ambient=/home/matt/Development/helio branch=bug/home-phone-timeline-shift/HEL-1665`.
- **Parking item 2 is sound.**
  - DESIGN.md:466-470 says: "Canonical set … 1440 / 1100 / 768 / 430. CSS media queries use these values only … [mechanical]". A `max-height` query amends a mechanical rule, so it is not an overnight reversible decision.
  - The phone-wide thumbnail shrink changes the ≤430 shelf that HEL-1642 just shipped (DESIGN.md:1117-1119, [judgment]).
  - I also weighed the third option, which the design does not mention (see CR4): a viewport-unit clamp on `.home-thumb` inside the existing `max-width: 430px` query. It is not clearly low-risk either. A `dvh` clamp resizes the thumbnails whenever mobile browser chrome shows or hides, which would create a new layout shift, the very defect this ticket exists to fix. An `svh` clamp binds on most in-browser phones (about 548px tall), so in practice it shrinks the shipped shelf for browser users.
  - So no item-2 option is clearly reversible and low-risk, and parking follows the driver brief.
  - One correction: I could not verify the "owner-approved" label on the HEL-1642 shelf from the tree. The merge commit and DESIGN.md only show that it was merged ([judgment]). Parking does not depend on that label.
- **Round-1 CR1 (§4) is addressed by parking.** Decision 0 names the §4 rule.
- **Round-1 CR2 is addressed for the shelf head.** Decision 1a adds a token-derived head `min-height` (link line box ≈ 14 × 1.5 = 21px; `theme.css:37`, body line-height 1.5). Decision 1b uses the §3 `square` expander. But the class is shared (see CR1 below).
- **Round-1 CR3 (arithmetic) is not corrected.** The design's Context bullet 2 still says "≈68px … first row's bottom ≈632px, ~33px behind the nav". Round 1 showed the first label wraps to two lines (≈84px, bottom ≈648). It no longer drives a build decision, but these numbers are what goes to the owner (CR4).
- **Round-1 CR4 is partly addressed.** The spec now states a content bound, and Decisions 2 and 3 name the card foot and the opening line. The bound itself is untested, and its reach is understated (CR3 below).
- **Round-1 CR5 is addressed.** Decision 5 adds per-frame rAF sampling, both resolution orders, and a ≤0.5px tolerance.
- **Round-1 CR6 is addressed.** C1 pins the 1280 boxes on base 647734111, and the same-run option is removed. But the pinned set misses the change the design itself introduces (CR1).
- **`.home-section__head` is shared.** `PipelineRunsCard.tsx:30` uses it for the runs card head, alongside `DashboardShelf.tsx:33`. NeedsAttention and UpNext use only `.home-section__title` (no head wrapper).
- **The runs-card legend wraps on phones.** `TimelineLegend` (`RunTimeline.tsx:21-38`) has four mono `--text-xs` items: ok / failed / running / scheduled. It mounts only when `summary.pipelines.length > 0`; the loading head is the eyebrow alone. In HEL-1642's `home-375x667-light-viewport.png`, the eyebrow "PIPELINE RUNS · LAST 24H" sits at y≈509 and the legend sits on its own row at y≈539. The same screenshot shows `timelineTop` = 563.8 (`home-375x667-light.json`). HEL-1642 defines that as the list `[aria-label="Pipeline runs, last 24 hours"]`, not the card.
- **The empty-pipelines runs head is eyebrow-only.** HEL-1642's `home-1280-light-viewport.png` shows the runs card head with the eyebrow alone ("No pipeline runs yet" state).
- **The opening sentence's templates** (`buildSummarySentence.ts`): the zero-attention default is "All quiet: nothing has changed, failed or been missed." (54 characters). The fixture sentence "One run failed, everything else is quiet." (41 characters) spans about x=12→362 at 375 in the HEL-1642 screenshot, against about 351px available. That is about 8.5px per character at `--text-xl`.
  - *Derived:* the 54-character default needs about 460px, so it wraps to two lines at 375 (351px available) and at 430 (about 406px available).
  - At 1280 it is one line: the HEL-1642 1280 screenshot shows it single-line, spanning x≈80→660.
- **Skeletons.** The shelf skeleton foot is `<Skeleton variant="line" width="60%" />` with the default line height (`DashboardShelf.tsx:51`). The opening skeleton is an inline `height="28px"` (`HomeOpeningLine.tsx:28`). The runs skeleton is 4 × 20px lines (`PipelineRunsCard.tsx:37-41`). These match the design's contributor list.
- **Touch probe.** `e2e/support/touchTargetProbe.ts:160-268` already has an `elementFromPoint` bisection for `::after` expanders, so Decision 1b's bisection can reuse it.

### Verdict: REFUTE

Parking item 2 is sound, and the item-1 mechanism (head reservation, §3 expander, skeleton parity, per-frame probe, pinned base) is the right shape. But item 1 is not complete or correct on its own:
- Its main CSS change lands on a shared class and alters desktop layout that the pins do not cover.
- It ignores a ≈34px movement inside the timeline card on phones, measured on an element other than the one HEL-1642 defined as "the timeline".
- The content bound in the spec is honestly worded, but its reach is understated and it is not tested.
- The parked item has no hand-off or merge disposition in the tasks.

### Change Requests

1. **Decision 1a puts `min-height` on a shared class and changes Home's settled desktop layout, which C1's pins cannot detect.**
   - `.home-section__head` is also the runs-card head (`PipelineRunsCard.tsx:30`). At 1280 that head settles at the legend's line box (12 × 1.5 ≈ 18px, derived), or the eyebrow's (≈15px) when there are no pipelines (the state in HEL-1642's 1280 screenshot). A 21px `min-height` therefore pushes the runs card's content down about 3–6px on desktop.
   - That contradicts the spec ("Home's settled layout at desktop width … SHALL be unchanged") and the proposal's Impact ("Desktop … unchanged").
   - C1 pins only the opening line, shelf head, shelf and runs card **top**, so it stays green while the runs card's content moves.
   - Separately, the design's own Risks section accepts a +6px settled change to the empty-dashboards head at every width. That also contradicts the spec's unconditional "unchanged".
   - Required:
     - (a) Scope the reservation to the shelf head only, for example `.home-section > .home-section__head` (the runs card is `.home-card-panel`, not `.home-section`) or a modifier class. Alternatively, justify the runs-head change and pin it.
     - (b) Add to the C1 pinned set the runs-card head box and the first timeline row or list top at 1280, and the side cards' tops.
     - (c) Reconcile the empty-dashboards +6px with the spec, either by stating it as an exception or by avoiding it.

2. **The runs-card legend mount is an unlisted mover, and the probe cannot see it, because the design measures a different element from the one HEL-1642 calls "the timeline".**
   - While loading, the runs head is the eyebrow only. Once loaded with pipelines, `TimelineLegend` mounts. At 375 it wraps onto its own row (HEL-1642 screenshot: eyebrow y≈509, legend y≈539). So the card's content start (the skeleton's first bar, then the list) drops by about 34px on every phone load, and by about 3px at 1280 (derived from line boxes and `--space-4` gaps).
   - The design samples only `.home-runs` (the card) top, so this passes at "0px".
   - HEL-1642's evidence and spec define `timelineTop` as the `[aria-label="Pipeline runs, last 24 hours"]` list. The ticket's AC2 numbers (563.8 vs 599) use that definition. The ticket's AC1 says "the timeline moves by 0px".
   - Required:
     - (a) List the legend as a contributor in Decision 4/Context with its measured px.
     - (b) Sample the runs content start as well as the card top: the first `.home-runs__skeleton` child while loading, then the list.
     - (c) Either reserve the legend row in the loading head, or state the movement in the spec's bound with the px and the reason. For example, the legend is absent for a user with no pipelines, so reserving it is content-dependent.
     - (d) Make the spec scenario name exactly which edge is held at 0px.

3. **The opening-sentence bound is honestly worded, but it understates the gap and is not tested.**
   - (a) **Disclose its reach.** The zero-attention default sentence (54 characters) is derived to wrap to two lines at both 375 and 430. So for the ordinary "nothing happened" Home on phones, the timeline still moves by one sentence line (≈25px) on every load. The ticket's scope note and Decision 3 present this as an edge case ("longer than one line"). Measure the line count of the default and of the longest common template at 375, 430 and 1280. Record it in evidence and in the owner residual note. The owner needs to know the AC is not met in the default state on phones.
   - (b) **Test the MAY clause.** Add an e2e case with the all-quiet (two-line on phones) fixture. Assert the maximum per-frame deviation equals exactly the extra lines' height (± sub-pixel), and that nothing else moves. Untested, "by the height of the additional lines only" is a bound in name only.
   - (c) **Assert the one-line precondition in the 0px case.** Check that the loaded sentence's height equals one line box. The chosen fixture fills about 350 of 351px at 375. A fallback-font paint, or a later copy tweak, could wrap it and turn the test red, or make it pass for the wrong reason. Prefer a fixture with margin, and record its text and line count per viewport.

4. **The parked item has no task, no corrected hand-off, and no merge disposition.**
   - The ticket says "Options and measurements go to the owner via the driver", but no task produces them.
   - Design Context still carries the round-1-refuted arithmetic (≈68px row, ≈632 bottom, ≈33px).
   - Decision 0 says the phone-wide shrink is "the only width-only alternative". It omits the viewport-unit clamp named in round-1 CR1(a), and its dvh/svh caveats (above).
   - AC2 and its share of AC3 are covered by no task. Nothing says how the final gate should treat AC2, or how the merge avoids completing HEL-1665 with AC2 unmet. Under `AGENT_MERGE: true`, branch/PR linking may move the issue to Done.
   - Required:
     - (a) Correct or remove the Context arithmetic, using measured numbers (first-row height and label at 375×667).
     - (b) List every item-2 option in Decision 0, including the viewport-unit clamp and why it was rejected.
     - (c) Add a task that writes the owner hand-off to evidence. It should contain: the options, the post-item-1 measured first-row bottom against the nav top at 375×667 in light and dark, and the opening-sentence and legend residuals from CR2/CR3.
     - (d) Add a task stating the disposition: PR body wording (references, not closes), HEL-1665 kept open or a follow-up ticket for item 2, and the statement the final gate uses for AC2 ("parked per driver brief; hand-off artifact present").

### Non-blocking notes

- Decision 1b can reuse `touchTargetProbe.ts`'s existing bisection instead of a new one.
- Task 3.1: also run `e2e/hel1578-home-page.spec.ts`. `HomePage.test.tsx:120` asserts the "Loading summary" status, so keep that accessible name when the placeholder changes.
- The proposal's first "What Changes" bullet still claims the expander alone makes the head height link-independent. The third bullet fixes it; merge the two to avoid the round-1 misreading.
- Decision 3's placeholder should use a class with tokens, not the inline `height` prop (DESIGN.md §0 "Apply styles via className").
