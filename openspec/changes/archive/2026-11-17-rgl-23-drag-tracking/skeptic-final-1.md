## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: ea991704703b1ea9d6edc12ae683ea77a820732e. Live review base (resolve-review-base.sh, origin/main): a6499da125f7984d9d0338f09a0ef62173865382.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/rgl-23-drag-tracking/HEL-1728`.
- **Diff:** `git diff a6499da1...HEAD` touches only `.github/dependabot.yml` (+9) and `openspec/changes/rgl-23-drag-tracking/**`. `frontend/package.json` (`^2.2.2`) and `package-lock.json` (react-grid-layout 2.2.4) are unchanged.
- **Shipped install is pristine 2.2.4:** `frontend/node_modules/react-grid-layout` is byte-identical (`diff -r`) to the 2.2.4 tarball. The tarball's sha512 equals the lockfile `integrity` (`Eb57FsgO...`). react-resizable is 3.1.3. `.vite` was absent before the server start, so no stale bisect overlay was served.
- **AC1 (bisect):** the raw logs in `.concertino/scratch/HEL-1728/bisect-steps.log` and `bisect-run.out` show `git bisect run` naming eb35b82c88df19acf6f14ab5e89216968da887d7 as the first bad commit. Each step carries a served-bundle sha and a guard-marker count. At eb35b82c the result is 6 tracking-assertion failures; its parent b5fbb95e is 3/3 green. That is red-first evidence on 2.3.0 vs green on 2.2.4, as `red-baseline.md` claims (20/20 fail vs 20/20 pass).
- **Test vs library was decided by measurement:** the raw sweep JSONs in scratch show, on 2.3.0, `drag delay=100ms` 0/5 (diffs 397 x5) and the control row 0/5 (410 x5). On the 2.2.4 dist the 100 ms row is 5/5 (diff 0). So slower input fails too, which rules out "the test is too fast". The minimal page (`min/hel1728-min.tsx`, no app code) reproduces at eb35b82c and is green at its parent (`minimal-repro.md`), so this is a library regression.
- **Upstream claims, checked read-only (nothing posted):**
  - `gh issue view 2303` returns CLOSED 2026-10-31, "2.3.0: dragged/resized item no longer follows the pointer between grid steps (GridItem memo ...)".
  - `gh pr view 2304` returns MERGED, mergeCommit 1468c0fcfa7fbf0f8e39f369051326bcf81cc6bc.
  - In the scratch clone, `git tag --contains 1468c0f` lists no tag.
  - `npm view react-grid-layout versions` lists 2.3.0 as the latest version.
  - So "unreleased" holds today.
- **AC2 (pin + ignore rule + reason + upstream link):**
  - Placement: the rule sits in the `/frontend` npm block's `ignore:`, directly after the HEL-1725 rules (dependabot.yml:59-67).
  - YAML: parsed with js-yaml, the `/frontend` ignore list ends `{"dependency-name":"react-grid-layout","versions":[">=2.3.0"]}`.
  - Gates: `npm run check:dependabot` exit 0 (OK); `check:dependabot:selftest` 6/6.
  - The comment cites only external URLs and `hel1573-motion-grid-chart.spec.ts:275`, with no `openspec/changes/...` path, so nothing breaks on archive.
  - `upstream-issue-draft.md` is headed "DO NOT FILE: duplicate of react-grid-layout#2303".
- **AC3, re-run by me:** `DEV_PORT=7160 BACKEND_PORT=10067 nice -n 19 npx playwright test e2e/hel1573-motion-grid-chart.spec.ts:275 --repeat-each 20 --workers 2` returned exit 0 and `20 passed (1.6m)`. The harness reported "deleted 20 recorded throwaway user(s)". Log: `.concertino/runs/HEL-1728/evidence/openspec/changes/rgl-23-drag-tracking/skeptic-final-evidence/hel1573-275-x20.log`.
- **Desktop drag AND resize in the running app, light and dark, on shipped 2.2.4:**
  - Method: a temporary scratch spec (`e2e/hel1728-skeptic.spec.ts`, deleted after the run) run through the repo Playwright config on DEV_PORT 7160. The theme was set via the real `helio-theme` localStorage key before load, and the spec asserted `documentElement.dataset.theme` equals the expected theme.
  - Drag: by the handle, 60 Hz moves, +360/+240 px.
  - Resize: by the SE handle, 60 Hz moves, +260/+160 px.
  - Result: exit 0, 2 passed.
  - Drag samples in both themes: moved == pointer delta exactly (120/80, 240/160, 360/240), with `transition: none` while held.
  - Resize samples in both themes: dw/dh within 1 px of the pointer (86/53, 173/106, 260/160).
  - Screenshots, which I looked at: in both themes the held item sits under the pointer, with the placeholder at the snapped cell and correct theme surfaces.
    - `.../skeptic-final-evidence/sk-light-1-drag-held.png`
    - `.../sk-dark-1-drag-held.png`
    - `.../sk-light-3-resize-held.png`
    - `.../sk-dark-3-resize-held.png`
    - All under `.concertino/runs/HEL-1728/evidence/openspec/changes/rgl-23-drag-tracking/skeptic-final-evidence/`.
  - Data: `sk-light.json` and `sk-dark.json` in the same directory.
  - Console errors: one pre-login 401, plus a localStorage SecurityError from my own init script running on about:blank. Both are harness artefacts, not app errors.
  - The test users were deleted by the harness ("deleted 2 recorded throwaway user(s)").
- **Committed scratch specs are inert:**
  - Root jest `testPathIgnorePatterns` contains `/openspec/`.
  - Frontend jest/tsconfig include only `src` (plus configs).
  - Root tsconfig `exclude` has `openspec`, and eslint `ignores` has `openspec/**`.
  - `.prettierignore` has `openspec`.
  - Playwright `testDir: ./e2e`.
  - `npm run check:openspec` exit 0 ("openspec/ is clean"); `check:e2e-evidence-paths` and `check:repo-integrity` exit 0.
- **No UI files changed**, so there is no DESIGN.md judgment beyond confirming that drag/resize visuals are intact in both themes, which they are.

### Verdict: CONFIRM

### Non-blocking notes

- `evaluation-3.md` is **untracked**, even though commit ea99170 says "commit the evaluations". Commit it with the archive, or note it. My `skeptic-final-evidence/` directory is untracked too: its PNGs are gitignored, the .log and .json files are not. The durable copies are already under `.concertino/runs/HEL-1728/evidence/`.
- `files-modified.md` lists `drag-held-{light,dark}.png` as change files, but `*.png` is gitignored, so they are not in the diff. Durable copies exist in the run evidence directory.
- `package.json` keeps `^2.2.2`, which still admits 2.3.0 on a manual `npm install`/`npm update`. The pin relies on the lockfile plus the dependabot ignore. Optionally tighten it to `~2.2.4` so a local update cannot silently pick up the regression.
- The removal condition cites `hel1573-motion-grid-chart.spec.ts:275`. Line numbers drift, so the test title would be a sturdier anchor.
- Pre-existing behaviour unrelated to this ticket: with `preventCollision`, a resize into the neighbour below snaps back on release (the width returned to 492 px). It is identical on main (2.2.4 is main's version).
