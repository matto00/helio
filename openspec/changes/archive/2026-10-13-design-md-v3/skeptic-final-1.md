## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `982c87935615021f05ed1678ade88217a1bd08ef`. Base resolved live with
`resolve-review-base.sh` (`2c1ab0326fe6c171152bc59ff2918f433558296f`, exit 0).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/design-md-v3-redesign/hel-1571`.

### What I verified (with evidence)

**Gates, re-run fresh by me on 982c87935** (jest ran under `nice -n 19`, 3 workers):
- `npm run lint`: exit 0. `npm run typecheck`: exit 0. `npm run format:check`: "All matched files use Prettier code style!", exit 0.
- jest: `Test Suites: 590 passed, 590 total`, `Tests: 7063 passed, 7063 total`, exit 0. This includes every theme guard (`themeParity`, `focusRingToken`, `accentTextSourceSync`, `tokenContrast`, `motionToken`, `tokenAuditSweep`, `elevationToken`).
- Token existence (C4): I re-ran `evidence/token-existence.sh` and got `exit=0`. Every non-`OK` line is a documented family glob, BEM modifier, runtime token or rejected proposal. All 8 `--motion-*` tokens are declared once in `theme.css` (lines 84-91).
- Rendered `state-surface-contrast-guard` e2e: I relied on the executor's pasted output (`18 passed (3.1m)`). It is unambiguous, and `git diff 6cbf218b6 HEAD -- frontend` is empty, so the tree it ran on is the shipped frontend.

**Acceptance criteria, traced:**
1. Sans + mono default, Fraunces optional only. DESIGN.md §0.4 (l.63-66) and §3 Typography (l.325-348) say this. In the code, `theme.css` sets `--font-heading: var(--font-sans)`, and every former `var(--font-display)` consumer now reads `var(--font-heading)`: App.css, auth.css ×2, FirstRunDropZone.css, OnboardingChecklist.css, EmptyState.css, `.wordmark` and `.page-title`. `git grep font-display HEAD -- frontend` finds only the token declaration and the audit-sweep allow-list. **Met.**
2. Motion section with tokens in `theme.css`, the Full/Subtle/Off rule and reduced motion: §10 (l.972-1048). The tokens are command-verified above. The no-preference → `prefers-reduced-motion` default and the explicit-choice-wins rule are both stated and labelled **driver defaults, not owner rulings** (l.1036-1040). The interim gap is stated truthfully: the global `@media (prefers-reduced-motion: reduce)` `!important` rule really is at `theme.css:481-489`. **Met.**
3. Shell section (rail, context list, tabs, meta row, ⌘K) is §9, and the live-preview section is §11. **Met.**
4. Forensics are in Appendix A.1-A.10, and each moved block leaves a pointer in the body ("Appendix A.2", "A.3", "A.4", "A.6", "A.7", "A.8", "A.9"). No guard file was deleted. The two test edits regenerate a transcribed canvas hex, and the allow-list gains only the new `--font-heading` (C1 holds). Every guard passes, as shown above. **Met.**
5. Lint, typecheck and tests pass, as shown above. **Met.**

**Owner rulings** (events.jsonl l.4-5: `flip-now`, `adopt`):
- `flip-now`: implemented, wordmark included. See the live check below.
- `adopt`: the executor read this as moving the dark canvas only. That reading is stated honestly in §2 (l.109-118), A.2 (l.1185-1191) and pr-notes. I checked the board claim against the sources. `body{background:#0f0e0d}` is the canvas on all five round-2 boards (B2Dashboard, Home, PipelineLive, MotionLive, Appearance). The card values really do disagree: `#1c1a17` (B2Dashboard, PipelineLive), `#1a1815` (Home) and `#171513` (MotionLive, Appearance). The doc does not present the canvas-only scope or the card value as an owner decision.

**Contrast re-transcription:** I recomputed with WCAG luminance against `#0f0e0d` and got text 16.80, muted 7.81, success 8.71, warning 10.93 and error 7.13. The family-3 rung (`#232019` on the canvas) is 1.187. All match `docs/contrast-audit.md` and DESIGN.md A.2 exactly.

**Fidelity of §9-§12 to HANDOFF and the boards (spot checks):**
- The changed-row flash matches MotionLive's source: `--flash: color-mix(in srgb, {{accent}} 30%, transparent)` with `.flash{animation:flash 1.2s ease-out}`. That is §11's 30% accent wash and the 1200ms `--motion-duration-highlight`.
- The `--motion-ease-out` curve equals the boards' `cubic-bezier(.3,.9,.4,1)`.
- "Search, jump, or ask" and the 248px context list match B2Dashboard.
- The TTL tabs are an owner ruling per the README.
- The 200/400 widths, the 40ms stagger and Off-on-reduce are flagged as driver/adjustable.

**Binding now vs later:** this is clearly separated. §9 says nothing in it licenses restyling the v2 sidebar or command bar ahead of HEL-1574/1575/1576/1578. §6 keeps `.page-title`/`PageHeader` until the shell tickets land. §10 primitives are a contract for HEL-1572/1573, §11 says "none of it exists in the running app yet", and §12 is the HEL-1582/1583 target. The 4.5:1 requirement on the expanded nav label is recorded as an open obligation, not a measured fact.

**Themeability:** §0.6 makes this [mechanical] (colour from tokens, type from `--font-sans`/`--font-heading`/`--font-mono`). Every new section names accent tokens or `color-mix`, never a hex. `--font-heading` is a single switch. My discriminating probe (below) confirms that one token re-faces every heading role.

**Running app (dev servers on 7003/9910; `assert-phase.sh servers` → `PASS servers`), 1440×900 and 390×844, both themes:**
- Dark: `body` computes `rgb(15, 14, 13)` and `--app-bg` is `#0f0e0d`. Sidebar and command bar compute `rgb(26, 24, 22)` (`--app-surface`). Light: body `rgb(244, 242, 237)` and sidebar `rgb(253, 252, 250)`, unchanged from v2.
- The wordmark's computed font is `"Schibsted Grotesk", system-ui, …`. `document.fonts` shows only Schibsted Grotesk and JetBrains Mono loaded; no Fraunces face is fetched.
- Discriminating `--font-heading` probe. I placed real-class elements in the live page: `.first-run-drop__title`, `.onboarding-checklist__title`, `.ui-empty-state--main .ui-empty-state__title`, `.page-title`, `.wordmark`, `.auth-card__title` and `.auth-card__brand-name`, plus the live `.app-command-bar__wordmark`. All eight compute `"Schibsted Grotesk"`. Setting `--font-heading: var(--font-display)` on `<html>` flips all eight to `Fraunces`, and removing it restores all eight. This proves the onboarding/first-run titles take the heading face through the one token. Limitation: I did not render the actual zero-dashboard first-run screen. That needs an empty account, and logging out would have broken the shared browser session. Since the type change is purely the token, the probe settles the type question.
- Screenshots, which I looked at (persisted):
  - `/home/matt/Development/helio/.concertino/runs/HEL-1571/evidence/openspec/changes/design-md-v3/evidence/screenshots/skeptic-final-dashboard-dark.png`: a populated dashboard with a table and a chart.
  - `…/skeptic-final-dashboard-light.png`
  - `…/skeptic-final-pipelines-dark.png`: the `.page-title` h1 in sans semibold.
  - `…/skeptic-final-pipelines-light.png`
  - `…/skeptic-final-dashboard-dark-mobile.png`: 390×844 with the glass BottomNav.

  md5s are all distinct: f50962eb…, fb3fd1b0…, 80ba0f36…, 7bf6f7eb…, daaa095b….

**Design judgment on the dark canvas.** The sidebar and command bar (`--app-surface`) and the panel cards (the same `--app-surface`) now sit as raised slabs over a slightly deeper canvas. The relationship is the same as in v2, at three RGB steps more separation. Nothing reads tinted or off-pattern: the dot field is still visible, intent chips still read, and the yellow accent stays confined to the active nav item, the primary button and the selected dashboard. The boards' "chrome darker than cards" relationship is *not* implemented. §9 (l.931-932) truthfully hands that to HEL-1574, so it is not a defect of this ticket. Light theme is pixel-identical in structure to v2. I see no light/dark parity break in token coverage; the asymmetry in depth is deliberate and documented.

**Console:** there are no errors attributable to this change. The only error is a `502` on `/api/pipelines/…/run-events`, an SSE stream on the shared dev backend that is unrelated to CSS tokens. The two ECharts warnings are a 0-size DOM during the mobile layout.

**Gate-defect check (mtime evidence):** no report I drilled into relies on mtime ordering, so no defect is recorded.

### Verdict: CONFIRM

### Non-blocking notes
- DESIGN.md §2 (l.111) says the canvas is "the value every approved re-design board paints". It is every approved **round-2 desktop** board. The approved mobile carry-forward boards (DashboardMobile, PipelineMobile, Motion) paint `#11100e`. The doc could say so.
- DESIGN.md §3 Typography (l.333-334) tags "no component reads `var(--font-display)` directly" as [mechanical], but `tokenAuditSweep.css.test.ts` still allow-lists `var(--font-display)`. Today it holds only by grep. A later ticket could tighten the allow-list, which C1 permits.
- §3 "Headings are sans, set by hierarchy not by face" reads slightly against the opt-in Serif style. Adding "by default" would remove the tension.
- A.2 still prints the v2 rung table twice, and A.5's "see `Skeleton`'s own explicit override below" still dangles (the dangling reference predates v3). Both were already noted by the evaluator.
- `files-modified.md` still lists `openspec/specs/pwa-installability/spec.md`, which cycle 2 reverted. The PR body should follow `pr-notes.md`, not that line.
- A.10's wordmark ratio range (14.96-16.74) is a dated v2-ramp record. Dark `--app-bg` text is now 16.80.
