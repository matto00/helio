## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: cb5380d8ad008d10c1b0cd82409d32f6728f1c68 (base a6499da125f7984d9d0338f09a0ef62173865382, resolved live).

### Phase 1: Spec Review — FAIL

The pin itself is correct. D6 "Pin + upstream draft" is the right row: the D4 sweep fails at every delay from 0 to 100 ms and on resize, and the D5 minimal page reproduces at eb35b82c but not at its parent. The bisect endpoints and the parent/child pair are proven by the served bundle's sha256. All task boxes match the evidence. The diff makes no frontend or backend change, so there is no scope creep.

Issues:

1. **The upstream issue already exists, and the deliverables do not mention it (AC 2: "with an upstream issue linked if it is a library regression").** I checked the tracker read-only. `react-grid-layout/react-grid-layout#2303` is titled "2.3.0: dragged/resized item no longer follows the pointer between grid steps (GridItem memo skips the live re-render)". It was closed as COMPLETED on 2026-10-31 by PR #2304, "fix: render active items between snapped grid steps", which merged as commit `1468c0fcfa7fbf0f8e39f369051326bcf81cc6bc`. That commit is already in the scratch clone. The fix is **unreleased**: 2.3.0 (2026-10-05) is still the latest release. A third-party comment on #2303 reports the same Playwright symptom and the same 2.2.4 pin.
   - `upstream-issue-draft.md` would file a duplicate.
   - The dependabot reason links a local draft instead of the existing upstream issue.
2. **The regression is described less precisely than upstream describes it.** Upstream says the item stays still until the pointer passes the half-step rounding point, then jumps to it. That matches the evidence here: the bare grid's 52 px error is about half of its ~99 px column pitch, and the app's ~397 px error comes from its wide cells. So "does not follow the pointer at all" overstates it. The cause also involves two commits. eb35b82c is the first bad commit in our bisect: it made `onDragStop` stable. f13dbbc (#2240, the `React.memo` GridItem) then skips the live re-render. The draft guesses at this interaction; upstream confirms it.

### Phase 2: Code Review — PASS (with the Phase 1 items carried as change requests)

Gates: the diff has no `frontend/**` or `backend/**` files, so no project gate triggers. I ran these myself on the worktree, and all exited clean:
- `check:dependabot` and its selftest
- `check:openspec` (the change is complete but in flight)
- `check:test-temp-dir-hygiene`
- `check:e2e-evidence-paths`
- `check:e2e-user-cleanup`
- `check:no-credential-leak`
- `check:repo-integrity`
- `check:spec-structure`
- `prettier --check .github/dependabot.yml`

The ignore rule `react-grid-layout` / `>=2.3.0` sits in the `/frontend` npm block's `ignore:` next to the HEL-1725 rules, as specified.

Scratch specs committed under `openspec/changes/` (`hel1728-sweep.spec.ts`, `min/hel1728-min.spec.ts`, `min/hel1728-min.tsx`) cannot be picked up by any tool:
- **jest:** the root `jest.config.cjs` `testPathIgnorePatterns` lists `/openspec/`, and `frontend/jest.config.cjs` only matches `src/**`.
- **tsc:** the root `tsconfig.json` excludes `openspec`, `frontend/tsconfig.json` includes only `src`, and `e2e/tsconfig.json` includes only `e2e/**`.
- **eslint:** `eslint.config.cjs` ignores `openspec/**`.
- **prettier:** `.prettierignore` lists `openspec`.
- **Playwright:** `testDir` is `./e2e`.
- **Archive:** archived change dirs already hold committed `.sh` scratch files, and `check:openspec` passes.

The `run-*.sh` scripts copy files into `e2e/` and `frontend/` and then remove them. `git status` is clean, and `frontend/package.json` and the lockfile are unchanged.

### Phase 3: UI Review — N/A

No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). I still ran AC 3 independently:
- **Install check:** the installed `frontend/node_modules/react-grid-layout/dist` matches the npm 2.2.4 tarball byte for byte (`diff -rq` against `.concertino/scratch/HEL-1728/pkgs/2.2.4/package/dist`). The installed react-resizable is 3.1.3.
- **Served-bundle check:** the served Vite pre-bundle `node_modules/.vite/deps/react-grid-layout.js` has the 2.2.4 markers. `if (!activeDrag) return` appears twice, and there is no `createEdgeScrollController` and no `oldDragItemRef.current) return`. So no bisect overlay is still being served.
- **The run:** `e2e/hel1573-motion-grid-chart.spec.ts:275 --repeat-each 20 --workers 2` gave **20 passed (1.6m)**. The harness deleted all 20 throwaway users, and the servers were stopped afterwards with `stop-servers.sh`.

On "test artifact or real regression": I did not re-run a min-page row on 2.3.0. #2303 corroborates the regression independently of this harness, with a jsdom/vitest repro and no CDP input. That rules out a CDP-only, pointer-type or strict-mode artifact.

### Overall: FAIL

Category: spec-divergence. The AC requires linking the upstream issue, and the deliverables point at a would-be duplicate draft instead of the existing upstream issue and fix.

### Change Requests

1. **`.github/dependabot.yml:59-64`**: rewrite the HEL-1728 reason comment.
   - Link `https://github.com/react-grid-layout/react-grid-layout/issues/2303` and the fix PR #2304 (commit `1468c0f`).
   - Describe the symptom as upstream does: the item lags until the pointer crosses half a grid step, then jumps (GridItem memo #2240 together with eb35b82c's stable `onDragStop`).
   - Make the removal condition "a react-grid-layout release containing 1468c0f (#2304), verified by hel1573-motion-grid-chart.spec.ts:275 passing 20/20 on it".
   - Drop the `openspec/changes/rgl-23-drag-tracking/...` path. It dangles once the change is archived to `openspec/changes/archive/<date>-rgl-23-drag-tracking/`, and the upstream link is the durable reference.
2. **`openspec/changes/rgl-23-drag-tracking/upstream-issue-draft.md`**:
   - Add a prominent header saying "Do not file: duplicate of #2303 (closed 2026-10-31, fixed by #2304 / 1468c0f, unreleased as of 2026-11-17)".
   - Keep the bisect and sweep data as a record. Optionally rework it into a comment for #2303 that adds our bisect pointer (eb35b82c, the interaction with f13dbbc) and asks for a release, but do not post it (C6).
   - Correct "does not follow it" to the half-step lag-then-jump behavior, with the 52 px and 397 px numbers explained by column pitch.
3. **`minimal-repro.md` and `running-app-check.md`**: add one line each citing #2303 as external corroboration and stating the half-step mechanism. Then the claim that it "does not follow the pointer at all" is not left standing.
4. Persist the updated draft and the changed evidence files with `persist-evidence.sh`, as done for the current ones.

### Non-blocking Suggestions

- `min/hel1728-min.tsx:3`: the header comment says `createScaledStrategy(1.0)`, but line 20 uses `createScaledStrategy(1.5)`. Fix the comment.
- Optional and cheap if the scratch build tooling is still warm: build `1468c0f` and run the min-page drag 0 ms row against it. That would confirm the upstream fix covers our sequence before we rely on "remove the pin on the next release".
- `red-baseline.md` notes that the app imports `react-resizable/css/styles.css` without declaring `react-resizable` as a dependency (a phantom dependency). This is worth a follow-up ticket, outside this scope.
