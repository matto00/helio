## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `2c1ab0326fe6c171152bc59ff2918f433558296f` (planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **cwd guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/design-md-v3-redesign/hel-1571`.
- **Owner rulings**: `.concertino/runs/HEL-1571/events.jsonl` lines 4–5. The `escalation.answered` event has `sub_answers ["flip-now","adopt"]` and `answer_source human`. Note that the `escalation.raised` context told the owner "No board gives values for a wider dark surface ramp", and the owner answered `adopt` on that basis. D7 now says the values "come from the approved boards". See CR2.
- **`openspec validate design-md-v3 --type change`** -> `Change 'design-md-v3' is valid`.
- **`--font-display` consumer list**: `grep -rln "var(--font-display)" frontend/src` gives theme.css (lines 486, 516), auth.css (64, 74), FirstRunDropZone.css:32, OnboardingChecklist.css:43, EmptyState.css:37 and App.css:127. This matches D3 exactly. The only other `Fraunces` text in TS/TSX is the `PageHeader.tsx:7` comment, which is listed. `tokenAuditSweep.css.test.ts:207`'s font allow-list does not include `--font-heading`, but none of the six consumers are in its `SWEPT_FILES`, so nothing goes red (see the note below).
- **motionTokenGuard pin**: `motionTokenGuard.css.test.ts:182` has `expect(files.length).toBe(132)`, and `find frontend/src -name "*.css" | wc -l` gives 132. The claim is correct.
- **"153 citations"**: the design's own command (`grep -rhoE "DESIGN\.md[^\"'\`]{0,40}" frontend e2e | wc -l`) gives **154**, and only **99** of those contain `§`. So the figure is neither the command's output nor a count of section-number citations. There are also bare `§N` citations without "DESIGN.md". No existing `§9`–`§12` DESIGN citation would collide with the new sections (the only `§10`/`§17` hit is a CSS 2.1 reference in DataGrid.css:719).
- **D4 motion values vs the boards** (extracted from `Motion`, `MotionLive` and `PipelineLive` `.dc.html` with a regex dump):
  - Matches: `pop .26s cubic-bezier(.2,.9,.3,1.1)` (overshoot), `cubic-bezier(.3,.9,.4,1)` at `.3s`/`.32s` (ease-out), `flash 1.2s`, `rise .42s`, staggers of `.03s` (MotionLive) and `.05s` (Motion) (so 30–50ms is accurate), and hover transitions at `.16`/`.18`/`.2s`.
  - Small divergences: the board's layout slides (sidebar width, transform, nav label `max-width`) are all `.32s`, yet D4 assigns "layout slide of large surfaces" to emphasized 420ms. `rise` uses `cubic-bezier(.2,.8,.2,1)`, which no token covers. The board's flash uses the CSS `ease-out` keyword, while D6 specifies `--motion-ease-out` (the custom curve). These are notes, not blockers.
- **D7 ramp values vs the boards** (hex dump of the 8 approved board files):
  - The canvas is `#0f0e0d` in B2Dashboard, Home, PipelineLive, MotionLive and Appearance. It is **`#11100e`** in DashboardMobile, PipelineMobile and Motion, all three of which carry forward.
  - Cards are `#1c1a17` in B2Dashboard, PipelineLive, DashboardMobile, PipelineMobile and Motion. Home uses `#1a1815`, and MotionLive's sections are `#171513`.
  - Chrome (rail aside, tab bar, footer, header) is `#171513`.
  - D7's "all 7 boards" claim is false. See CR2.
- **Contrast impact of the new ramp** (WCAG luminance computed in python):
  - `--app-surface-strong #262320` on `--app-surface` goes from 1.133 (old) to **1.111** (new). The state-surface guard's threshold is 1.10 (`e2e/state-surface-contrast-guard.spec.ts:30`), so the margin is 0.011.
  - `--app-surface` on `--app-bg` goes from 1.065 to 1.111, so the ramp does widen.
- **Sync sites of the dark ramp outside theme.css**: `grep -rniE "121110|1a1816"` found the following.
  - `frontend/src/theme/appearance.ts`:
    - line 50: `panelAppearanceEditorFallback`
    - lines 80/82: `themeAppearancePalette.dark.appBackground/panelSurface`
    - lines 355–356: `FOCUS_RING_SURFACES`
    - line 483: `ACCENT_TEXT_NEUTRAL_SURFACES.dark`
    - line 597: `SELECTION_BASE_HEX.dark`
  - `frontend/src/pwaConfig.ts:17`: `APP_BG_DARK`, which has an explicit "update here too" comment.
  - `frontend/index.html:17`: the dark `theme-color` meta.
  - `openspec/specs/pwa-installability/spec.md:25`: the scenario pins dark `theme-color` to the literal `#121110` and says it is sourced from `--app-bg`.
  - Test fixtures: `appearance.test.ts`, `PanelDetailModal.themeAwareFallback.test.tsx` and `themeParityGuard.css.test.ts`.

  None of these appear in proposal.md Impact, design.md or tasks.md.
- **design-doc-hit-expander-guidance spec**: this spec requires, in Control metrics:
  - the formula
  - the gap rule
  - that `getComputedStyle(el,"::after").width` and painted-box sampling cannot detect overlap
  - `elementFromPoint` bisection
  - the legitimate ~43.75px abutting reading plus its epsilon
  - the no-widening warning

  D2 and task 2.4 list formula, gap, bisection, epsilon and no-widening, but not the `getComputedStyle` / painted-box insufficiency clause. D2 also moves "the HEL-772 measurement narrative (35.75px etc.)" without saying the ~43.75 legitimate-reading statement stays.
- **HEL-444 sections**: `DESIGN.md:985` "Light/dark token-parity rule (HEL-444)" is a normative rule: every `--app-*` token must be declared in both theme blocks, guarded by `themeParityGuard`. D2 moves "the two trailing HEL-444 sections, verbatim" into the forensics appendix.
- **Stale measurements after the ramp change**:
  - `DESIGN.md:118–126`, the HEL-866 table that D2 keeps in the body, carries a "measured (dark / light)" column. Its family-2 dark value of 1.133 becomes about 1.111 on the new ramp.
  - `DESIGN.md:1052` cites `#f97316 on #1a1816`.
  - Only `docs/contrast-audit.md` is scheduled for re-transcription.
- **D5 vs theme.css**: `theme.css:465–473` is a global `@media (prefers-reduced-motion: reduce)` rule that applies `!important` 0.01ms durations to `*`. D5 says this rule "stays", and also that "an explicit saved choice wins over the OS setting". As long as that rule exists unscoped, an explicit Full or Subtle choice can never win.
- **Light-theme parity**: D7 and task 2.3 record "light unchanged" explicitly, with a rationale: no approved board is light, and the escalation asked only about the dark ramp. That is the status quo and inside the literal scope of the ruling, so it is not a new identity choice. I accept it.
- **Context-list widths**: 248px default matches B2Dashboard `flex: 0 0 248px`. The 200/400 min/max are flagged in Risks as "adjustable by the owning ticket". I accept this.
- **Scope vs ACs**: every AC is covered (AC1 → 2.2/1.1, AC2 → 1.2/2.5, AC3 → 2.5, AC4 → 2.4/3.2/3.3, AC5 → 3.2). There is no scope drift beyond the ticket's own "matching token changes in theme.css".

### Verdict: REFUTE

### Change Requests

1. **The plan omits the dark-ramp sync sites and a spec contract.** Changing dark `--app-bg`/`--app-surface` requires coordinated edits that the plan never names:
   - `frontend/src/theme/appearance.ts` lines 50, 80, 82, 355–356, 483 and 597. This is runtime source with documented sync obligations, not a "guard transcription", and it drives `--app-accent-text`, `--app-selection-bg` and the panel appearance defaults.
   - the theme.css static fallbacks `--app-accent-text`/`--app-selection-bg` (pinned by `accentTextSourceSyncGuard`).
   - `frontend/src/pwaConfig.ts:17` and `frontend/index.html:17` (unguarded, so they would drift silently).
   - a **MODIFIED `pwa-installability` spec delta**, because its scenario pins dark `theme-color` to `#121110`.

   Add all of these to proposal.md Impact, D7 and task 1.3. Reword D7 step 2 and C1 so that a source-of-truth sync copy, which is updated to the new value, is distinct from a guard threshold, which is never touched. As written, an executor following D7 step 2 literally has no authority to edit appearance.ts.
2. **D7's derivation misstates the boards.** "All 7 boards paint the canvas `#0f0e0d`" is false:
   - There are 8 approved boards.
   - DashboardMobile, PipelineMobile and Motion paint `#11100e`.
   - MotionLive's cards are `#171513`, not `#1c1a17`.

   Correct the evidence. State the precedence that resolves the conflict (HANDOFF.md: rows 3–4 are "the approved direction"; the row-2 boards carry forward for layout and feel). Also record in design.md that the owner's `adopt` answer was given on the premise "no board gives values", and that these values are a derivation from the boards that the driver asked for, not values the owner chose.
3. **D2 must not move the HEL-444 light/dark token-parity rule into the forensics appendix.** It is a normative `[mechanical]`-grade rule backed by `themeParityGuard`. Keep the rule in the body (§2 or §3 Color). Only its measurement sentences ("Measured on `f20ea8f6`: each block declares 29…") and the HEL-444 re-test narrative may move.
4. **D5 is internally inconsistent with the theme.css rule it keeps.** The unscoped `@media (prefers-reduced-motion: reduce) { * { …!important } }` rule (theme.css:465) makes "an explicit saved choice wins over the OS setting" impossible. D5 and §10 must say three things:
   - this global rule is the interim implementation;
   - HEL-1572/1573 must re-scope it to "no saved preference" (for example `:root:not([data-motion])`);
   - DESIGN.md does not claim explicit-wins is live today.

   Also label "reduce maps to Off" (not Subtle) and "explicit choice beats OS" in §10 as driver defaults derived from the Appearance copy ("Defaults to your system's reduce-motion setting") and the current global rule, not as owner rulings. The boards do not settle Off vs Subtle.
5. **Dark measurements that stay in the body go stale.** The HEL-866 rung table kept in §3 has a dark "measured" column (1.167 / 1.133 / 1.161) taken on the v2 ramp, and `DESIGN.md:1052` cites `#1a1816`. Add a task to re-measure the body table's dark column on the new ramp from rendered pixels, or to date-stamp it as v2-ramp evidence and move it to Appendix A, so v3 does not ship with numbers that are false of the running app. The family-2 state (`--app-surface-strong` on `--app-surface`) computes to about 1.111 against the 1.10 floor. Record this near-threshold risk in Risks so the evaluator expects a possible escalation.
6. **Task 2.4's spec checklist is incomplete.** Enumerate every clause of `openspec/specs/design-doc-hit-expander-guidance`:
   - add the "`getComputedStyle(el,"::after").width` and neighbouring-painted-box sampling cannot detect an overlap" clause;
   - add the legitimate ~43.75px abutting reading.

   D2 must state that these sentences stay in §3 Control metrics even though the HEL-772 measurement narrative moves.

### Non-blocking notes

- Fix "153" in proposal.md, design.md and C2. The stated command prints 154, and only 99 of those carry `§`. Either cite the measured number with its command, or say "about 150".
- D4: the boards' layout slides are all `.32s` with `cubic-bezier(.3,.9,.4,1)`, so the layout slide maps to standard (280ms), not emphasized. Consider stating that `rise`'s `cubic-bezier(.2,.8,.2,1)` folds into `--motion-ease-out`. The changed-row flash on the board uses the CSS `ease-out` keyword, while D6 uses the custom curve. Either is fine; just say which is intended.
- `.app-sidebar` paints `var(--app-surface)` (App.css:286), so the new ramp makes today's sidebar lighter (`#1c1a17`). In the boards, chrome (`#171513`) sits darker than cards. This is expected until HEL-1574, but include the sidebar in the 3.4 render check and mention it in the PR.
- `tokenAuditSweep.css.test.ts:207` allow-lists `var(--font-sans|--font-display|--font-mono)`. Adding `--font-heading` there is an allow-list extension, not a loosening. It is optional now, since no swept file uses it, but it avoids a future false positive.
- The design-language-v3 spec says the contrast guards "pass unmodified" while D7 allows regenerating transcribed values. Reword the spec to "no threshold or assertion changes".
