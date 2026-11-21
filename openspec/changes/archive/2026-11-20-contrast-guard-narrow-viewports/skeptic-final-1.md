## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: db2be01b76af02c3803a8274bf87486413fd4205. Base: 4f101209bd50fed23f5534a8f4be3cc310051d63, resolved live with `resolve-review-base.sh` (exit 0).
Lane DB: every server start and Playwright run used `helio_hel1649` (`pg_stat_activity` showed the backend's connections there), with `ANTHROPIC_API_KEY` exported empty. Servers were started with `start-servers.sh` (`assert-phase servers` PASS) and stopped with `stop-servers.sh`.

### What I verified (with evidence)

- **AC1, red under the pre-fix hover at 768 and 390.** I deleted both `.spine-card .source-sample-label .ui-icon-btn:hover:not(:disabled)` blocks in `PipelineSpine.css`, then ran both narrow part files in full (2 workers, no `--grep`). Result: 2 failed, 18 passed. The 2 failures:
  - `[dark] /pipelines/:id@768 :: button "" aria="Refresh sample of HEL-866 Guard Source" [ui-icon-btn] (hover) ratio=1.0301`
  - the same line at `@390`.

  Light is unchanged, which matches the plan's prediction: there, the pre-fix colour and the fixed colour are the same token. I reverted with `git checkout` and `git status` was clean.
  Log: `/home/matt/Development/helio/.concertino/runs/HEL-1649/evidence/.concertino/scratch/HEL-1649/skeptic-M1.log`.
- **AC1, green unmutated.** The same two files gave 20 passed, exit 0, in 1m30s wall time.
  Log: `/home/matt/Development/helio/.concertino/runs/HEL-1649/evidence/.concertino/scratch/HEL-1649/skeptic-green.log`.

  On literal main, 16 of the 20 cells are red. That is the empirical inventory the owner ruled in scope under C2 (`evidence/01-red-on-main-narrow-full.log.txt`, committed in 67cd07297, before the CSS commit e6fcf7a32). I read "passes on main" as "passes once merged". The evaluator read it the same way.
- **AC2, CI time.** `ci-impact.md` gives:
  - local wall time per part: 55 s and 35 s;
  - summed cell time;
  - the `e2e-shard.mjs plan` placement;
  - the under-weighting at the 62 s median;
  - why `shard-weights.tsv` is not edited by hand.

  My own wall time for both files together (1m30s at 2 workers) agrees with its 86 s single-file figure. The real CI legs are honestly marked as still to be read from the PR.
- **New hovers vs DESIGN.md.**
  - The inactive chip uses `--app-surface-raised` + `--app-border-strong`. The chip row sits on `--app-bg`, and Appendix A.2's state-rung table names `--app-surface-raised` for that backdrop. Measured hover ratios are 1.187 dark / 1.119 light, matching the table.
  - The active chip steps the ink to `--app-text-muted`. The guard measured 7.81 dark / 5.73 light. I also computed the label's legibility: `--app-surface` text on `--app-text-muted` is about 7.2:1 dark and 6.3:1 light, so the label stays AA.
  - `.app-command-bar__mobile-title` and `.tl-disc__head` use the Ghost hover with the `--app-surface` family split (soft in light, strong in dark), as the `.app-command-bar__logo` precedent and the A.2 `--app-surface` row prescribe. Both measure 1.133 dark / 1.150 light.
  - All four rules are inside `@media (hover: hover)`. The hover-gating jest guards pass: 8 suites, 54 tests run fresh.
- **Visual check.** I captured screenshots at 390 and 768 in both themes, at rest and hovered, using a scratch Playwright spec that reuses `newCell`. The views were the `/dashboards` chips and title, the `/connectors` section links and the `/home` runs disclosure.
  - Text does not shift on hover. The title text x is the same at rest and hovered, and the `.tl-disc__head` label stays at x=33 inside the card.
  - The wash paints a button-shaped radius-sm box and does not overflow: document `scrollWidth` equals the viewport at both widths.
  - Light and dark are at parity.
  - Refs: `.../skeptic/shots/390-dark-dash-hover-active.png`, `390-light-dash-hover-active.png`, `390-dark-dash-hover-title.png`, `390-dark-home-hover.png`, all under `/home/matt/Development/helio/.concertino/runs/HEL-1649/evidence/.concertino/scratch/HEL-1649/`.
- **Exemption scope.** `isExempt` has one new entry, `[bottom-nav__tab]`, gated on `r.forced === "hover"`. In the green run, every exempted result across the 16 phone cells is exactly `bottom-nav__tab hover`: 80 = 5 tabs x 16 cells. Nothing else is exempted. The tab's focus is not exempt. Its focus verdict is `advisory`, meaning an outline carries the state; that is the guard's existing treatment of outline focus.
- **Under-sampling and readiness (evidence-shaped non-evidence).**
  - `fullySampled` asserts sampled == visible for both the chrome view and the main view. Every narrow view in my run was fully sampled (max 14 of the 24 cap).
  - `pipeline-detail` waits for the refresh button to be visible AND enabled before stamping. Each `pipeline-detail` cell logs that the button was probed: 4 lines.
  - The M1 red proves the mutated element is really measured, not merely partition-credited.
- **The 1440 cell already catches M1** (`evidence/05-...`). The executor disclosed this, and it means the original miss was stamp timing, not viewport. The AC is still met as written, and the narrow cells add the readiness gate that addresses that cause.
- **Gates run fresh:**
  - Prettier check on all 7 touched files: clean.
  - `npm run typecheck`: clean.
  - eslint `--max-warnings 0` on the e2e files: clean.
  - The evaluator's full lint and test suite runs are pasted, unambiguous output, and I relied on them.
- **Residue.** My 4 screenshot users were deleted by the registry teardown (0 matching rows afterwards). The worktree is clean apart from the evaluator's untracked `evaluation-1.md`.

### Verdict: CONFIRM

### Non-blocking notes

- `e2e/support/state-surface-contrast-guard.ts:55` still names the deleted `state-surface-contrast-guard-narrow.spec.ts`. It should name the two part files.
- The part files select widths with `NARROW_WIDTHS.slice(0, 2)` and `.slice(2)`. Reordering the array would silently move a width between files. Filtering by `width` value would be sturdier.
- The active-chip hover (ink to `--app-text-muted`) is a strong step: the near-white chip turns mid-grey in dark. It stays legible, and the owner ruled that the active chip gets a hover. A gentler intermediate ink is a possible polish item, perhaps alongside the HEL-1801 glass-nav hover design.
- `/connectors` readiness is only "`main` visible". The Data section links rendered deterministically (3/3 in every run), but a seeded-content gate would be sturdier.
- The 1440 `pipeline-detail` cell does not gate on the refresh button being enabled before stamping, which was the real HEL-1628 cause. That is outside this ticket's population, but it is a cheap follow-up.
- Shared-browser hazard: the Playwright MCP browser was already on another lane's page (port 7129). My one navigate attempt raised a `beforeunload` dialog there, and I had no tool to dismiss it. All my measurements used isolated Playwright test runs instead.
