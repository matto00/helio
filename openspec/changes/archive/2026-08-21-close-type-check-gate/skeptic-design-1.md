## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Cold review of `openspec/changes/close-type-check-gate/` (ticket.md, proposal.md, design.md,
tasks.md, specs/frontend-type-check-gate/spec.md) at base `8432f280`. Every claim below is
derived from my own commands run in the worktree or in an out-of-tree scratch copy; nothing is
taken from the planner's narrative. I modified no file in the worktree, in `openspec/specs/`, in
`scripts/check-openspec-hygiene.mjs`, or in any other worktree.

### What I verified (with evidence)

**1. Both load-bearing measurements reproduce exactly.**

Current base is clean (run twice, ~4.8s — matches the plan's "~5s"):

```
$ ./frontend/node_modules/.bin/tsc --noEmit -p frontend
EXIT=0   (0 output lines)          real 0m4.819s
$ ./frontend/node_modules/.bin/tsc --noEmit -p frontend      # re-run, reproduced
EXIT=0
```

The historical state reproduces too. I extracted `12fae281`'s `frontend/` into scratch
(`git archive 12fae281 frontend`), symlinked today's `frontend/node_modules`, and ran the
frontend project:

```
EXIT=2   LINES=61
  58  src/features/toasts/state/toastListeners.ts(
   1  src/store/listenerMiddleware.ts(
   1  src/config/env.ts(
```

Identical to the counts in ticket.md:19-22 / design.md:6-9. **AC 1 is genuinely already
satisfied**, and the scope narrowing that follows is correct. The plan is not wrong here.

**2. The gate gap is real, exactly where the plan locates it.**
`.husky/pre-commit` = lint, format:check, check:schemas, check:openspec, check:scala-quality,
test — no tsc. `.github/workflows/ci.yml:36-38` frontend job = lint, format:check, test — no tsc.
`frontend/package.json` has no `typecheck`; `helio-mcp/package.json` does
(`"typecheck": "tsc --noEmit"`), so D2's naming precedent is real.

**3. D1 (gate the frontend config, not the root) is correct.**

```
$ ./frontend/node_modules/.bin/tsc --noEmit -p tsconfig.json
EXIT=2   LINES=218
  184 helio-mcp/src   10 e2e   9 helio-mcp/scripts   6 frontend/src   2 frontend/*
```

Spot-checked the frontend entries: all resolution artifacts under `commonjs`/`node`
(`TS1343 import.meta`, `TS2307 react-grid-layout/core`, `TS2307 vite`), not defects. Gating on
that config would be red from commit one. Rejecting it is right.

**4. D4 is a genuine coverage hole, not scope creep — proven both directions.**
In a scratch copy of the current `frontend/` (never in the worktree) I injected a real type error
into `vite.config.ts` and varied only `include`:

```
include ["src","vite.config.ts","pwa-assets.config.ts"]  ->  vite.config.ts(69,7): error TS2322 ... EXIT=2
include ["src","tests"]  (today's config)                ->  EXIT=0   # error completely invisible
widened include, no injected error                       ->  EXIT=0   # measured clean, as planned
```

So today's config would let a broken `vite.config.ts` through silently. I also confirmed the two
files are the *only* tracked TS outside `frontend/src`
(`git ls-files 'frontend/**' | grep -E '\.tsx?$' | grep -v '^frontend/src/'` → exactly
`pwa-assets.config.ts`, `vite.config.ts`), so the widened `include` is complete, not partial.
Nothing else consumes `include`: `eslint.config.cjs` has no `project`/typed linting, and
`vite build` uses esbuild.

**5. D2's script chain works end-to-end, including exit-code propagation.**
Rehearsed in scratch with a root `package.json` carrying the proposed passthrough:

```
GREEN  npm run typecheck (root -> npm --prefix frontend run typecheck -> tsc --noEmit)  ROOT EXIT=0
RED    same, with export const probeValue: number = "not a number" in src/
       src/__skeptic_probe.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.
       ROOT EXIT=2      (frontend-local invocation also EXIT=2)
GREEN  after revert                                                                      ROOT EXIT=0
```

`typescript@^5.9.3` is a devDependency in both manifests and present in both lockfiles, so CI's
`npm ci` + `npm --prefix frontend ci` will have `tsc`.

**6. Lint cannot preempt the red-before-green probe** (I checked, because a probe caught by an
earlier hook step would be a false proof). Via `eslint --stdin --stdin-filename`, exit 0 for an
exported typed mismatch, a non-exported unused one, and a function-local one; instrument
validated against `no-const-assign`, which correctly exits 1. So a type-error probe reaches the
new typecheck step.

**7. Hook health today** (so the "green" half is judgeable): `check:openspec`, `check:schemas`,
`check:scala-quality`, `format:check`, root `npm run lint` all exit 0 in this worktree, and
`openspec list --json` reports `close-type-check-gate` as `in-progress` (0/19 tasks).

**8. No collision with HEL-775.** Planned files: `frontend/package.json`, `package.json`,
`frontend/tsconfig.json`, `.husky/pre-commit`, `.github/workflows/ci.yml`, plus the change dir.
HEL-775 (read from Linear) normalizes 22 files under `openspec/specs/` and may add a guard inside
`scripts/check-openspec-hygiene.mjs`. Zero path overlap; `check:openspec` is already wired into
`.husky/pre-commit`, so HEL-775 has no reason to touch the hook. `--skip-specs` is the right call
(see CR 5 for the part that is missing).

**9. AC coverage.** All five ACs map to tasks; no AC is uncovered and no task exceeds the ticket.
The one addition (D4) is justified by finding 4 above.

### Verdict: REFUTE

The plan's core is sound and unusually well-grounded — every premise I could reproduce,
reproduced. I am refuting on the exact axis the gate exists to protect: **the CI half of the gate
is never proven to be able to fail, and the project's own declared gate set is left out of the
plan entirely.** The changes below are edits to the artifacts, not a redesign.

### Change Requests

1. **Give the CI leg a falsifiability check — right now it has none.** D5 (design.md:60-66) and
   tasks §4 prove redness for `npm run typecheck` and for `.husky/pre-commit` only. D5 itself
   names four failure modes; the two that are CI-specific ("workflow step in the wrong job",
   "`|| true` swallowing the exit code") are the two nothing in the plan guards. Task 3.3 is an
   eyeball ("Confirm the CI step sits in the `frontend` job"). Add tasks that:
   a. **Mechanically** parse `.github/workflows/ci.yml` after the edit and assert: the file still
      parses as YAML; `jobs.frontend.steps[]` contains a step whose `run` is exactly
      `npm run typecheck`; that step is in `frontend`, not `backend`; and neither the step nor the
      job sets `continue-on-error`, and the `run` contains no `|| true`. (Both
      `python3 -c "import yaml"` and node `js-yaml` resolve in this environment — I verified.)
   b. After the PR exists, read the real run log (`gh run view --log --job frontend`, `gh` 2.97 is
      available) and confirm the `npm run typecheck` step actually executed in the frontend job.
      Present-in-YAML and executed-in-CI are different claims.
   c. Record in design.md that CI *redness* is established by construction plus the local red of
      the identical command, because a true CI-red observation needs a throwaway PR. As written,
      spec.md:31-34 ("CI runs the gate ... a step whose failure fails the job") reads as observed
      when it is inferred — the exact overclaim this ticket exists to end.

2. **Address the project's declared verification-gate set, which the plan never mentions.**
   `concertino.config.json → gates` declares, for `frontend/**`: `npm run lint`,
   `npm run format:check`, `npm test`, `npm --prefix frontend run build`. No typecheck. Same list
   is rendered into `.claude/agents/concertino-executor.md:113-117` and
   `concertino-evaluator.md:93-97`, and `.concertino/laws/verification-before-completion.md:28-32`
   names that config as "your verification commands". After this change lands, `tsc` is enforced
   in pre-commit and CI but absent from the gate set every delivery agent in this repo runs —
   including the evaluator for this very ticket. Decide explicitly: either add the gate entry (and
   say whether re-rendering via `concertino sync` is required, since the rendered agent files are
   tracked), or record in design.md Non-Goals why not, naming the residual gap and a follow-up.
   A silent omission is not acceptable for a change whose whole subject is "where gates are wired".
   **Also fix or substantiate design.md:48-49**, which asserts the agent workflow uses
   `git commit -n` "routinely". `scripts/concertino/setup-worktree.sh:289-293` exists specifically
   so a worktree "can run the full pre-commit hook chain ... without `git commit -n`". That claim
   is load-bearing for D3's reasoning and ground truth points the other way; either evidence it or
   drop it.

3. **Update `CONTRIBUTING.md`'s Pre-Commit Policy, which mirrors the hook line-for-line.**
   CONTRIBUTING.md:110-122 enumerates the six hook commands, in order, as the binding contributor
   standard. Adding a seventh command to `.husky/pre-commit` without touching that block leaves
   the canonical doc understating the enforced gate set — the same advertised-scope-exceeds-real-
   scope defect D4 correctly refuses to accept in `tsconfig.json`. Add a task for
   CONTRIBUTING.md:112-122. (Optional in the same task: `README.md:88-96` and `CLAUDE.md:11-18`
   frontend command lists, for discoverability.)

4. **Tighten tasks §4 — as written the green half is not reachable and the probe site is
   under-specified.**
   a. 4.6 ("re-run ... the pre-commit hook and confirm both are green"): once §5 marks all 19
      tasks `[x]`, `openspec list --json` reports the change `complete` and
      `scripts/check-openspec-hygiene.mjs:31-35` errors, so the hook exits non-zero for a reason
      that has nothing to do with typecheck. Specify that the green-hook observation is taken
      while the change is still in-progress, and that the recorded evidence must name which step
      produced each result.
   b. 4.1/4.3: require the probe to live in a module **no test imports**, and require the
      transcript to show an `error TS…` line from the typecheck step. Reason: `ts-jest`
      (`frontend/jest.config.cjs:2`, diagnostics on by default) already type-checks
      test-reachable modules — I proved `npm test` fails on a type error injected into
      `frontend/src/utils/aggregate.ts` (`Test suite failed to run ... TS2322`, exit 1) — so a
      test-reachable probe blurs which gate caught it.
   c. 5.4 ("final staged diff contains only the five intended files") is wrong as stated: the
      commit also carries the openspec change artifacts. Reword so the evaluator does not chase a
      false positive.

5. **Record the consequence of archiving with `--skip-specs`.** workflow-state.md:48 commits to
   it and proposal.md:22-25 declares a New Capability `frontend-type-check-gate`; the net effect
   is that the capability never lands in `openspec/specs/` (317 capabilities there today).
   Skipping is correct for the fence — and additionally avoids writing a fresh
   `## ADDED Requirements` heading into `openspec/specs/` while HEL-775 is removing 22 of them —
   but the deferral leaves the exact setup HEL-775 documents: a later MODIFIED/REMOVED delta
   against a capability whose canonical spec lacks the requirement aborts `openspec archive`
   mid-delivery. Record the deferral in design.md (Non-Goals or Risks) and name the follow-up that
   applies the delta once HEL-775 has merged.

### Non-blocking notes

- **Historical claim is slightly over-stated.** ticket.md:19-22 and proposal.md:4-5 say "at
  `12fae281` the frontend carried 60 `tsc` error lines". What the method establishes (and what I
  reproduced exactly) is "`12fae281`'s *source* under *today's* `node_modules`". design.md:7-9
  discloses this; the ticket and proposal state it unqualified. One qualifying clause fixes it.
- **"Enforced nowhere" is coarse but the conclusion holds.** `ts-jest` incidentally type-checks
  modules reachable from a test (proved above). The historical errors escaped because nothing
  imported them from a test: at `12fae281`, `src/store/store.test.ts` mentions
  `listenerMiddleware` only inside a comment, and jest passes there (`1 passed`, exit 0) with the
  `TS2344` still present. Stating it precisely ("no whole-program check; ts-jest covers only
  test-reachable modules") strengthens the case rather than weakening it.
- **D2's passthrough is more worktree-robust than the AC's literal command** — worth a line in
  D2. `CONCERTINO_LINK_MODULES='frontend/node_modules'` populates only the frontend modules; this
  worktree has no root `node_modules` at all, and root `npm run lint` works only because the
  worktree happens to be nested inside the main checkout. `npm --prefix frontend run typecheck` is
  immune to that; a bare `npx tsc -p frontend` would be at the mercy of npx's resolution.
- **Hook ordering is right**: typecheck second (after `lint`) puts it ahead of `check:openspec`
  and `npm test`, both slower and both prone to unrelated reds.
- Environment note, not a blocker: `scripts/concertino/next-report-number.sh` and
  `persist-evidence.sh` are absent from this worktree (`.gitignore:57` ignores
  `scripts/concertino/`, so only the tracked subset materializes). I invoked the main checkout's
  copies by absolute path; `next-report-number.sh` returned `READY number=1`.
