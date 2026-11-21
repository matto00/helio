## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: db2be01b76af02c3803a8274bf87486413fd4205. Base: 4f101209bd50fed23f5534a8f4be3cc310051d63, resolved live with `resolve-review-base.sh`.
Every server start, Playwright run and cleanup step used the lane-private DB `helio_hel1649`. The backend connections were confirmed there through `pg_stat_activity`, and `ANTHROPIC_API_KEY` was exported empty.

### Phase 1: Spec Review — PASS
- **AC1 ("fails at 768 and 390 under HEL-1628's pre-fix hover, passes on main"): verified independently on the split two-file layout.** The executor ran its mutations on the single 20-cell file before the split, so I re-ran M1 on the files as shipped. I deleted both `.spine-card .source-sample-label .ui-icon-btn:hover:not(:disabled)` blocks (PipelineSpine.css:441-451) and ran both narrow part files in full with 2 workers and no grep. Result: 2 failed and 18 passed. The two failures are `[dark] /pipelines/:id@768` and `@390`, each `button "" aria="Refresh sample of HEL-866 Guard Source" [ui-icon-btn] (hover) ratio=1.0301`. I then reverted the file and `git status` was clean. Unmutated, the same run gives 20/20 passed. Logs: `.concertino/scratch/HEL-1649/eval-M1.log` and `eval-narrow-green.log`.
  - "Passes on main" here means the merged app, i.e. the spec scenario "unmutated application passes". On literal main, without this change's CSS, 16 of 20 cells are red because the hovers are missing. That is the C2 inventory the owner ruled should be fixed, not a contradiction of the AC.
  - I did not re-run M2. Its log is supporting evidence only and the AC does not rest on it.
- **AC2 (CI time measured and stated):** `ci-impact.md` gives local wall and summed cell times for each file, a scaled estimate for CI, and the `e2e-shard.mjs plan` placement. It also states the median-weight under-weighting and explains why `shard-weights.tsv` is not hand-edited (README, HEL-1645). The PR's CI legs still have to be read and put into the PR body; this is recorded as pending, not claimed.
- **C1 is honored.** `.dashboard-chip` has the Secondary hover. `.app-command-bar__mobile-title` has the Ghost hover. The only exemption is the hover-only `[bottom-nav__tab]` `isExempt`, with a written reason citing HEL-1801, and focus is still asserted. M2 targets `.app-command-bar__logo`.
- **C2 is honored.** The red run on main was committed before any CSS change (commit 67cd07297 comes before e6fcf7a32). Every inventoried control now has a gated hover: inactive chip, active chip, section links (same classes), the mobile title, and `.tl-disc__head`. A second dashboard is seeded for narrow cells only. `hover-inventory.md` lists before and after ratios.
- **Tasks:** all are marked done and match the diff. The narrow spec was split into two files, which design.md D4 allows when one file exceeds the heaviest part.
- **Scope:** no scope creep. The CSS changes are limited to the C2 inventory.
- **Planning artifacts:** they reflect the final behavior. The proposal's Impact section names both part files.
- **Dropped 1100 `/connectors` connector seed:** the reasoning is sound. The row hover, the actions trigger and Test connection are not narrow-only, so they are out of this ticket's scope. The 1.05 finding is recorded as a spinoff candidate (see Suggestions).

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH:
- `npm run lint`: 0 warnings.
- `npm run format:check`: clean.
- `npm run typecheck`: clean.
- `npm test` (3 workers): root 71/71 suites (621 tests); frontend 891/891 suites (10423 tests). This includes the three `:hover` gating guards, which pass on the new rules.
- `npm --prefix frontend run build`: exit 0.
- No backend files changed, so `sbt testFull` does not apply.

Existing specs covering the touched surfaces, run as full files with 2 workers on the lane DB: 250 passed, 0 failed, 0 flaky (`.concertino/scratch/HEL-1649/eval-existing.log`). The files were:
- state-surface-contrast-guard-overlays-chrome, -routes-dense, -routes-light
- hel1583-glass-nav-dark, hel1583-glass-nav-light, hel1583-mobile-dashboard, hel1583-refresh-line-no-shift, hel1583-home-375
- hel1675-shared-hover, hel1735-feature-hover
- hel1642-home-phone-timeline, hel1665-home-phone-stability (light-dashboards-first, dark-summary-first)
- hel773-top-anchored-mobile-nav-sheet, hel813-mobile-touch-target-floor
- hel1782-viewer-shell, hel1681-refresh-control, hel1656-pull-to-refresh, hel1646-skeleton-refresh-slot, hel1668-phone-sheet

Design-standard [mechanical] rules:
- Every new `:hover` is inside `@media (hover: hover)` (§5, HEL-1675).
- Tokens only; spacing uses `--space-*` and the radius is `--app-radius-sm`.
- Light/dark parity: each new hover has an explicit value for each theme, either through a theme split or through a token that resolves per theme.

**Inactive-chip hover uses `--app-surface-raised` rather than §5's `--app-surface-soft`. This is accepted.**
- §3's state-rung table is marked [mechanical], and it makes the rendered guard the arbiter. For the `--app-bg` canvas backdrop it prescribes `--app-surface-raised`. Appendix A.2 records that `--app-surface-soft` measures worse on that backdrop (1.034/1.054).
- §5's warning is that `raised` collides with modal and top surfaces (`--app-surface-strong` interiors). The chip row and the `/connectors` section links sit on the page canvas, not in a modal, so the collision does not apply.
- design.md D2a and C2's "measured theme split" allowance cover choosing a rung by measured backdrop.
- Measured 1.187 dark and 1.119 light. Visually checked in the running app at 390 in both themes: a lifted pill with a stronger hairline, clearly visible and in keeping with the chip family.

**Active-chip hover steps the ink fill to `--app-text-muted`.** This stays inside the chip's own recipe family. Text contrast on the hover fill, computed from theme.css values:
- `--app-surface` #1a1816 on #aaa49c is about 7.2:1 in dark.
- #fdfcfa on #645e56 is about 6.2:1 in light.
- Both are above 4.5. The label stays legible, confirmed visually in both themes.

Ghost hovers (`.app-command-bar__mobile-title`, `.tl-disc__head`):
- They use the padding, negative-margin and radius technique from `.app-command-bar__logo`.
- I measured in the running app that the content does not move: `.tl-disc__head` content starts at x=33, the same as `.tl-disc__item`. The title keeps its 44px min-height and stays centred.
- The hover wash reads as a button shape in both themes.

DRY, typing and tests:
- The narrow cells reuse `newCell`, `probeView`, `stampDocument`, `assertPartitioned` and `finishCell`.
- No `any` is introduced.
- `fullySampled` turns the under-sampling gap into a hard failure.
- The readiness gate on the refresh button (visible and enabled) closes the stamp-timing gap that let HEL-1628 through.
- The executor recorded that M1 also goes red at 1440 today (evidence/05). That is an honest finding: for this rule, the gap was stamp timing, not viewport.

No [mechanical] violations found.

### Phase 3: UI Review — PASS
The servers were started with the canonical script on the lane DB and stopped with `stop-servers.sh`. I checked these hovers by hand in the running app at 390px with a fine pointer, in both themes:
- `/dashboards`: the active and inactive chips, and the command-bar mobile title.
- `/connectors`: the Sources section link.
- `/home`: the runs disclosure head.

Every hover was visible, nothing shifted, and the labels stayed legible. The guard cells measure the same states at 1100 and 768.

Other checks:
- The only console error was a 404 from my own mistyped seeding call (`/api/pipelines/:id/runs`), not from the app.
- The 1440 behaviour is unchanged: the three existing guard parts are green.
- Screenshots are in `.concertino/scratch/HEL-1649/eval-shots/`. They are corroborating only; no claim in this report depends on them.

My throwaway evaluation user was deleted from `helio_hel1649` by exact id and email, using the repo's `buildUserDeleteSql`. A count afterwards confirmed it was gone.

### Overall: PASS

### Non-blocking Suggestions
- **Stale file name in a code comment.** The header comment at `e2e/support/state-surface-contrast-guard.ts:55` still names `state-surface-contrast-guard-narrow.spec.ts`, which no longer exists after the split. It should name the two part files (`-narrow-1100-768` and `-narrow-390`). Also, line 35 of `e2e/support/state-surface-contrast-guard-narrow.ts` ("20 cells with 768/390") reads ambiguously; "20 cells in total" would be clearer.
- **Index-based split.** `NARROW_WIDTHS.slice(0, 2)` and `slice(2)` in the two part files depend on array order. Selecting by width (for example `NARROW_WIDTHS.filter((w) => w.width >= 768)`) would make each file's coverage self-describing and keep it correct if a width is added.
- **Spinoff ticket.** File the connector row, actions and Test-connection hover finding (about 1.05 at every width) as a follow-up rather than leaving it only in `hover-inventory.md`.
- **CI timing in the PR.** Record the real CI-leg durations of both new files in the PR body once CI runs, as `ci-impact.md` promises.
- **Process note.** My full run of the existing specs exceeded the 600s Bash timeout and was moved to the background by the harness. It finished normally (250 passed, 12.5 min) before I stopped the servers.
