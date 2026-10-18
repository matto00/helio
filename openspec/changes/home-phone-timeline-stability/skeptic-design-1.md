## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 6477341111d4b4ec6d0368e5a1f46e473325f226 (`bug/home-phone-timeline-shift/HEL-1665`, equal to origin/main 647734111; the change dir is untracked). Artifacts: ticket.md, proposal.md, design.md, tasks.md, specs/home-page/spec.md. No servers were started. The numbers below come from reading the live CSS and tokens and from HEL-1642's persisted evidence. Where a number is derived rather than measured, I say so.

### What I verified (with evidence)

- **The cwd guard passed:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/home-phone-timeline-shift/HEL-1665`.
- **The touch-block claim is confirmed.** `frontend/src/features/home/ui/HomePage.css:742-766`: `@media (max-width: 768px), (pointer: coarse)` sets `.home-section__link, .home-upnext__row { display: inline-flex; min-height: 44px; align-items: center }`. `DashboardShelf.tsx` renders the `All N` link only when `dashboards.length > 0`; the skeleton branch has no link. `PipelineRunsCard.tsx:65` reuses the class for `+N more`, which sits after the list, so it cannot move the card's top.
- **The 31px origin is real but partly attributed.** HEL-1642 `evaluation-1.md:60` measured the shelf top moving 200→231 with `/api/dashboards` held. Only dashboards were held, so the opening line was already settled. That eval also measured a separate 8px from skeleton vs loaded card height (4px per row; `skeptic-final-1.md:34`: 113.9 vs 117.9 at 375).
- **The 375×667 numbers are confirmed** (`.concertino/runs/HEL-1642/evidence/home-375x667-{light,dark}.json`): `timelineTop` 563.8125, `navTop` 599. Per the HEL-1642 spec lines 70-86, `timelineTop` is the `[aria-label="Pipeline runs, last 24 hours"]` list, not the card. The design reads it correctly.
- **The disclosure row is taller than the design's estimate.** The HEL-1642 screenshot `home-375x667-light-viewport.png` shows the first `.tl-disc__head` label, `hel1642-orders-sync, 3 runs, 1 failed, nothing scheduled`, wrapped onto **two** mono lines. The row is therefore about 12 + 2×18 + 8 + 16 + 12 ≈ 84px, not the design's ≈68px. Its bottom is ≈648, about 49px behind the nav, not 33. The same screenshot shows the opening sentence `One run failed, everything else is quiet.` on one line at 375px.
- **Line boxes (derived from tokens).** `.eyebrow` is `--text-micro` 10px (`theme/theme.css:35,50,591`). The link is `--text-sm` 14px. The body line-height is 1.5 (`theme.css:438-439`), and nothing resets h2. So the eyebrow line box is ≈15px and the link's is ≈21px. `.home-section__head` is `display:flex; align-items: baseline`, so the head's height follows the taller item.
- **DESIGN.md §3** (lines 302-347): grow-the-box is for full-width rows, inputs, select triggers and BottomNav tabs; compact controls use a sized `::after`. A section-head text link is a compact control, so the expander is the right mechanism. Decision 1's reading of §3 is correct.
- **Tiling for the expander is fine.** Both links sit in a `--space-4` (16px) gap: `.home-section` gap, and `.home-card-panel` gap at `HomePage.css:197`. A 44px expander on a ≈21px link reaches about 11.5px out, which fits in 16px. Because `+N more` sits directly under the last `.tl-disc__head`, it still needs the bisection check the design asks for.
- **`expectTapExpander`** (`shared/ui/tapTargetTestUtils.ts`) supports `strip` (left:0/right:0, height only) and `square` (44×44 centred). The strip shape gives a short link such as `All 4 →` a horizontal extent equal to the link's width, possibly under 44px.
- **DESIGN.md §4** (lines 465-470, marked **[mechanical]**): "Canonical set … **1440 / 1100 / 768 / 430**. CSS media queries use these values only." I searched every `@media` in `frontend/src/**/*.css` and found none outside the canonical width values plus pointer/prefers/hover. There is no height query anywhere. The 430 value was added by a ratification (HEL-300).
- **The opening line's loading state** (`HomeOpeningLine.tsx`): the skeleton is a fixed 28px line. The loaded sentence is `--text-xl` (≤430) at line-height 1.25, about 25px per line, capped at `max-width: 40ch`. `buildSummarySentence.ts` produces between about 41 and 140+ characters, depending on the changed/failed/stuck/missed counts. So the loaded sentence takes 1 to 4 lines, depending on the data.

### Verdict: REFUTE

The direction is sound. The §3 expander is the right mechanism, a cold measurement probe is the right method, and the red-first e2e can fail (on the base: the shift is about 31px at phone widths, and the first row's bottom is about 648, against 599). But one decision collides with a mechanical rule in the binding design standard, and the arithmetic and spec wording rest on premises the live tree contradicts.

### Change Requests

1. **Decision 3 / proposal / tasks 3.1 / DESIGN.md sentence: the `max-height: 700px` query breaks DESIGN.md §4 [mechanical], and the design never mentions it.** §4 says CSS media queries use 1440/1100/768/430 only. No stylesheet in `frontend/src` has a height query, and the 430 value itself needed ratification. Adding a breakpoint value amends a binding standard that later work builds on, so it is not a "CSS-only, nothing builds on it" overnight reversible decision. Revise Decision 3 to do one of these:
   - (a) Use a mechanism inside §4. Examples: the shorter thumbnail ratio at `max-width: 430px` for all phones (then state the visual change at 375×812 and 430×932, and check that HEL-1642's assertions stay green). Or a viewport-unit `max-height` on `.home-thumb` and the skeleton thumb with no media query (then justify the constant).
   - (b) If a height bound is truly required, plan an ESCALATION for owner ratification of a §4 amendment, and do not take it as an overnight UI decision.
   Either way, the Risks section must name the §4 rule.

2. **Decision 1's premise, "the shelf head's height no longer depends on the link", is false as written.** Without `min-height`, the link's own line box (14px × 1.5 ≈ 21px) is still taller than the eyebrow's (10px × 1.5 ≈ 15px) in a baseline-aligned flex head. So the head still grows about 6px when the link mounts. This happens at every width, including **1280 with a fine pointer, where the touch block never applied**. So the 1280 shift case is probably red on the base for this reason alone, and it stays red after Decision 1. Revise Decision 1 to:
   - state this residual;
   - specify a fix that keeps Home's settled layout at 1280 identical (the Goals require it). For example, reserve the head's settled line box during loading, or set a token-derived `min-height` on `.home-section__head` equal to the link's line box. The fix must not change the settled head height on desktop;
   - correct the "~31px returned to the page" claim. With the expander, the settled head shrinks from about 44 to about 21, which returns about 23px, not 31.

3. **The short-phone arithmetic in the design's Context and Decision 3 is wrong; redo it with measured numbers.** The first disclosure row in the HEL-1642 fixture wraps to two lines (screenshot above), so it is about 84px, not 68. The first row's bottom is about 648, which needs about 57px to reach the design's own "≤ nav top − 8px" target. The savings are about 23px from Decision 1 (CR2) plus about 35px from 16/5 (two rows × (141.5px thumb width × (7−5)/16)). That totals about 58px, exactly at the edge. Make the design:
   - record the measured row height and the fixture label it was measured with;
   - give a deterministic fallback order (which levers, in which order, all token-based) instead of a hedged "MAY";
   - recompute all of this under whichever mechanism CR1 selects.

4. **The spec delta claims more than the plan can guarantee.** "SHALL NOT move … 0px" and "first pipeline row fully above the bottom nav" are both content-dependent:
   - The opening line: a 28px skeleton becomes 1 to 4 sentence lines of about 25px each, depending on the summary counts. Decision 4 holds `/api/home-summary`, so this mover is in scope.
   - The disclosure label wraps by pipeline-name length.
   - The skeleton-vs-loaded card difference (4px per row, already measured in HEL-1642, not a "may differ") is a third mover.

   Revise as follows:
   - Design: list the opening line and the card-foot difference as known contributors, with a stated strategy for each. For example, the opening skeleton reserves one or two sentence lines, using tokens.
   - Spec: state the content bound the implementation actually guarantees, for example "with an opening sentence of at most N lines" and "a first row whose label fits two lines". Otherwise the guarantee must be content-independent.
   - e2e: record which sentence and label text the fixture exercises, and its line counts.

   HEL-1642 was already corrected once for overclaiming "does not jump". Do not archive another unconditional SHALL that a different sentence breaks.

5. **Decision 4's shift test checks two endpoints, but the AC is "moves by 0px".** The two routes resolve independently, and the user sees each intermediate state. If the sentence grows while the shelf head is reserved, the shift appears and then disappears, and an endpoint comparison passes. Require the test to:
   - sample `.home-runs` top on every animation frame, or after each route release, and assert the maximum deviation is ≤0.5px;
   - cover both resolution orders (dashboards first, then summary first).

6. **Decision 4's "desktop unchanged" check: remove the "same-run structural check" option.** A same-run check cannot detect a change from the base. Pin the 1280×900 boxes (opening line, shelf head, shelf, runs card) measured on the unmodified base, store them in evidence, and assert equality against the pinned numbers.

### Non-blocking notes

- Decision 5 says "extend Home's CSS guard tests". No Home CSS test file uses `expectTapExpander` today, so this is a new test file (for example `HomePage.css.test.ts`, mirroring `PipelineMobile.css.test.ts`).
- For `All N →`, prefer `expectTapExpander`'s `square` shape (44×44 centred). The `strip` shape gives a link narrower than 44px a horizontal hit extent under 44.
- Decision 3's visual check needs a dashboard with a real multi-panel layout. The HEL-1642 fixture's dashboards are all "No panels yet", so a squash would not be visible in them.
- 375×667 is the PWA/standalone viewport. In-browser iPhone SE Safari is about 548px tall with its toolbars. The AC is literally 375×667, so this is information only, but the PR body should say which one was measured.
- `.home-upnext__row` keeps grow-the-box. That is correct per §3: it is a full-width row.
