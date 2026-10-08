## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 8364b3cee2a6d655749533363076a833d2305d02 (change dir untracked; no code changes yet).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/root-jsyaml-sprintf-advisory/HEL-1364`.
Probes ran read-only against the main checkout's `node_modules` (load-nyc-config 1.1.0, the same version as the base lockfile)
with scratch files in `<scratchpad>/sk1364r2`, node v22.23.2. No worktree files were touched.

### What I verified (with evidence)

- **Owner ruling.** `.concertino/runs/HEL-1364/events.jsonl` lines 4–5: `escalation.raised` (options `moderate,keep-high`) and then
  `escalation.answered answer=moderate answer_source=human`, with the same escalation_id. D2 and workflow-state are consistent with it.
- **Round-1 CR1 (tasks 1.3, exact commands): addressed.** 1.3 now gives the exact `npm install --package-lock-only --ignore-scripts`,
  the full `jq del(...)` with both keys, the re-run, and the disclosure requirement.
- **Round-1 CR2 (task 3.1, scratch base without touching the worktree): addressed.** 3.1 uses `git -C <worktree> show 8364b3cee:...` into
  `<scratch>/base`, takes the old config from `<scratch>/old.jsonc`, and runs a `git diff --stat` invariance check afterwards. `--directory` is an
  established audit-ci flag in this repo (ci.yml:422 uses it for helio-mcp).
- **Round-1 CR3 (worktree node_modules precondition): addressed.** 1.5 adds `npm ci --ignore-scripts` plus `test -d node_modules/@istanbuljs/load-nyc-config`.
  3.4 requires the resolved js-yaml path to be under the worktree. I confirmed the hazard is real: the worktree has no `node_modules`
  right now, and resolving from the main checkout gives `/home/matt/Development/helio/node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml/index.js 3.15.1`.
- **Round-1 non-blocking notes: all three addressed.** D5 was reworded (jest does not reach load-nyc-config). 2.4 now covers rewording the history sentence.
  2.6 lists the expected non-stale hits.
- **2.6 grep at base.** I re-ran it. The hits are `.audit-ci.jsonc:5` (fixed by 2.1), `ci.yml:264` (2.2), `MISTAKES.md:230` (2.4),
  `docs/dependency-management.md:103` (2.3), `helio-mcp/.audit-ci.jsonc:3` (2.5), plus the expected `helio-mcp/.audit-ci.jsonc:5` and three
  `openspec/specs/pipeline-*` hits. Every stale site has a task.
- **Spec delta.** The step name "Frontend audit (root)" matches ci.yml:409. The scenarios are testable.
- **3.3 / 3.5 targets exist.** `helio-mcp/src/context.test.ts` exists. Root `lint`, `typecheck`, and `format:check` scripts exist.
- **Task 3.4, the only real proof of the changed package, cannot succeed as written. Probe-confirmed, three independent defects:**
  1. **Wrong export shape.** load-nyc-config 1.1.0 ends with `module.exports = { loadNycConfig, isLoading }` (index.js, final lines). Calling
     `require('@istanbuljs/load-nyc-config')({cwd})`, as both tasks 3.4 and D5 do, throws `TypeError: require(...) is not a function`. I reproduced this.
  2. **Top-level `await` combined with `require` in `node -e`.** The task says to run `node -e` with `await require(...)`. On node 22.23.2,
     `node -e "const p=require('path'); const v=await Promise.resolve(p.sep)"` fails with `ERR_AMBIGUOUS_MODULE_SYNTAX`
     ("both require() and top-level await are present"). It has to be wrapped in an async IIFE.
  3. **Probe dir without package.json never loads the YAML.** In `findPackage` (index.js:38–57), `cwd` is reset to the directory of the
     nearest `package.json` found walking up, and `.nycrc.yaml` is then searched from there. Inside `<worktree>/.nycrc-probe/` with no
     package.json, cwd becomes the worktree root, so `.nycrc-probe/.nycrc.yaml` is never found and js-yaml is never required.
     Reproduced: with a package.json only in the parent, the result was `{"cwd":".../pkg"}` (no reporter). After adding `package.json` to the probe dir,
     the result was `{"cwd":".../pkg/probe","reporter":["text"]}`.

  The corrected form works:
  `node -e "(async()=>{const {loadNycConfig}=require('@istanbuljs/load-nyc-config'); console.log(JSON.stringify((await loadNycConfig({cwd:'<probe>'})).reporter))})()"`
  printed `["text"]`, with a `{}` package.json in the probe dir.

### Verdict: REFUTE

The plan is otherwise sound, and every round-1 change request is resolved. However, task 3.4 is the step the design (D5) names as the
*only* real proof that load-nyc-config works with js-yaml 4, and a literal executor following it fails three ways. The first failure, a
`TypeError` from the wrong export shape, looks exactly like "js-yaml 4 broke load-nyc-config". A Haiku executor could reasonably
misattribute it to the change and revert or contort the fix. This is a cheap fix to tasks.md and D5.

### Change Requests

1. **tasks.md 3.4 and design.md D5: replace the probe recipe with one that actually runs.** Specifically:
   - Write both `<worktree>/.nycrc-probe/package.json` (`{}`) and `<worktree>/.nycrc-probe/.nycrc.yaml` (`reporter: [text]`), and state why
     the package.json is needed: load-nyc-config resets cwd to the nearest package.json.
   - Use the named export inside an async IIFE, for example from the worktree root:
     `node -e "(async()=>{const path=require('path');const r=require.resolve('js-yaml',{paths:[require.resolve('@istanbuljs/load-nyc-config')]});console.log(r, require(path.join(path.dirname(r),'package.json')).version);const {loadNycConfig}=require('@istanbuljs/load-nyc-config');console.log(JSON.stringify(await loadNycConfig({cwd:'<worktree>/.nycrc-probe'})))})()"`
   - Expected: the path is under `<worktree>/node_modules/js-yaml/`, the version is 4.x, and the JSON contains `"reporter":["text"]`. Then `rm -r <worktree>/.nycrc-probe`.
   - In D5, fix `require('@istanbuljs/load-nyc-config')({cwd: <dir>})` to `require('@istanbuljs/load-nyc-config').loadNycConfig({cwd: <dir>})`.

### Non-blocking notes

- 1.4's `<(jq -r ... same as 1.1)` uses an ellipsis. Spelling out the full jq expression would remove the last inference point for a literal executor.
- 3.4's probe dir is inside the worktree. If the executor aborts mid-task, the stray `.nycrc-probe/` could be picked up by `prettier . --check`
  (3.5) or a commit. Putting the probe under `<scratch>` (with its own package.json) would avoid that, because node resolution is controlled by the
  `require.resolve` paths, not by the probe location. Either way works.
