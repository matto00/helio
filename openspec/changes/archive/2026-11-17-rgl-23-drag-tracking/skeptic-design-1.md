## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/rgl-23-drag-tracking/HEL-1728`. HEAD reviewed: `a6499da125f7984d9d0338f09a0ef62173865382`.
- Read ticket.md, proposal.md, design.md, tasks.md, workflow-state.md. No TODO/TBD placeholders. Every AC maps to a task: bisect -> 2.1/2.2; adapt-or-pin -> 4.1; 20/20 -> 4.2. Driver constraints (no #926, no upstream filing, draft in evidence dir, dependabot rule next to HEL-1725) are reflected in D5 and tasks.
- The spec's pointer sequence (`e2e/hel1573-motion-grid-chart.spec.ts:306-327`) matches design's description: `mouse.down()`, then `mouse.move(+40,+10,{steps:4})` with no wait, then three 6-step moves with 60ms waits, assertion `|moved-dx| < 30`. The ticket says the item "moved only 10px". That is exactly one step of the first 4-step move (40/4 = 10). So the item takes the first move and then stops tracking, inside the no-frame window right after `down`.
- Lockfile: `react-grid-layout` 2.2.4, `react-resizable` 3.1.3, `react-draggable` 4.5.0 (`frontend/package-lock.json:11337-11456`). `package.json:27` is `^2.2.2`.
- Published tarballs (`.concertino/scratch/HEL-1728/pkgs/{2.2.4,2.3.0}/package`) both have `exports` pointing to `dist/*.mjs` with hashed chunk files. Their only dependency delta is `react-resizable ^3.1.3 -> ^3.2.0`. `gitHead` is null in both, so no tag-to-tarball mapping is recorded. The upstream `build` script is `make build` (`build:ts` = tsup).
- e2e runs against the **Vite dev server** (`playwright.config.ts` header; `frontend` `"dev": "vite"`). `start-servers.sh:154` reuses an already-healthy server.
- `.github/dependabot.yml`: a `/frontend` block with the HEL-1725 `ignore:` list exists (:37, :47-58), so the Pin path's target is real.

### Verdict: REFUTE

The decision table (D5) and the test-vs-library check (D4) are both biased toward "Adapt test". D3's overlay procedure can also silently test the same bundle at every bisect step. Each defect is cheap to fix in the artifacts. Each could produce a confident wrong answer if implemented as written.

### Change Requests

1. **D3: the dist overlay is silently ignored by the running Vite dev server.** Vite serves pre-bundled deps from `frontend/node_modules/.vite/deps`. That cache is keyed on the lockfile and config, not on the contents of a package's `dist/`. Overwriting `node_modules/react-grid-layout/dist` with "restart nothing else ... clear `.vite` if needed" can therefore serve the previous step's bundle, so every midpoint gets the same verdict. Revise D3 and task 2.2 so that every step:
   - stops servers with `stop-servers.sh`;
   - removes `frontend/node_modules/.vite` unconditionally;
   - replaces `dist/` (rm, then copy, so stale hashed chunks cannot be picked up);
   - restarts with `start-servers.sh`;
   - **proves which build is being served**, for example a checksum or grep of a commit-distinguishing string in the served `/node_modules/.vite/deps/react-grid-layout*.js`, recorded per step in `bisect-log.md`.

   The task 2.1 endpoint check must use this exact procedure, and must show green at the 2.2.4 build and red at the 2.3.0 build *on the same base install*.

2. **D1/D2/D3/2.3: base install and restore are unspecified, and the restore as written does not restore.**
   - `npm install react-grid-layout@2.3.0` (1.1) rewrites `frontend/package.json` and `package-lock.json`. D2's `overrides` entry does the same. A later `npm ci` (2.3) then reinstalls **2.3.0**, not the baseline.
   - Add an explicit `git checkout -- frontend/package.json frontend/package-lock.json` (and confirm `git status` is clean for them) before each restore.
   - State which install the bisect overlays sit on: the 2.3.0 install with react-resizable 3.2.0, or the 2.2.4 install with 3.1.3. Hold it fixed for the whole bisect, given D2's result.
   - Record `node -p "require('react-grid-layout/package.json').version"` plus the resolved react-resizable version at each measurement (MISTAKES.md, "node_modules does not update itself").

3. **D4: "human pace" leaves out the realistic case the test exercises.** D4's human drag waits at least 2 frames (about 100ms) after `down`. A real user who presses and moves at once produces mousemoves within one frame of mousedown (a 125Hz mouse polls every 8ms; 1000Hz every 1ms). That is the same no-frame-after-down window the test hits, and the 10px-then-stop symptom sits in that window. Replace the two-point check with a **timing sweep**: delay between `down` and the first move of {0, 8, 16, 33, 100} ms, with move steps at a realistic poll interval (about 8ms), each repeated at least 5 times. Record the smallest delay that tracks reliably.

4. **D5: the "Adapt test" branch rests on an undefined judgment ("If a real user can plausibly produce the failing timing").** This contradicts D5's own closing line ("Any outcome outside this table is an ESCALATION, not a judgment call"). Replace "plausibly" with an objective threshold over the CR3 sweep. For example: if tracking fails at any down-to-first-move delay of 16ms or more (one frame at 60Hz), or at 8ms move intervals, it is a user-visible regression and Adapt test is forbidden. Adapt test is allowed only when every delay of at least one realistic poll interval tracks reliably and only the 0ms (same-task) case fails.

   Also resolve "use Pin or Adapt app" in that branch. Choose Adapt app if a small local change (D5 row 2 criteria) restores tracking across the whole sweep, otherwise Pin.

5. **D5: "our config does not cause" has no objective test.** Pin and Adapt app are distinguished only by whether the regression is "something our code does". Make this a measurement: run the same pointer sequence and the CR3 sweep against a **minimal RGL page with no app code**. Upstream's own example/dev page at the bisected and parent commits works, as does a bare `Responsive` with a `handle` in a scratch page. If the minimal page reproduces, it is library (Pin, and that page becomes the draft's minimal repro). If only the app reproduces, bisect our usage (callbacks, compactor `preventCollision`, `positionStrategy`, re-render pattern) toward Adapt app. Add this as a task between 2.x and 4.1.

6. **D3: bisect verdict rule for persistent mixed results.** "Anything mixed is re-run before marking" does not say what happens if the re-run is also mixed. Specify one of these: `git bisect skip` plus a note, or treat it as bad if any run fails at the tracking assertion (the 2.3.0 red is 20/20 deterministic, so a flaky midpoint is itself a signal). Also: a midpoint that fails at a different assertion, or crashes, is `skip`, not `bad`.

### Non-blocking notes

- Upstream tags and the tarballs have no recorded `gitHead`. Besides the behavioral endpoint check, a cheap self-authenticating check is to diff the built endpoint `dist/*.mjs` against the published tarball's after normalizing chunk hashes. The repo `repository.url` is `STRML/react-grid-layout`. The `react-grid-layout/react-grid-layout` URL in D3 probably redirects, but verify that the clone has both tags.
- The upstream build is `make build` (prepublishOnly), not a bare npm script. `npm ci` there runs `prepare: husky`. Keep it inside scratch.
- D4 "headed Chromium" adds nothing: CDP `Input.dispatchMouseEvent` is the same trusted input headless or headed. Opening a headed window on the owner's live desktop is a needless side effect, so headless is fine. The evidence should state plainly that CDP-dispatched input stands in for a physical mouse.
- D2: RGL 2.3.0 may use react-resizable 3.2-only API, so forcing 3.1.3 could break resize or throw. Record a crash as "inconclusive", not "green/red".
- Diffing the two published `dist/` trees, which are already unpacked, before bisecting would cheaply narrow the suspect commits and confirm the bisect result.
