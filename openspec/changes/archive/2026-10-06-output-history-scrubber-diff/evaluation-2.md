## Evaluation Report — Cycle 2 (evaluation-2.md)

**Reviewed:** HEAD `bb70d84726df8bbfef39e45116837351aed84876`, the cycle-2 fix commit on top of `c6ccfe618`. The base was resolved live: `3962e6eb2c09a009259c8f75f2cf1aa4c1fe3526`.

**Evidence location:** `EV/` = `/home/matt/Development/helio/.concertino/runs/HEL-1277/evidence/openspec/changes/output-history-scrubber-diff/screenshots/eval-2/`. Worktree copies are in `screenshots/eval-2/`, and the cycle-1 measurements were moved to `screenshots/eval-1/`.

### Phase 1: Spec Review — PASS

- Cycle 1 found no spec issues, and `bb70d8472` does not change any acceptance criterion or constraint.
- The four change requests and both suggestions are addressed as described in design D6–D8 and DESIGN.md §3.
- **Seconds on capture-time labels.** Seconds are shown when the selected point and its comparison fall in the same minute. They are applied consistently to the header, the "vs" caption, the metric "vs", the chart overlay label and the "no longer present" count.
- **`disablePinning`.** It is passed only from `HistoryRows`. Other `TableRenderer` callers keep their default behaviour; the existing tests stay green.
- **C1–C4 still hold.** No new copy says "previous run". The only payload consumer is still `HistoryRows`.

### Phase 2: Code Review — PASS

**Gates, run by me against HEAD in `WORKTREE_PATH`.** Logs were kept under `.concertino/`, which Playwright does not clear.

| Gate | Result |
|---|---|
| `check:repo-integrity` | PASS |
| `lint` | PASS |
| `typecheck` | PASS |
| `check:e2e-types` | PASS |
| `format:check` | PASS |
| `check:schemas` | PASS |
| `check:spec-structure` | PASS |
| `check:openspec` and selftest | PASS |
| `check:dependabot` and selftest | PASS |
| `check:cloud-run-cpu` and selftest | PASS |
| `check:scala-quality` | PASS |
| `check:test-temp-dir-hygiene` and selftest | PASS |
| `check:no-credential-leak` and selftest | PASS |
| `check:tokens` and selftest | PASS |
| `check:helio-mcp-types` | **FAIL**, environmental (see below) |
| Root jest (`--maxWorkers=2`) | PASS: 39 suites, 376 tests |
| Frontend jest (`--maxWorkers=2`) | PASS: 449 suites, 4686 tests (+2 suites, +7 tests since cycle 1) |
| `npm --prefix frontend run build` | PASS |
| `e2e/hel1277-output-history-scrubber.spec.ts` (`DEV_PORT=6709`, `--workers=2`, `nice -n 19`) | PASS: 4/4, including the new 375px range-height assertion. Log: `EV/e2e.log` |

**`check:helio-mcp-types` is environmental.**
- The only error is `helio-mcp/src/index.ts(58,52): error TS2554` (full log: `EV/hook-check-helio-mcp-types.log`).
- `index.ts` is not in the diff. The linked `helio-mcp/node_modules` has SDK 1.29.0, but `package.json` requires `^1.31.0`.
- This is the same cause I confirmed in cycle 1.

**Backend suite.** `git diff --stat c6ccfe618 HEAD -- backend schemas helio-mcp` is empty. The backend, schema and helio-mcp trees are therefore identical to the ones my cycle-1 run of `nice -n 19 sbt testFull` passed (6042 tests, 0 failed, no FirstRunRoutesSpec timeout, no "Java heap space"). I did not run sbt again, so there was no `sbt --client shutdown` to run.

**The second `-n` reason (lint failing on my scratch files).**
- The executor's explanation is correct. In cycle 1 I left untracked `.eval-hel1277/*.cjs` files at the worktree root, and the root ESLint run scans them.
- This cycle I moved those measurements and screenshots into `screenshots/eval-1/` and deleted the scratch files by exact path.
- This cycle's scratch lived under `.concertino/eval-hel1277/`, which ESLint and Prettier both ignore, and is now deleted.
- I re-ran `npm run lint` and `npm run format:check` on the cleaned worktree: both exit 0 (`EV/../eval-2/hook-lint.log` and `hook-format-check.log` in the worktree).
- `git status` now shows only `residue.md` (modified) and the untracked `screenshots/` directory, which is in the gitignored and lint-ignored `openspec/` tree.
- With the helio-mcp `node_modules` fixed, the pre-commit hook would pass.

**Code review of `bb70d8472`.**
- **`withAlpha`.** It handles the hex and rgb forms the token resolves to (`#645e56` and `#aaa49c` were confirmed in cycle 1), and it is unit-pinned. If the token is in any other form it falls back to an opaque fill. That fallback still keeps contrast and is only less subordinate. Non-blocking.
- **Comparison-error branch.** It is correct, is tested with a comparison-only rejection, and the diff stays disabled.
- **CSS guards.** They are plain source greps of the media query and token. They are acceptable because the e2e and my own measurements cover the rendered result.
- **Copy.** No dead code, and no "previous run" text.

Issues: none.

### Phase 3: UI Review — PASS

**Setup.**
- Servers were started with `start-servers.sh` on 6709/9616, and `assert-phase servers` passed.
- I used my own headless Chromium scripts only, not the MCP browser.
- I seeded a fresh beta user. It has a table Output with payloads, and a single-series bar chart Output with `compare: previous_run` placed on a dashboard panel whose appearance `chartType` is `bar`.

**CR4: bar overlay contrast — resolved.** I measured rendered pixels on the running app in both themes (`EV/bar-overlay-contrast-eval2.txt`; screenshots `EV/dash-bar-overlay-{light,dark}.png` and `-dpr2.png`):
- **DPR 2:** the boundary pixel is exactly the `--app-text-muted` token on every side.
  - Light: rgb(100,94,86), 6.25:1 against the surface rgb(253,252,250).
  - Dark: rgb(170,164,156), 7.17:1 against rgb(26,24,22).
- **DPR 1:** the 1px border is antialiased. The strongest boundary pixel per side, against the surface:

  | Theme | Left | Top | Right |
  |---|---|---|---|
  | Light | 3.93 | 4.99 | 3.01 (the narrowest margin) |
  | Dark | 4.90 | 5.97 | 3.86 |

- The translucent interior fill is unchanged at 2.01 (light) and 2.47 (dark). That is intended: the boundary now carries the 3:1.
- The legend and axis tooltip show "vs previous" in both themes.
- The bar layout is still grouped side-by-side, so primary bars are about half width. That was left to the skeptic and is not re-judged here.
- Note for the skeptic: the first scan block in the `.txt` sampled the adjacent primary bar by mistake. The later "overlay-only" pixel dump and the DPR 2 block are the authoritative numbers.

**CR1: scrubber touch target, checked with a coarse pointer — resolved.** From `EV/probe2-report-{light,dark}.json`:
- At 375×812 with `hasTouch`/`isMobile`, `(pointer: coarse)` = true. The range input's box is 211×44, and its `elementFromPoint`-bisected hit height is **44.5** in both themes.
- I also checked a coarse pointer at 1180px, which exercises only the `(pointer: coarse)` arm of the media query. Its hit height is **44.75** in both themes.

**CR2: History button height — resolved.**
- At 1440px (fine pointer) it renders 79×28, the `--control-sm` height, in both themes.
- At 375px with a coarse pointer, its bisected hit extent is **44.5** in both themes (`EV/history-button-hit.json`).
- One earlier probe pass read 40.75 because it measured mid-layout, before `scrollIntoView` and the placement-count line had settled. A dedicated re-measure after settling, plus the dark pass, both gave 44.5.

**CR3: comparison-payload load error — resolved.**
- I returned 500 from only the comparison point's `/rows` on the running app.
- Both themes then render "Couldn't load the stored rows from Oct 6, 02:09:27 PM to compare." as `role="alert"`, in intent-error colour: rgb(175,51,37) in light and rgb(241,123,103) in dark.
- There are no highlighted rows, no "no longer present" count, and no "weren't stored" copy (`EV/comparison-load-error.json`, `EV/history-comparison-load-error-{light,dark}.png`).

**Suggestions, now implemented.**
- **Pinning:** 0 pin buttons on every point, in both themes.
- **Seconds on labels:** same-minute labels now show seconds, e.g. "02:09:40 PM" vs "02:09:27 PM".

**Console.** No page errors. The only HTTP errors were the pre-login `/auth/me` 401 and the pre-existing `/schedule` 404 for a pipeline with no schedule.

Issues: none.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Points captured in the same **second**, such as scripted back-to-back runs (seen here: 02:09:27.514 vs 02:09:27.422), still give identical labels. Real-world runs this close together are rare. Optional fix: fall back to showing the ordinal position ("run N of M") when two labels would read the same.
- The PR body should state the two `-n` bypasses and their causes:
  - the stale linked `helio-mcp/node_modules`, which is environmental;
  - the evaluator's untracked cycle-1 scratch files, which are now removed.
- Process note: the spec writes its screenshots into `screenshots/` unconditionally, so each evaluator e2e run replaces the executor's images with fresh ones from the same commit. This happened again this cycle.
