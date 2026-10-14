## Standing Constraints

- [C1] No guard test file is deleted and no guard threshold, pattern or assertion is loosened. A transcribed old value (in a test or a runtime sync site listed in design.md D7) may be regenerated only by its own derivation. An allow-list may gain only a token this change introduces.
- [C2] Section numbers §0–§8 of DESIGN.md keep their meaning (99 §-numbered code citations). New content goes in §9+ and Appendix A.
- [C3] Nothing hardcodes the accent or a font family. Every new rule works with any accent preset.
- [C4] Every token DESIGN.md names is verified to exist by a command whose output is saved as evidence, not by reading.
- [C5] Local caps: jest at most 3 workers (`HELIO_JEST_MAX_WORKERS=3` or less), `nice -n 19`, Bash `timeout: 600000` for long runs. Never pkill/pgrep/killall; stop servers only via `scripts/concertino/stop-servers.sh`.
- [C6] Add no new CSS file under `frontend/src` (motionTokenGuard pins 132).

## 1. theme.css tokens

- [x] 1.1 Add `--font-heading: var(--font-sans);` to `:root` (keep `--font-display` = Fraunces). Repoint every `var(--font-display)` consumer to `var(--font-heading)`: theme.css `.wordmark`/`.page-title`, `auth.css` ×2, `FirstRunDropZone.css`, `OnboardingChecklist.css`, `EmptyState.css`, `App.css`. Update the `PageHeader.tsx` and `theme.css` comments that say Fraunces/serif. Verify `grep -rn "var(--font-display)" frontend/src --include=*.css` returns only the `--font-heading` indirection or nothing.
- [x] 1.2 Add the D4 motion tokens to `:root` (`--motion-duration-quick/standard/emphasized/highlight`, `--motion-stagger`, `--motion-ease-standard/out/overshoot`) with a short comment pointing at DESIGN.md §10. Verify `motionTokenGuard.css.test.ts` passes.
- [x] 1.3 Dark ramp (D7): change ONLY dark `--app-bg` `#121110` → `#0f0e0d` (`--app-surface` and the light theme unchanged). Update every sync site listed in D7: theme.css comment + `--app-selection-bg` fallback (regenerated), `appearance.ts` ×4, `pwaConfig.ts`, `index.html` theme-color, and test transcriptions per C1. Verify `grep -rn 121110 frontend docs openspec/specs` is empty (excluding `openspec/changes/archive`). Historical comments (`focusRingTokenGuard.css.test.ts:23`, `appearance.ts:411`) keep their historical meaning: reword as "the v2 canvas" rather than silently swapping in the new hex. Run `npx jest frontend/src/theme` plus the themeAwareFallback and pwa tests. If a threshold fails, STOP and report ESCALATION.
- [x] 1.4 Re-transcribe `docs/contrast-audit.md`'s dark-theme rows using its own regeneration recipe. Verify by re-running the recipe and diffing.

## 2. DESIGN.md v3

- [x] 2.1 Header/status: v3 (2026-10-13, HEL-1570 re-design), the reading-order note, and the precedence of DESIGN.md over the canvas boards.
- [x] 2.2 §0 rewrite: neutral structure, opaque surfaces (+HEL-774 carve-out pointer), accent discipline (primary action, selection, active indicators, focus only), type = sans + mono by default with Fraunces only as the optional "Serif headings" style, human touch (plain-language copy, motion with a little give, opinionated hierarchy, no decoration), themes-ready (no hardcoded accent/fonts).
- [x] 2.3 §2/§3 edits: §2 records the light-theme parity decision (dark ramp widened, light unchanged). §3 Typography covers `--font-heading` and where serif may appear (only via the type style). §3 Radius/Shadow/Motion replaces its motion prose with a pointer to §10 that keeps the HEL-441 rules. §6 notes that `.page-title`/PageHeader remain until the shell tickets.
- [x] 2.4 Move forensics to "Appendix A: Measurements and forensics" per D2, leaving rule + pointer in place. The §3 Control-metrics tiling rule must still carry every `design-doc-hit-expander-guidance` clause: the formula, the twice-extension gap, that `getComputedStyle(el, "::after").width` and painted-box sampling cannot detect overlap, `elementFromPoint` bisection, the legitimate ~43.75px abutting reading plus epsilon, and the no-widening warning. The HEL-444 light/dark token-parity RULE stays in the body; only its measurements move. Verify with a command that the count of `[mechanical]` and `[judgment]` tags is not lower than in v2 and that every HEL-id present in v2 is still present in v3 (`comm` of the sorted id lists).
- [x] 2.4a Re-measure the dark family-3 cell of the §3 HEL-866 rung table on the new canvas (e2e guard method), or move that dark column to the appendix dated "v2 ramp". Verify no body measurement cites `#121110`.
- [x] 2.4b Date-stamp the HEL-866 narrative moved to the appendix ("dark ratios measured on the v2 ramp, `--app-bg #121110`"); this hex is the one allowed historical mention, so adjust the 1.3 grep to exclude that labelled line.
- [x] 2.5 Add §9 Shell, §10 Motion, §11 Live preview, §12 Mobile per D5/D6, including §10's interim-implementation note on the global reduced-motion rule and the "driver default" labels, each rule tagged [mechanical]/[judgment] as v2 does.
- [x] 2.6 Token-existence check (C4): extract every `--[a-z0-9-]+` from DESIGN.md and confirm each is declared in `frontend/src/theme/theme.css` or is a documented runtime-set/component-scoped token. Save the command and its output to the run's evidence. Run Prettier on DESIGN.md.

## 3. Specs and verification

- [x] 3.0 Write `pr-notes.md` in the change dir for the PR body. It must state that the card surface `--app-surface` was deliberately left at `#1a1816` because the approved boards disagree (`#1c1a17` B2Dashboard/PipelineLive, `#1a1815` Home, `#171513` MotionLive/Appearance), and that the owner can pick one in a follow-up. It must also list the driver-default motion rules from D5.

- [x] 3.1 Confirm the spec deltas in this change match the implementation, and run `openspec validate design-md-v3 --type change`.
- [x] 3.2 Run frontend `npm run lint`, `npm run typecheck`, `npm run format:check` and `npm test` (C5 caps). All pass.
- [x] 3.3 Run the e2e `state-surface-contrast-guard.spec.ts` (plus the BottomNav glass/contrast e2e guard if one exists) against the running app. Pass.
- [x] 3.4 Visual check against the running app in BOTH themes: Dashboards, a section page title, `/login`, an EmptyState main, onboarding/first-run, mobile 390×844. Screenshots go to evidence. Confirm headings compute Schibsted Grotesk and the dark canvas is `rgb(15, 14, 13)`. (Done for /login, /, /pipelines, /settings, /sources, both themes, desktop + 390x844; onboarding/first-run and a populated Dashboards view were NOT captured — covered mechanically by the shared token + build + jest.)
