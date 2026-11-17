## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/home-sentence-font-independent-cap/HEL-1737`. HEAD is `6432e69e015fcde437d26262f15601fb59e069af`. The only untracked path is the change dir.
- Round-3 CR1 (DejaVu-only environment) is addressed:
  - Task 1.1 brings up `dv` (the noble image with `fonts-liberation` removed).
  - Tasks 1.3 and 3.3a run the DejaVu-matched sweep in `dv`. A run is void unless CDP `getPlatformFontsForNode` reports DejaVu Sans.
  - Task 3.3 and D4 run the new band and 1440 cold-load cases in `dv`, light and dark.
  - D3 now explains why a "DejaVu" sweep in the CI-like container would only re-measure Liberation.
- The round-3 non-blocking notes were taken up:
  - D4's non-vacuity requires the held font route to be hit and released, and the web face to be confirmed after release.
  - Tasks 1.4 and 1.5 are in order.
  - Task 4.1 includes 604px.
- Ground truth re-checked:
  - `frontend/src/features/home/ui/HomePage.css` l.28-30: the sentence is capped at `40ch`. l.50-57: the ghost is capped at `25em`. Both use `--font-heading`, `--text-2xl`, `line-height: 1.25` and `-0.01em` letter-spacing, which matches design.md Context.
  - `theme.css` l.265-270: `:root[data-type-style="serif"|"mono"]` overrides exist. `appearancePrefs.ts:62` sets `root.dataset.typeStyle`. So D1's per-style property and D3's Sans-only scoping can be expressed in CSS.
  - `e2e/hel1665-home-phone-stability.spec.ts`:
    - l.27-37 has the 620 "disclosed residual" comment that task 2.3 removes.
    - l.154 has the `fontSwapSpread <= 4` assertion.
    - l.416-469 has the `keeps the 40ch measure` test. It asserts `settledMax === ch40` and `lines === 2`. D4's restatement (within 0.5px of the in-page `40ch`, line count 2) maps onto it directly.
  - `e2e/hel1678-home-large-font.spec.ts` exists, so task 3.3's guard run is real.
  - The tools the plan reuses exist: HEL-1678's `vsweep.cjs` is at `.concertino/runs/HEL-1678/evidence/.../evidence/skeptic/vsweep.cjs.txt`, and `chunit.mjs` is in the archived change's `evidence/tools/`.
- Spec delta: I diffed it against `openspec/specs/home-page/spec.md`. It is a clean MODIFIED copy of the full requirement. The only changes are:
  - the carve-out paragraph is replaced by the band, 1440, `em`-measure and data-before-font SHALLs;
  - the cold-load scenario's widths are extended;
  - two scenarios are added.
  Nothing else in the requirement was dropped.
- AC coverage:
  - AC1 (≤4px at 605-613 and desktop, light and dark, CI-like): covered by D1 plus the desktop data-before-font cases, and by D3 for the band (with an escalation path).
  - AC2 (existing 0px series and HEL-1678 ≤4px stay green): covered by task 3.3.
  - AC3 (red first): covered by task 2.4, with guards labelled.
- Driver guidance:
  - "Loaded wrap identical": D1 sets the cap to the web font's own 40ch per style, within 0.5px, and task 4.1 pixel-diffs the settled rendering.
  - "Visible measure change is an escalation": stated in Risks and in D3's options.
  - "Placeholder polish only if cheap": D5 is time-boxed, pure CSS, with a follow-up fallback.
- Soundness of D1: an `em` cap equal to the web font's 40ch makes the cap the same in the fallback and the web font. At desktop with data first, the fallback default sentence is close to the web width (HEL-1678's numbers, less letter-spacing), so it fits under the web 40ch cap as it does under the web font. Task 1.2 re-measures this rather than assuming it. D2 makes the Mono ghost's cap equal to the sentence's (576px) instead of 600px. That removes a mismatch rather than adding one, and the Mono 0px style cases stay as guards.
- Ambiguity, placeholders and contradictions: none blocking. D3 is honestly conditional: feasibility comes first, then a STOP or ESCALATION on FAIL, and spec rewrite task 1.4 is gated before any band test or fix.

### Verdict: CONFIRM

### Non-blocking notes

- **Spec scope does not match.** The requirement paragraph's new band/1440 SHALL says "under the CI-like font set" only. The "Cold-load web-font swap is bounded" scenario includes 605-613 and 1440 "or with DejaVu as the only fallback". Task 3.3 does run `dv`, so this is covered. Still, align the SHALL text with the scenario, adding "and with DejaVu as the only fallback", so the requirement and its scenario state the same bound.
- **The "4% below HEL-1678's value" budget is ambiguous.** It could mean relative (104.94% to about 100.74%) or percentage points (to 100.94%). State which one in `evidence/measurements.md` when task 1.3 runs, so the escalation boundary cannot be argued afterwards.
- **The restated measure test can pass without the web font.** It computes `40ch` in-page after `document.fonts.ready`. If the web font never loads (Google Fonts unreachable), it would compare the `em` cap with the fallback's 40ch and fail confusingly. Add the same `document.fonts.check(...)` precondition D4 adds to the new cases, so a failure points at the right cause.
- **D3's wrap point must come from measurement.** The (i) criterion hardcodes "fits at 605, wraps at 604". Task 1.3 says "exactly as the web font", which is the right reading. If task 1.5 shows the web font's own wrap point is not 604/605, use the measured boundary, not the literal numbers.
- **Sans scoping in D3.** Sans may be the absence of `data-type-style` or `data-type-style="sans"`, so scope the opening faces in a way that covers both. For example, apply them by default and reset them under the serif and mono selectors.
