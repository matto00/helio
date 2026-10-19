## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed tree: HEAD 6477341111d4b4ec6d0368e5a1f46e473325f226 (`bug/home-phone-timeline-shift/HEL-1665`; the change dir is untracked). Artifacts reviewed: ticket.md (including "Scope for this run"), proposal.md, design.md, tasks.md, specs/home-page/spec.md, workflow-state.md (C1/C2), and skeptic-design-1/2/3.md. Live source checked: `frontend/src/features/home/ui/{HomeOpeningLine.tsx, PipelineRunsCard.tsx, HomePage.tsx, HomePage.css}`. I started no servers; this is a design gate.

### What I verified (with evidence)

- **cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/home-phone-timeline-shift/HEL-1665`.

- **Round-3 CR1: the placeholder follows the default sentence's line count per width.**
  - (a) Decision 4 makes the placeholder one `--text-2xl` line by default and two `--text-xl` lines inside the existing `@media (max-width: 430px)` block. That block exists at `HomePage.css:735-739` and already sets the sentence to `--text-xl`, so no new breakpoint value is needed.
    - The default sentence's line count is measured first, at 375/430/768/820/1280 (task 2.5).
    - A different count in the 431-768 band falls back to the existing 768/1100 breakpoints. Addressed.
  - (b) Both false claims are corrected:
    - ticket.md Scope now reads "two lines at ≤430px, one line above — measured first".
    - design Context now reads "two lines at 375/430 … one line at 820/1280". Addressed.
  - (c) Decision 6's precondition is "the default line count for that width (Decision 4's measured count)". It no longer asserts two lines at 1280. Addressed.
  - (d) Spec:
    - The condition now reads "for a user with … the default opening sentence ("All quiet: …")".
    - The placeholder is "two lines in the phone layout, one line above it".
    - The bound is "a different number of lines from the default".
    - The scenario's WHEN clause names the default sentence.
    - The bound scenario is "three lines at 375px (one more than the default there)". Addressed.
  - (e) The mutation "apply the phone two-line placeholder rule at desktop (the 1280 case must go red)" is present in both design Decision 6 and task 3.2. Addressed.

- **Round-3 CR2: proposal contradictions.**
  1. Bullet 2 now says "the default sentence's height at that width (two lines on phones, one line above)". Addressed.
  2. Bullet 1 now attributes head stability to "a shelf-only `min-height`", and treats the expander as a separate change. Addressed.
  3. Impact now lists `DashboardShelf.tsx`, `PipelineRunsCard.tsx` and `HomeOpeningLine.tsx` without the "only if" hedge. Addressed.
  4. Impact now states the zero-dashboard exception (up to ≈6px), matching the spec's "MAY be up to the link's line-box difference taller". Addressed.
  5. `grep owner-approved` returns no hits in the non-skeptic artifacts. Addressed.

- **Round-3 CR3:** design Goals now says "for the shelf and the default opening sentence". Addressed.

- **Round-3 non-blocking notes:**
  - The one-failed-run residual is acknowledged generically in the ticket Scope.
  - Task 3.5 hands off "sentence line count", and task 3.7 is now the mechanical disposition check (C2).
  - Side-card pinning was not added. It is still unnecessary because `.home-page__grid` is `align-items: start`, and the runs card comes first in DOM order (`HomePage.tsx`, where `PipelineRunsCard` precedes `.home-page__side`). The side column therefore cannot move the runs card.

- **Rounds 1-2 still hold against the live tree:**
  - The runs head is `.home-section__head` inside `.home-card-panel`, not inside `.home-section` (`PipelineRunsCard.tsx`). So the shelf-only selector `.home-section > .home-section__head` in Decision 1a does not reach the runs head.
  - The legend is gated on `summary !== null && summary.pipelines.length > 0`. Decision 3 targets exactly that gate.
  - The opening skeleton is the inline `height="28px"` (`HomeOpeningLine.tsx`). Decision 4 replaces it with a class and keeps `role="status"` / "Loading summary".
  - The touch block `.home-section__link { display: inline-flex; min-height: 44px }` is at `HomePage.css:742-765`, as the design cites.

- **Cross-artifact consistency:**
  - ticket Scope, proposal, design Goals/Decisions, spec and tasks now agree on four points: the per-width line count, shelf-only scoping, the legend shown while loading, and the item-2 park with the C2 disposition.
  - C1 and C2 are restated verbatim at the top of tasks.md.
  - I found no remaining contradiction.

### Verdict: CONFIRM

### Non-blocking notes

- Task ordering: task 1.2 writes the spec with a "default line count" precondition, but the per-width count is not measured until task 2.5. Measure it in 1.x, for example alongside task 1.1, so that the red-first run's precondition is grounded rather than assumed.
- `.home-opening__sentence` uses `--font-heading`. A web-font swap after first paint could re-wrap the sentence or change its line box. The per-frame probe (Decision 5) would catch it, but the evidence should say whether the font was already loaded at first paint in each run.
- Desktop: while loading, the one-line placeholder (`--text-2xl` × 1.25 ≈ 30px) replaces the 28px skeleton. That is intended and does not change the settled layout, so C1 is unaffected. The PR body's "UI decisions taken overnight" list should mention it.
- The PR body should name the one-failed-run residual explicitly. On phones, "One run failed, everything else is quiet." is one line, so the timeline still moves up by one sentence line on load.
