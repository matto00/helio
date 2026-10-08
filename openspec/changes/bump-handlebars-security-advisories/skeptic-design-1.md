## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 2dd4ed6237817b1feef22d69f8bc8058e58541db (planning artifacts are uncommitted in the change dir).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/handlebars-security-advisory-bump/HEL-1411`.
- **The CI premise (orchestrator's correction of the ticket) is true.** `gh run view 37838151040` security job steps: `Frontend audit (root)` = failure, `Frontend audit (frontend/)` = failure, `helio-mcp audit (helio-mcp/)` = success. `--log-failed`, "Found vulnerable advisory paths" in both failing steps lists exactly `GHSA-8r5x-fm3f-whwj|handlebars`, `GHSA-p8wg-vrv2-v86f|handlebars`, `GHSA-xw65-4hp5-5hc7|handlebars`. braces is not listed. The ticket's claims that helio-mcp fails and that braces is reported are both wrong, so the proposal is right to leave them out of scope.
- **The advisories have a patched version.** `gh api /advisories/<id>` for all three gives `handlebars >= 4.0.0, <= 4.7.9 -> 4.7.10`. The `latest` dist-tag of `handlebars` is 4.7.10.
- **The in-range claim is true, so no override is needed.** Root lockfile: `ts-jest 29.4.6` declares `handlebars ^4.7.8`. Frontend lockfile: `ts-jest 29.4.9` declares `^4.7.9`. Both trees lock `node_modules/handlebars 4.7.9`. `ts-jest` is the only package in either lockfile that depends on handlebars (checked with a jq scan of dependencies, peerDependencies and optionalDependencies). helio-mcp's lockfile has no handlebars and no braces.
- **The claim that only minimist changes is true.** `npm view` of 4.7.9 vs 4.7.10: the dependency sets match (minimist, wordwrap, neo-async, source-map, and optional uglify-js ^3.1.4). The only difference is minimist `^1.2.5` -> `^1.2.8`. Both trees already lock minimist 1.2.8 and uglify-js 3.19.3, so the expected delta is just the handlebars entry.
- **braces needs no action at root.** The root `.audit-ci.jsonc` allowlist has `GHSA-vfj7-8cjw-p6xm|*micromatch>braces*` (HEL-1246, review-by 2026-11-02). CI does not report braces. The frontend allowlist is empty and the frontend tree has no braces node.
- **The verification plan matches CI.** The `ci.yml` audit commands (lines 414/419/425) match tasks 1.1/2.1/3.1. Root `npm test` = `jest && npm --prefix frontend test`. Root `jest.config.cjs` collects `helio-mcp/src/**` tests, which backs task 4.2.
- **The artifacts are internally consistent:** proposal, design D1–D4 and tasks agree. There are no TBDs or placeholders. Scope covers every corrected AC: the two lockfiles, deltas listed per tree, full suites, and a re-run of the helio-mcp audit as evidence. Design D2 has an explicit stop condition for unrelated version movement (the HEL-1364 "up to date" trap). D3 escalates instead of allowlisting, which follows the owner ruling.

### Verdict: CONFIRM

### Non-blocking notes
- Design D2 says the changed set is "exactly `node_modules/handlebars`" plus resolved/integrity. That entry's `dependencies.minimist` range string will also change (`^1.2.5` -> `^1.2.8`). This is expected and is not unrelated movement. The executor should not treat it as a stop condition.
- The ticket's AC "security green on main" can only be shown after merge. Before merge, the evidence is the three CI-verbatim audit commands going green locally plus the PR's own `security` check.
