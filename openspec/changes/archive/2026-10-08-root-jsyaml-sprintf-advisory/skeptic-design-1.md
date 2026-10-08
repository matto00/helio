## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 8364b3cee2a6d655749533363076a833d2305d02 (change dir untracked; no code changes yet).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/root-jsyaml-sprintf-advisory/HEL-1364`.

### What I verified (with evidence)

All probes ran in a scratch copy (`<scratchpad>/sk1364/p`, `npm_config_cache` in the scratchpad, `nice -n 19`), npm 10.9.8.

- **Base audit counts (design Context).** Root `npm audit --json` on the base lockfile: `moderate 5, high 27, total 32`. Matches.
- **Base lockfile state.** `jq` over `.packages`: nested `load-nyc-config/node_modules/js-yaml 3.15.2`, nested `.../argparse 1.0.10`,
  top-level `esprima 4.0.1`, `sprintf-js 1.0.3`, `js-yaml 4.3.2`, `argparse 2.0.1`, all `dev=true`. Root `package.json` overrides
  match what the design says (`@istanbuljs/load-nyc-config > js-yaml ^3.15.2`, separate `@eslint/eslintrc > js-yaml ^4.3.2`).
- **D3 trap: reproduced.** Changing only the override and running `npm install --package-lock-only --ignore-scripts` left the
  lockfile byte-identical in key+version (`diff before after` exit 0). After deleting the two nested entries with `jq del(...)`
  and re-running, the key+version diff was exactly 4 removals (nested argparse 1.0.10, nested js-yaml 3.15.2, esprima 4.0.1,
  sprintf-js 1.0.3) with nothing added. The full file diff is 45 deleted lines and nothing else. After that, audit gave `moderate 0, high 27`.
- **D4 red/green: reproduced** with `npx audit-ci@7` (the repo pins `^7.1.0`):
  - new lock + old config: exit 0
  - new lock + new (moderate) config: exit 0. The HEL-1246 braces entry still covers all 27 highs.
  - base lock + new config: exit 1, naming `GHSA-hp3w-g68c-fv3c` on 11 jest paths
  - base lock + old config: exit 0. The current gate cannot see this advisory.
- **D6 doc sites.** Task 2.6's grep at base finds exactly the stale sites the plan lists: `.audit-ci.jsonc:5`, `ci.yml:264`,
  `MISTAKES.md:230`, `docs/dependency-management.md:103`, and `helio-mcp/.audit-ci.jsonc:3,5`. The other hits are
  unrelated `openspec/specs/pipeline-*` text about lane roots. Line 5 in helio-mcp is about helio-mcp's own reasoning, not the
  root threshold, so it should stay. No existing `openspec/specs/*` spec states a root threshold, so a new capability is
  the right shape (it matches the `frontend-dependency-audit` / `helio-mcp-dependency-audit` precedent).
- **Ticket AC coverage.** AC1 (override + audit 0 at moderate + root tooling works) maps to tasks 1.x, 3.2, 3.3, 3.4 and 3.5.
  AC2 (owner ruling on the threshold, recorded) is resolved as moderate (`workflow-state.md` notes the escalation was resolved).
  Tasks 2.1–2.6 implement it. No scope drift.
- **Precedent.** Archived `2026-10-07-frontend-moderate-npm-advisories` has the same task shape.
- **D5 rationale is partly inaccurate, but harmless.** `@jest/transform/build/index.js:314-320` passes `cwd, exclude, extension,
  inputSourceMap, useInlineSourceMaps, compact` to babel-plugin-istanbul. Its `findConfig` (`lib/index.js:55`) then returns
  early whenever `keys.length > ignored.length`, so **jest coverage never calls `loadNycConfig`**. In load-nyc-config,
  js-yaml is only `require`d lazily inside the `.yaml` case (`index.js:80`). The `--coverage` run in 3.3 therefore does not
  exercise the changed package. Task 3.4's direct `.nycrc.yaml` call is the real proof, and it is already planned. No change needed.

### Verdict: REFUTE

The design is sound and its probes hold up. I am refuting only because tasks.md is not explicit enough for a Haiku
executor in three places, each of which a literal reader could execute wrongly. These are cheap edits to tasks.md only.

### Change Requests

1. **tasks.md 1.3: give the exact commands.** Right now "Regenerate `package-lock.json` with npm" and "`.../argparse`" leave both
   the npm command and the second key to inference. Replace them with the commands that were actually probed:
   - `npm install --package-lock-only --ignore-scripts`
   - if js-yaml 3.15.2 is still present: `jq 'del(.packages["node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml"], .packages["node_modules/@istanbuljs/load-nyc-config/node_modules/argparse"])' package-lock.json > <scratch>/lock.tmp && mv <scratch>/lock.tmp package-lock.json`
   - then re-run the same `npm install --package-lock-only --ignore-scripts`.
2. **tasks.md 3.1: say how to get the "base lock" and "old config" without touching the worktree's files.** As written, an
   executor can swap or stash the worktree's own `package-lock.json` / `.audit-ci.jsonc` and forget to restore them. Specify a
   scratch directory:
   - `git -C <worktree> show 8364b3cee:package-lock.json > <scratch>/base/package-lock.json`
   - the same for `package.json`, and `.audit-ci.jsonc` → `<scratch>/old.jsonc`
   - run `npx audit-ci --config <cfg> --directory <scratch>/base` for the two base-lock cases.

   Also state that the worktree's `package-lock.json` and `.audit-ci.jsonc` must be unchanged afterwards. Check this with
   `git diff --stat` matching the post-1.4/2.1 state.
3. **tasks.md 1.5 / 3.3 / 3.4: require that worktree `node_modules` exists before any `require`/`npx`, and say why.** The
   worktree is nested under the main checkout (`/home/matt/Development/helio/node_modules` exists, and the worktree has no
   `node_modules` at base). Without `npm ci` in the worktree, Node resolution walks up and loads the **main checkout's**
   js-yaml 3. Task 3.4 would then test the wrong tree. Add a precondition line: `test -d node_modules/@istanbuljs/load-nyc-config`,
   and print `require.resolve('js-yaml', {paths:[require.resolve('@istanbuljs/load-nyc-config')]})`, which must sit under the
   worktree path. Run this alongside the version check.

### Non-blocking notes

- D5 says load-nyc-config "only runs when babel-plugin-istanbul instruments (jest coverage)". Under jest it never runs (see
  evidence above). Consider rewording so the evaluator does not treat the `--coverage` run as proof for load-nyc-config. Keep the
  run anyway as a general tooling check.
- `MISTAKES.md` ~238: "js-yaml affected both 3.x and 4.x, with a separate override floor for each". After this change, neither
  root nor frontend/ has a 3.x override. Consider rewording it as history while 2.4 is open.
- 2.6's grep keeps matching `helio-mcp/.audit-ci.jsonc:5` (helio-mcp's own reason) and the `openspec/specs/pipeline-*` hits.
  Tell the executor these are expected non-stale hits, so it does not "fix" them.
