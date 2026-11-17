## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD 7d9b2ea2d47f9ed0c57dddfdaf4fcfb4dd90317d. The only change is the untracked change dir, which holds planning artifacts only (`git status --short`).

### What I verified (with evidence)

- **Round 2 CR 1 (the 605-615px band contradiction) is addressed.**
  - The `specs/home-page/spec.md` prose now bounds the swap at the discrete widths 375, 430, 480, 540, 620, 1024 and 1280px. It requires the same line count only "at those widths", and states that "at other widths (for example the 605-615px band ...) the swap MAY be larger", with the 610px figure recorded in the evidence. This matches the scenario "Cold-load web-font swap is bounded", which uses the same seven widths.
  - D6 no longer claims the text is "already worded per asserted width" while it was not. It now says the delta is worded per asserted width with the band as an explicit MAY. If step 6 shows the band closed, the MAY stays and the PR says so. If it did not close, the 610px number goes in the evidence and the PR body. That is now consistent with the delta.
- **Round 2 non-blocking notes were taken up.**
  - The theme scenario now says "the line-box heights differ by at most 1px", which matches D6a.
  - Task 2.6 records that no request is made for a fallback face in the fonts-blocked run, so the "No download" scenario is observed, not only inferred.
  - The requirement's 2% is scoped to "a representative English sample at body and heading sizes".
- **Round 1 CRs remain addressed.**
  - D5 defines the CI-like environment as noble 1.55.1 plus `fonts-dejavu` with Liberation kept, and requires the platform font to be proven. Run (3) covers DejaVu only.
  - D6 and task 2.2 add only the assertion; 620 and 1024 are left in place.
  - D6a and task 2.4b give the box-match signal.
- **Ground truth matches the artifacts.**
  - `frontend/src/theme/theme.css:19-22` has the three `--font-face-*` stacks. There is no `@font-face` anywhere in `frontend/src` (grep returned nothing).
  - In `e2e/hel1665-home-phone-stability.spec.ts`:
    - `VIEWPORTS` is at lines 27-39, and lines 36-38 include 620x900 and 1024x900.
    - `fontSwapSpread` is computed at line 116 and is not asserted (the comment at lines 148-149).
    - The 605-615 comment is at line 34.
    - The scenario's width set equals the spec's `VIEWPORTS` widths.
  - The nested `aria-hidden` is at `DashboardShelf.tsx:45`, inside the hidden slot at line 44.
  - The archived `design.md:145` quotes "22-26px".
- **D6 assertion soundness.** `fontSwapSpread` is the spread of `runsTop` over the frames before the load series. A warm cache or an early font load can only lower it, so the new `<= 4` assertion is a sound upper bound. It cannot pass for the wrong reason when the swap is wide.
- **AC trace.**
  - AC 1 (at most 4px at every width, light and dark, CI-like) is covered by D5 runs (1)-(3), D6 and tasks 2.2/2.4.
  - AC 2 (the 0px series stays green) is covered by tasks 2.2 and 2.7, since the existing spread assertions are unchanged.
  - Each ticket extra has a task, or goes to a follow-up as the ticket allows (placeholder polish).
- **Placeholders and ambiguity.**
  - No TODO or TBD.
  - The "if cheap" (Georgia) and "if needed" (D2 bold faces) branches each have a decision rule, and the decision must be recorded.
  - Exact family names are left to the executor, but they must be self-describing. That is acceptable.

### Verdict: CONFIRM

### Non-blocking notes

- The `fontSwapSpread <= 4` assertion runs for every `VIEWPORTS` entry, including 375x667 and 375x812, not only one entry per scenario width. That is stricter than the scenario and harmless, but the evidence table should cover those heights too, so that CI never fails on a height that was not measured.
- The serif stack has "Iowan Old Style" and Georgia before `serif`. The matched serif faces go right after Fraunces (D1), so on macOS/Windows the pre-swap serif becomes adjusted Times rather than Iowan/Georgia. This is the same intended trade-off D1 states for sans, and one line in the PR is enough.
