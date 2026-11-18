# Evidence: prod-only-npm-audit-gate (HEL-1753)

New step run: command (identical in all three steps, extracted from the edited ci.yml via a YAML parse):
`npm audit --omit=dev --audit-level=moderate`, working-directory `.`, `frontend`, `helio-mcp`; `timeout-minutes: 1`.
Scratch lockfiles: `/home/matt/Development/helio/.concertino/scratch/HEL-1753/exec/` only. No real lockfile or package.json touched.
Old-gate runs use the main checkout's `/home/matt/Development/helio/node_modules/.bin/audit-ci` (0.7.4, the worktree has no node_modules; no `npm ci` run).

## 2.1 Lockfile-only (scratch copy of helio-mcp/ with package.json + package-lock.json only, no node_modules)
```
$ ls -a   ->  package.json  package-lock.json
$ npm audit --omit=dev --audit-level=moderate
found 0 vulnerabilities     (real 0.268s)   exit=0
```

## 2.2 Green on main (real trees, 0 production advisories)
```
.            found 0 vulnerabilities  real 0.315s  exit=0
frontend     found 0 vulnerabilities  real 0.368s  exit=0
helio-mcp    found 0 vulnerabilities  real 0.264s  exit=0
```

## 2.3 Fail-first, root (scratch: root package.json + lockfile, `npm install --package-lock-only --ignore-scripts micromatch@4.0.8`)
Lockfile: `micromatch 4.0.8 dev flag: None` (production), `picomatch dev flag: None`.
```
$ audit-ci --config <worktree>/.audit-ci.jsonc --directory <scratch>/root     (current gate)
... Passed npm security audit.        exit=0
$ npm audit --omit=dev --audit-level=moderate     (new step command, in scratch/root)
picomatch  *  Severity: high
picomatch vulnerable to ReDoS through single-branch repeated extglobs - https://github.com/advisories/GHSA-fc5q-39xc-vjpf
node_modules/picomatch / micromatch >=4.0.0 / node_modules/micromatch
2 high severity vulnerabilities       exit=1
```

## 2.5 Mutation (same scratch, `--save-dev micromatch@4.0.8`)
```
micromatch dev flag: True
$ npm audit --omit=dev --audit-level=moderate
found 0 vulnerabilities    exit=0
```
So the red in 2.3 comes from the production path surviving `--omit=dev`.

## 2.4 Fail-first, frontend/ (scratch: frontend package.json + lockfile, `npm install --package-lock-only --ignore-scripts anymatch@3.1.3`)
`anymatch` is in frontend/.audit-ci.jsonc (`GHSA-fc5q-39xc-vjpf|anymatch>*`). Lockfile: `anymatch 3.1.3 dev flag: None` (production);
the top-level `picomatch` stays dev (4.0.5) and a nested `node_modules/anymatch/node_modules/picomatch` is the production one.
```
$ audit-ci --config <worktree>/frontend/.audit-ci.jsonc --directory <scratch>/fe     (current gate)
... Consider not allowlisting paths: ... GHSA-fc5q-39xc-vjpf|anymatch>* ...
Passed npm security audit.            exit=0
$ same scratch, allowlist lines (GHSA-fc5q) removed from a copy of the config
Found vulnerable advisory paths: GHSA-fc5q-39xc-vjpf|@jest/...>picomatch> ...   exit=1
   (green above is due to the allowlist match, not a missing advisory)
$ npm audit --omit=dev --audit-level=moderate     (new step command, in scratch/fe)
picomatch * Severity: high ... GHSA-fc5q-39xc-vjpf
node_modules/anymatch/node_modules/picomatch  <- anymatch >=3.0.0
2 high severity vulnerabilities       exit=1
```

## 2.4a Fail closed (real frontend/, unreachable registry)
```
$ npm audit --omit=dev --audit-level=moderate --registry=http://127.0.0.1:9/
npm warn audit request to http://127.0.0.1:9/-/npm/v1/security/audits/quick failed, reason: connect ECONNREFUSED 127.0.0.1:9
npm error audit endpoint returned an error       exit=1
```

## 1.3/1.4 Diff scope
`git diff -U0 -- .audit-ci.jsonc frontend/.audit-ci.jsonc` filtered to non-`//` changed lines: empty (comment-only).
`git status --short`: only `.audit-ci.jsonc`, `.github/workflows/ci.yml`, `frontend/.audit-ci.jsonc`, the change dir. No lockfile/package.json diff.

## 3.1/3.2 Guards
check-ci-complete-needs OK (exit 0) + selftest passed; check-ci-sbt-no-pattern-kill ok (exit 0); check-openspec-version OK;
check-precommit-ci-parity OK (exit 0) + selftest 14/14; YAML parse of ci.yml ok; `openspec validate prod-only-npm-audit-gate --type change` -> valid, exit 0.
