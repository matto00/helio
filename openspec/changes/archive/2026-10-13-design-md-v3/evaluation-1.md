## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `6cbf218b65b455f4181f7efc5536c4dc2234318d` (branch `task/design-md-v3-redesign/hel-1571`).
Diff base (resolved fresh with `resolve-review-base.sh`): `2c1ab0326fe6c171152bc59ff2918f433558296f`.

### Phase 1: Spec Review — PASS (one doc defect is raised under Phase 2)

| AC | Result | Evidence I produced |
| --- | --- | --- |
| Sans + mono is the default; Fraunces is only an optional type style | PASS | DESIGN.md §0.4 (L63-66) and §3 Typography (L325-348). `--font-display` is described only as the face that the "Serif headings" style assigns through `--font-heading`. `grep -rn "var(--font-display)" frontend/src --include=*.css` finds no consumer. |
| Motion section with named tokens that exist in theme.css, plus the Full/Subtle/Off and reduced-motion rule | PASS | §10 (L971-1047). My own check extracted every `--motion-*` name from DESIGN.md and matched it against a `^\s*<token>:` declaration in theme.css: 8 of 8 are declared. A wider sweep of every `--*` name in DESIGN.md leaves only BEM modifiers, `--app-`/`--space-`/`--text-` prefixes, the explicitly not-adopted `--app-state-hover/selected`, the runtime `--panel-surface-override` and the component-scoped `--toast-exit-duration`. All of those are legitimate. |
| Shell section (rail, context list, tabs, meta row, ⌘K) and a Live-preview section | PASS | §9 (L923-969) and §11 (L1049-1076). |
| Forensics in an appendix linked from the body; every guard still passes | PASS | Appendix A.1-A.10, with a pointer left at each source location. `[mechanical]` tags went from 22 to 40 and `[judgment]` from 12 to 31. `comm -23` of the v2 and v3 HEL-id sets is empty. |
| Lint, typecheck and tests pass unchanged | PASS | See Phase 2 gates. |

Other checks:
- **§0-§8 numbering (C2).** Preserved. The `##` headings §0-§8 sit in the same order with the same titles, and §9-§12 plus Appendix A are appended after them.
- **design-doc-hit-expander-guidance.** Every clause is still in the body at §3 "Expander tiling" (L307-320): the `(44 - controlSize) / 2` formula, the twice-extension gap, the statement that `getComputedStyle(el, "::after").width` and painted-box sampling cannot detect overlap, `elementFromPoint` bisection, the ~43.75px abutting reading with its `>= 44 - samplingStep` epsilon, and the no-widening warning.
- **Normative rules stay in the body.** The HEL-866 rung table (as a 3-row rule), the HEL-774 floors and the `-3px` offset, the §8 focus-ring and accent-text rules, and the HEL-444 parity rule are all still in the body. The appendix holds measurements and history. One normative-sounding sentence lives only in the appendix: the OrbitMark logotype exception at A.10. It came from the trailing v2 "HEL-444 re-test" section, which design.md D2 moves in full, so this is by plan.
- **Scope.** No shell, motion-primitive or `data-motion` code is in the diff, which matches the non-goals. The pwa-installability spec edit is covered under "Executor claims".
- **CONSTRAINTS C1-C6.**
  - C1 is honored. I diffed every `*.test.ts` change: `appearance.test.ts` and `themeParityGuard.css.test.ts` only swap the transcribed `#121110` for `#0f0e0d` (fixture or literal) with no assertion change. `tokenAuditSweep.css.test.ts`'s allow-list gains only the new `--font-heading`. `focusRingTokenGuard.css.test.ts` changes a comment only. No test file was deleted.
  - C3 is honored: no font family or accent is hardcoded.
  - C4 is honored: `evidence/token-existence.out` exists, and I re-ran the check myself.
  - C6 is honored: the diff adds no CSS file.

### Phase 2: Code Review — FAIL

Gates, run fresh in WORKTREE_PATH:
- `npm run lint`: clean, zero warnings.
- `npm run format:check`: "All matched files use Prettier code style!"
- `npm run typecheck`: clean.
- `HELIO_JEST_MAX_WORKERS=3 nice -n 19 npm test`: 590/590 suites and 7063/7063 tests pass, exit 0.
- `npm --prefix frontend run build`: exit 0.
- Also clean: `npm run check:tokens` (every `var(--*)` resolves), `check:openspec`, `check:spec-structure` (485 specs, 0 issues), and `openspec validate design-md-v3 --type change` ("valid").
- No backend files changed, so `sbt testFull` was not required.

Code findings:
- The dark-canvas sync sites are complete. `grep -rn "121110\|18, 17, 16"` over `frontend e2e docs openspec/specs DESIGN.md` (archive, node_modules and .jest-cache excluded) returns exactly one hit: the dated, labelled line at DESIGN.md:1168, which task 2.4b allows.
- The regenerated `--app-selection-bg` fallback `#552c10` matches the live runtime derivation: the running app writes inline `--app-selection-bg: #552c10` for the default dark accent `#f97316`.
- The `docs/contrast-audit.md` dark `--app-bg` cells moved in the expected direction (higher ratios on a darker canvas), and the guard is the arbiter.
- I found no DRY, type-safety, security or dead-code problems. The code change is token plumbing only.

**Issue 1 (doc defect, blocking).** At DESIGN.md:401-405, Prettier rewrapped the carried HEL-441 D7 rule and turned "(fade + 4–10px rise)" into a nested Markdown list item. The source now reads:

```
  - **[judgment, HEL-441 D7]** Modals/popovers/auth card animate in once (fade
    - 4–10px rise). A backdrop fade paired with its panel's rise
      (`MobileNavSheet`, `RefinementChatDrawer`) counts as ONE entrance
```

When rendered, the rule ends at "animate in once (fade" and then a sub-bullet opens with "4–10px rise). A backdrop fade …". The "+" is gone and the rule no longer reads as "a fade plus a rise". This is a normative rule in the binding document this ticket delivers. The intact v2 wording survives only in Appendix A.5, which is not authoritative. I scanned the file and found no other list-marker mangling.

**Issue 2 (contradiction in binding text, blocking, same paragraph).** DESIGN.md:398-400 now says "a loop role used by two or more surfaces needs a token (HEL-441 D1) — do not build a duration scale ahead of that need." §10, in the same document, builds a general duration scale with no consumers yet. In context HEL-441 D1 is about loop tokens, but the shortened sentence reads as a blanket ban that §10 breaks. A HEL-1573 reviewer could cite it against the motion foundation.

### Phase 3: UI Review — PASS

Servers were started with `scripts/concertino/start-servers.sh` on 7003/9910 and `assert-phase.sh servers` returned PASS. I logged in as the dev account and checked the running app. Each claim rests on computed values, which are self-authenticating. The screenshots are illustrative and not load-bearing; they are not persisted, because they sit outside the worktree in the main checkout's `.playwright-mcp/hel1571-eval/`.

- **Dark canvas.** On `/login`, `/` and `/pipelines`, `body` computes `rgb(15, 14, 13)` and `--app-bg` is `#0f0e0d`. Both `theme-color` metas read `#f4f2ed`/`#0f0e0d`.
- **Light theme is unchanged.** `body` computes `rgb(244, 242, 237)`.
- **Headings are sans.** These compute `"Schibsted Grotesk"` in both themes: the `/login` `.auth-card__brand-name` and `.auth-card__title`, and the live `.app-command-bar__wordmark` (16px, weight 600, letter-spacing 0.16px). The wordmark is the one item the executor did not compute.
- **A discriminating "one switch" probe.** A plain computed-style check cannot tell a rule that applies from inherited sans, so I set `--font-heading: var(--font-display)` on `:root` in the live page. Every heading role then flipped to `Fraunces`: `.first-run-drop__title`, `.onboarding-checklist__title`, `.ui-empty-state--main .ui-empty-state__title`, `.page-title`, `.wordmark`, `.auth-card__title`, `.auth-card__brand-name` and the live command-bar wordmark. Body text stayed Schibsted Grotesk. Removing the override restored sans. This proves that the onboarding and first-run titles, which no one screenshotted live, read the token. It also proves that HEL-1572's single-token contract works.
- **Visual pass.** I viewed a populated dashboard ("HEL-1189 Skeptic Verify": table and chart panels) at 1280 in dark and light, `/pipelines` at 1280 in light, `/pipelines` at 390×844 in dark (glass BottomNav present), and `/login` in dark. Nothing is broken, overlapping or missing. Sans headings sit in the hierarchy naturally. In dark, the sidebar (`--app-surface`) is now visibly lighter than the deeper canvas. §9 calls this out explicitly as HEL-1574's to resolve, so it is not a finding here. Subjective cohesion is left to the skeptic.
- **Console.** No errors beyond the expected pre-login `401 /api/auth/me`, and no warnings.
- **e2e.** I did not re-run `state-surface-contrast-guard.spec.ts` myself. The executor's `evidence/e2e-state-surface.out` shows 18 passed, and the jest theme guards I did run cover the threshold math.

#### Executor claims, verified
1. **Direct edit of `openspec/specs/pwa-installability/spec.md`.** It is redundant but harmless, so I am not blocking on it. The MODIFIED delta's requirement header and body now match the main spec byte-for-byte, so archive will replace the requirement with identical text. The edit was driven by task 1.3's grep scope, which includes `openspec/specs`. It is inconsistent with the other two MODIFIED capabilities (error-state-pattern and page-shell-primitives), which were correctly left for archive to apply. See the suggestion below.
2. **No onboarding or populated-dashboard screenshot.** Confirmed. I covered the populated dashboard visually, and onboarding/first-run by the discriminating token probe above.
3. **Wordmark font never computed.** Confirmed. I computed it: Schibsted Grotesk, and it follows the token.
4. **Tasks ticked before 3.3/3.4 ran.** This is a process slip with no residue. Evidence for both now exists: e2e 18 passed, and 20 screenshots plus `visual-computed.json`.
5. **`tokenContrastGuard.css.test.ts` byte-identical to base.** Confirmed. `git diff` against base is empty, the working tree is clean, and the sha256 is `41c42b55…74b6` for both the file and `git show <base>:…`.

### Overall: FAIL

### Change Requests
1. **DESIGN.md:401-405.** Repair the Prettier-mangled HEL-441 D7 rule so "+" is not read as a list marker. For example, write "Modals/popovers/auth card animate in once (a fade plus a 4–10px rise). A backdrop fade paired with its panel's rise (`MobileNavSheet`, `RefinementChatDrawer`) counts as ONE entrance …" so that no line starts with `+`/`-`. Re-run `npx prettier --write DESIGN.md`, then confirm with `grep -n -B1 "^\s*- [0-9]" DESIGN.md` that the rule is a single bullet.
2. **DESIGN.md:398-400.** Scope the carried HEL-441 D1 sentence to loops so it no longer contradicts §10. For example: "a loop role used by two or more surfaces needs a token (HEL-441 D1); do not mint a loop-duration token ahead of that need. (The transition/entrance scale is §10.)"

### Non-blocking Suggestions
- **DESIGN.md A.2 (L1155-1174).** The v2 rung table appears twice: once inside the "verbatim" block and again under the "v2 ramp … dated record" label. Consider dropping the measured column from the first copy, so that the labelled one is the only place carrying the v2 dark figures.
- **DESIGN.md:1253 (A.5).** "see `Skeleton`'s own explicit override below" now dangles in the appendix. Change it to "see §3 Radius / Shadow / Motion".
- **pwa-installability.** Pick one way to land it. Either revert the direct `openspec/specs/pwa-installability/spec.md` edit and let archive apply the delta, as the other two capabilities do, or keep it and say in pr-notes.md that it was pre-applied so the 1.3 grep scope passes. Both are valid. The current state just needs to be explained.
