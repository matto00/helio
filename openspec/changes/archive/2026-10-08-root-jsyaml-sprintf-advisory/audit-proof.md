# HEL-1364 audit proof transcripts

Scratch dir: `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1364`
(`npm_config_cache` set to `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1364/npm-cache` in every shell that ran npm/npx.)

## 1.3 lockfile regeneration (stale-entry trap, disclosed)

First `npm install --package-lock-only --ignore-scripts` after the override change:

```
up to date, audited 648 packages in 6s
32 vulnerabilities (5 moderate, 27 high)
EXIT=0
$ grep -c '"node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml"' package-lock.json
1
```

The stale nested entry survived (count 1), so the documented jq deletion was applied to
`node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml` and
`node_modules/@istanbuljs/load-nyc-config/node_modules/argparse`, then npm was re-run:

```
up to date, audited 644 packages in 1s
27 high severity vulnerabilities
EXIT=0
$ grep -c '"node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml"' package-lock.json
0
```

## 1.4 lockfile delta (`.packages` key + version, before vs after)

```
$ diff "/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1364/before.txt" <(jq -r '.packages|to_entries[]|"\(.key) \(.value.version)"' package-lock.json)
58d57
< node_modules/@istanbuljs/load-nyc-config/node_modules/argparse 1.0.10
60d58
< node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml 3.15.2
252d249
< node_modules/esprima 4.0.1
548d544
< node_modules/sprintf-js 1.0.3
DIFF_EXIT=1
count of '<' lines: 4
count of '>' lines: 0
```

Exactly the 4 expected removals, zero additions.

## 1.5 clean install and resolved tree

```
$ nice -n 19 npm ci --ignore-scripts
added 619 packages, and audited 620 packages in 4s
27 high severity vulnerabilities
CI_EXIT=0
PRECONDITION_OK  (test -d node_modules/@istanbuljs/load-nyc-config)

$ npm ls js-yaml argparse sprintf-js esprima
helio@0.7.4 ...
├─┬ eslint@9.39.3
│ └─┬ @eslint/eslintrc@3.3.4 overridden
│   └─┬ js-yaml@4.3.2 overridden
│     └── argparse@2.0.1
└─┬ ts-jest@29.4.6
  └─┬ @jest/transform@30.2.0
    └─┬ babel-plugin-istanbul@7.0.1
      └─┬ @istanbuljs/load-nyc-config@1.1.0 overridden
        └── js-yaml@4.3.2 deduped
LS_EXIT=0
```

js-yaml is 4.3.2 only, argparse 2.0.1 only, no sprintf-js, no esprima.

## 2.6 stale root-threshold grep

```
$ git grep -n -E '"high": true|at "high"|root.{0,40}high' -- ':!openspec/changes' ':!*package-lock.json'
helio-mcp/.audit-ci.jsonc:5:  // motivated this gate (hono, ip-address, fast-uri) was MODERATE, so a `"high": true` config
openspec/specs/pipeline-lane-layout/spec.md:34:- **THEN** every one of root 1's lane columns has a higher index than every one of root 0's
openspec/specs/pipeline-lane-walk/spec.md:34:- **WHEN** a rejoin step at a lower sibling position references a node in a lane rooted at a higher sibling position
openspec/specs/pipeline-root-editor-ui/spec.md:55:- **THEN** the new root renders as a new column at the highest position, and a new chip appears in
GREP_EXIT=0
```

All hits are the expected non-stale ones (helio-mcp header line 5 explains why helio-mcp is stricter-by-reason; the openspec/specs hits are the "pipeline root" lane wording, not the audit threshold).

## 3.1 red/green audit-ci (base lockfile vs fixed lockfile)

```
RUN A: base dir (8364b3cee lockfile) + OLD config (high) -> Passed npm security audit.   EXIT_A=0
RUN B: base dir + NEW config (moderate) -> (raw output, verbatim)
       Found vulnerable advisory paths:
       GHSA-hp3w-g68c-fv3c|@jest/core>jest-runner>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
       GHSA-hp3w-g68c-fv3c|@jest/expect>jest-snapshot>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
       GHSA-hp3w-g68c-fv3c|@jest/globals>@jest/expect>jest-snapshot>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
       GHSA-hp3w-g68c-fv3c|@jest/reporters>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js
       GHSA-hp3w-g68c-fv3c|babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
       GHSA-hp3w-g68c-fv3c|jest-circus>jest-runtime>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
       GHSA-hp3w-g68c-fv3c|jest-resolve-dependencies>jest-snapshot>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js
       GHSA-hp3w-g68c-fv3c|jest-runner>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
       GHSA-hp3w-g68c-fv3c|jest-runtime>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
       GHSA-hp3w-g68c-fv3c|jest-snapshot>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js>
       GHSA-hp3w-g68c-fv3c|jest>jest-cli>jest-config>babel-jest>@jest/transform>babel-plugin-istanbul>@istanbuljs/load-nyc-config>js-yaml>argparse>sprintf-js
       Failed security audit due to moderate vulnerabilities.
       Vulnerable advisories are: https://github.com/advisories/GHSA-hp3w-g68c-fv3c
       EXIT_B=1
RUN C: worktree dir + worktree config (moderate) -> Passed npm security audit.   EXIT_C=0
```

Post-fix dependency total: 647 (base) -> 643 (fixed), consistent with the 4 removals.

`git diff --stat` after 3.1 (same 7 files as after 2.6):

```
 .audit-ci.jsonc               |  8 ++++----
 .github/workflows/ci.yml      |  2 +-
 MISTAKES.md                   | 21 +++++++++++---------
 docs/dependency-management.md |  8 ++++----
 helio-mcp/.audit-ci.jsonc     |  2 +-
 package-lock.json             | 45 -------------------------------------------
 package.json                  |  2 +-
 7 files changed, 23 insertions(+), 65 deletions(-)
```

## 3.2 npm audit counts (worktree root)

```
$ npm audit --json | jq .metadata.vulnerabilities
{ "info": 0, "low": 0, "moderate": 0, "high": 27, "critical": 0, "total": 27 }
```

Moderate 0. The 27 high entries are all the HEL-1246 braces chain (`GHSA-vfj7-8cjw-p6xm`), covered by the root allowlist entry; `npm audit` itself exits 1 on them, which audit-ci accepts through the allowlist (run C above).

## 3.3 jest

```
$ nice -n 19 npx jest --maxWorkers=3
Test Suites: 39 passed, 39 total
Tests:       379 passed, 379 total
JEST_ALL_EXIT=0

$ nice -n 19 npx jest helio-mcp/src/context.test.ts --coverage
Test Suites: 1 passed, 1 total
Tests:       32 passed, 32 total
COV_EXIT=0
```

General regression only; this does not exercise load-nyc-config (see 3.4).

Note: the `--coverage` run wrote a `coverage/` directory into the worktree; the root `eslint .` then linted `coverage/lcov-report/block-navigation.js` (1 warning, `--max-warnings=0` fails). `coverage/` is gitignored but not in the eslint ignore list. The generated directory was removed (exact path) and lint re-run, see 3.5. Spinoff candidate: add `coverage/**` to the eslint ignores.

## 3.4 real proof of the changed package (load-nyc-config -> js-yaml)

```
$ node -e "(async()=>{...require.resolve('js-yaml',{paths:[require.resolve('@istanbuljs/load-nyc-config')]})...loadNycConfig({cwd:'/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1364/nycrc-probe'})...})()"
/home/matt/Development/helio/.claude/worktrees/task/root-jsyaml-sprintf-advisory/HEL-1364/node_modules/js-yaml/index.js 4.3.2
{"cwd":"/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1364/nycrc-probe","reporter":["text"]}
PROBE_EXIT=0
probe files removed
```

Resolved js-yaml is under the worktree's own node_modules, version 4.3.2, and the parsed `.nycrc.yaml` (`reporter: [text]`) round-trips.

## 3.5 lint, typecheck, format:check

```
$ nice -n 19 npm run lint        (after removing the generated coverage/ dir)
> eslint . --max-warnings=0
LINT_EXIT=0

$ nice -n 19 npm run typecheck
> tsc --noEmit
TYPECHECK_EXIT=0

$ nice -n 19 npm run format:check
> prettier . --check
All matched files use Prettier code style!
FORMAT_EXIT=0
```
