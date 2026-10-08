## Standing Constraints

- [C1] Lockfile changes are proven by a before/after `.packages` key+version diff, never by "npm install exited 0".
- [C2] No writes under `~`: set `npm_config_cache` to a dir inside the worktree or the session scratchpad; never
  HUSKY=0 / `commit -n` without disclosure; test parallelism capped at 3 workers with `nice -n 19`.

## 1. Dependency fix

- [x] 1.1 `<scratch>` = `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1364` (mkdir -p); `export npm_config_cache=<scratch>/npm-cache` in EVERY shell that runs npm/npx; save `jq -r '.packages|to_entries[]|"\(.key) \(.value.version)"' package-lock.json > <scratch>/before.txt`
- [x] 1.2 In root `package.json` overrides change `"@istanbuljs/load-nyc-config": {"js-yaml": "^3.15.2"}` to `"^4.1.1"`; touch nothing else in package.json
- [x] 1.3 Run `npm install --package-lock-only --ignore-scripts`; if `grep -c '"node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml"' package-lock.json` is still 1, run `jq 'del(.packages["node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml"], .packages["node_modules/@istanbuljs/load-nyc-config/node_modules/argparse"])' package-lock.json > <scratch>/lock.tmp && mv <scratch>/lock.tmp package-lock.json`, then run `npm install --package-lock-only --ignore-scripts` again (disclose in files-modified and PR body)
- [x] 1.4 `diff <scratch>/before.txt <(jq -r '.packages|to_entries[]|"\(.key) \(.value.version)"' package-lock.json)` must be EXACTLY 4 `<` lines (nested load-nyc-config js-yaml 3.15.2, nested argparse 1.0.10, `node_modules/esprima` 4.0.1, `node_modules/sprintf-js` 1.0.3) and zero `>` lines; record it in `audit-proof.md` in the change dir
- [x] 1.5 Run `nice -n 19 npm ci --ignore-scripts` at the worktree root; PRECONDITION for every later step: `test -d node_modules/@istanbuljs/load-nyc-config` in the worktree; then `npm ls js-yaml argparse sprintf-js esprima`: js-yaml only 4.x, argparse only 2.x, no sprintf-js, no esprima

## 2. Gate config and docs

- [x] 2.1 Root `.audit-ci.jsonc`: `"high": true` -> `"moderate": true`; rewrite header comment (HEL-459/HEL-1364, moderate, matches frontend/ + helio-mcp/); keep HEL-1246 braces entry and its comment byte-for-byte
- [x] 2.2 `.github/workflows/ci.yml` security-job comment line ~264: root at "moderate" (HEL-1364); comment-only diff
- [x] 2.3 `docs/dependency-management.md` lines ~102-106: root at moderate with the one HEL-1246 entry
- [x] 2.4 `MISTAKES.md` security-gate entry heading + body (~228-240): all three npm trees at moderate; root allowlist keeps HEL-1246; reword the "separate override floor for each" js-yaml sentence as history (no tree overrides js-yaml to 3.x any more)
- [x] 2.5 `helio-mcp/.audit-ci.jsonc` header line 3 only: stop claiming root is `"high": true`; keep line 5 (helio-mcp's own reason); comment-only diff
- [x] 2.6 `git grep -n -E '"high": true|at "high"|root.{0,40}high' -- ':!openspec/changes' ':!*package-lock.json'` — expected non-stale hits: `helio-mcp/.audit-ci.jsonc:5` and `openspec/specs/pipeline-*` (lane roots); every other hit must be fixed; paste output in `audit-proof.md`

## 3. Tests

- [x] 3.1 Red/green WITHOUT touching worktree files: `mkdir -p <scratch>/base`; `git -C <worktree> show 8364b3cee:package-lock.json > <scratch>/base/package-lock.json`; same for `package.json`; `git -C <worktree> show 8364b3cee:.audit-ci.jsonc > <scratch>/old.jsonc`. Run `npx audit-ci --config <cfg> --directory <dir>`: base dir + old.jsonc -> 0; base dir + worktree `.audit-ci.jsonc` -> non-zero naming GHSA-hp3w-g68c-fv3c; worktree dir + worktree config -> 0. Transcripts in `audit-proof.md`. Afterwards `git -C <worktree> diff --stat` must show the same files as after 2.6
- [x] 3.2 `npm audit --json | jq .metadata.vulnerabilities` at worktree root: moderate 0; record counts
- [x] 3.3 Root `nice -n 19 npx jest --maxWorkers=3` passes; one file `nice -n 19 npx jest helio-mcp/src/context.test.ts --coverage` passes (general regression only — does NOT exercise load-nyc-config)
- [x] 3.4 Real proof of the changed package: `mkdir -p <scratch>/nycrc-probe`; write `<scratch>/nycrc-probe/package.json` = `{}` (needed: load-nyc-config resets cwd to the nearest package.json) and `<scratch>/nycrc-probe/.nycrc.yaml` = `reporter: [text]`; from the WORKTREE ROOT run `node -e "(async()=>{const path=require('path');const r=require.resolve('js-yaml',{paths:[require.resolve('@istanbuljs/load-nyc-config')]});console.log(r, require(path.join(path.dirname(r),'package.json')).version);const {loadNycConfig}=require('@istanbuljs/load-nyc-config');console.log(JSON.stringify(await loadNycConfig({cwd:'<scratch>/nycrc-probe'})))})()"` (the package exports `{loadNycConfig}`, it is NOT itself a function). Expect: path under `<worktree>/node_modules/js-yaml/`, version 4.x, JSON containing `"reporter":["text"]`. Record in `audit-proof.md`
- [x] 3.5 `npm run lint`, `npm run typecheck`, `npm run format:check` pass
