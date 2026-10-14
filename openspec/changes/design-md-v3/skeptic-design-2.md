## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `2c1ab0326fe6c171152bc59ff2918f433558296f`. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **cwd guard**: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/design-md-v3-redesign/hel-1571`.
- **`openspec validate design-md-v3 --type change`** returned `Change 'design-md-v3' is valid`.

**Round-1 CR1 (sync sites): resolved.**
- I ran `grep -rnE "121110|18,\s*17,\s*16"` over the tree (excluding node_modules and archive). Every runtime hit is now named in D7 and task 1.3:
  - theme.css:149 and :455
  - the `--app-selection-bg` fallback at :457, now noted as regenerated
  - appearance.ts:80, 355, 483 and 597
  - pwaConfig.ts:12 and :17
  - index.html:17
  - pwa-installability spec:25
- With only `--app-bg` changing, the "×4" count for appearance.ts is right. Lines 50 and 82 are `#1a1816`, the surface value, which stays.
- The new `pwa-installability` MODIFIED delta reproduces the full base requirement. Its only change is the dark value, `#0f0e0d`.
- C1 and D7's guard protocol now separate "regenerate a transcription by its derivation" from "never touch a threshold".
- Test literals that must move are covered by "test transcriptions per C1":
  - appearance.test.ts:46 and :172
  - themeParityGuard.css.test.ts:251–252. MUTATION ARM 1 runs `rawText.replace("--app-bg: #121110;", …)` on the real theme.css. If that literal is not updated, `expect(mutated).not.toBe(rawText)` goes red loudly. It cannot pass vacuously.

**Round-1 CR2 (board evidence): resolved in substance.** I counted hex values per board and grepped `background:` contexts myself.
- Body (line 13) is `#0f0e0d` in B2Dashboard, Home, PipelineLive, MotionLive and Appearance. It is `#11100e` in DashboardMobile, PipelineMobile and Motion.
- Cards, rows 3–4:
  - B2Dashboard: `#1c1a17` (lines 81, 89, 100)
  - PipelineLive: `#1c1a17` (×9)
  - Home: `#1a1815` (lines 52, 66, 87, 96)
  - MotionLive: `#171513` (lines 55, 72, 88, 131)
  - Appearance: `#171513`. D7 omits this one, but it only strengthens D7's conclusion.
- Chrome is `#171513` (rail) and `#13110f` (PipelineLive spine).
- D7's provenance note, that the owner was told "No board gives values", matches events.jsonl line 4.

**Round-1 CR3: resolved.** D2 keeps the HEL-444 token-parity rule in the body and moves only the `f20ea8f6` counts and the re-test.

**Round-1 CR4: resolved.** D5 now states:
- the interim global `@media (prefers-reduced-motion)` rule at theme.css:465–473 means the OS wins until HEL-1572/1573 re-scope it;
- "reduce means Off" and "explicit choice beats the OS" are labelled driver defaults.

**Round-1 CR5: resolved.**
- Task 2.4a re-measures or dates the body's dark rung column. Families 1–2 have unchanged backdrops, so they are correctly left alone.
- I computed WCAG ratios on the new canvas:
  - `--app-surface-raised` on `--app-bg`: 1.161 → 1.187
  - `--app-surface` on `--app-bg`: 1.065 → 1.089
  - `--app-text-muted` on `--app-bg`: 7.63 → 7.81
- Every dark neutral/intent foreground is lighter than the canvas, so a darker canvas only raises contrast. The near-threshold squeeze from round 1 (`#262320` on `#1c1a17`, about 1.111) no longer arises because `--app-surface` is unchanged.

**Round-1 CR6: resolved.** Task 2.4 now lists every clause of `openspec/specs/design-doc-hit-expander-guidance/spec.md`, and I re-read that spec:
- the formula
- the twice-extension gap
- `getComputedStyle`/painted-box insufficiency
- `elementFromPoint` bisection
- the ~43.75px reading plus its epsilon
- the no-widening warning

**The scope question: D7 changes only `--app-bg`. Is that faithful to "adopt"?** I judge yes. Reasoning:
- The owner ruled "adopt a wider dark surface ramp", having been told no board gives values. The driver's brief says to derive from what the boards use and escalate what they don't settle.
- The canvas is settled. All five row-3–4 boards paint `#0f0e0d`, and HANDOFF.md says "ONLY rows 3–4 ('Round 2') are the approved direction".
- The card surface is genuinely unsettled. The row-3–4 boards use three different values: `#1c1a17` ×2, `#1a1815` ×1 and `#171513` ×2 (if Appearance counts). These sit on both sides of today's `#1a1816`.
- Keeping `--app-surface` at the status quo introduces no value the owner did not see and the boards do not show. The ramp still measurably widens (surface/bg 1.065 → 1.089; raised/bg 1.161 → 1.187).
- An escalation is not required before execution. Nothing unsettled is being chosen: the status quo is the absence of a choice, and the plan surfaces it as overridable. It must be surfaced visibly, though; see note 1.

### Verdict: CONFIRM

### Non-blocking notes

1. Add an explicit task, or a PR-body requirement, that tells the owner the card surface was left at `#1a1816` because the boards disagree, with the three candidate values. Today D7 only says "the report to the owner flags this". No task makes that happen, so it could be lost.
2. Fix D7's wording "row 2 boards are earlier explorations". HANDOFF.md marks Dashboard-mobile, Pipeline-mobile and the Motion study as **Approved** for HEL-1583/1582/1573. The conflict is resolved by HANDOFF's header sentence ("ONLY rows 3–4 are the approved direction"), not by those boards being explorations. Make sure DESIGN.md §2/§12 does not repeat the mischaracterisation, because HEL-1583 implements against DashboardMobile.
3. "153" still appears in proposal.md:7 and design.md:24 (D1). C2 and the Context section say 99. Make them consistent.
4. Task 1.3's "zero hits for `121110`" check will force edits to historical comments: focusRingTokenGuard.css.test.ts:23 (a HEL-1046 defect narrative) and appearance.ts:411. Updating them is harmless, but the executor should keep the historical meaning intact, for example "the then-dark canvas". Fixture literals in themeParityGuard (lines 231 and 288) are synthetic, so changing them is fine.
5. The HEL-866 narrative that moves to Appendix A carries v2-ramp dark ratios (1.161 / 1.034). Date-stamp it as "measured on the v2 ramp", as the HEL-444 re-test is.
