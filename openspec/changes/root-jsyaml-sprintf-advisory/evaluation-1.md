## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `f4fad5a728bc25cf922366f2c68f09f124c63787` against live-resolved base
`8364b3cee2a6d655749533363076a833d2305d02` (`resolve-review-base.sh`, exit 0).
I re-ran every proof myself after a fresh `nice -n 19 npm ci --ignore-scripts` in the worktree
(npm_config_cache in the session scratchpad). I did not rely on the executor's transcripts.

### Phase 1: Spec Review — PASS
- AC 1 (apply the same override and get `npm audit` to 0 at moderate): done. The root `package.json` override
  `@istanbuljs/load-nyc-config > js-yaml` changed from `^3.15.2` to `^4.1.1`. That is the only edit to
  package.json.
- AC 1 (root tooling still works): re-verified, see Phase 2.
- AC 2 (owner ruling on the threshold): the ruling is recorded in design.md D2. `.audit-ci.jsonc` is now
  `"moderate": true`. The executor is not responsible for the Linear comment.
- All tasks 1.1–3.5 are ticked, and each matches what is in the diff.
- No scope creep. The diff touches only the 7 files listed in proposal "Impact".
- Spec delta `root-dependency-audit`: the step name "Frontend audit (root)" matches ci.yml:409. The one allowlist
  entry has its ticket, reason, path scope and review-by date.
- CONSTRAINTS:
  - C1 (lockfile delta proven by a key+version diff): honoured, and I re-proved it.
  - C2 (no writes under ~, no undisclosed hook bypass, parallelism ≤3 with nice): no violation seen. The commit
    went through the hooks; the executor's lint/format/test runs are recorded.

### Phase 2: Code Review — FAIL
Gates (no `frontend/**` or `backend/**` changed, so I ran the root-tooling equivalents fresh in WORKTREE_PATH):
- `npm run lint`: exit 0.
- `npm run format:check`: all files clean.
- `npm run typecheck`: exit 0.
- `npx jest --maxWorkers=3` under nice: 39 suites and 379 tests passed.
- `npx jest helio-mcp/src/context.test.ts --coverage --coverageDirectory=<scratch>/cov`: passed, and the
  coverage table was produced. I sent coverage output to the scratchpad so the worktree stayed clean.

Proofs I re-ran myself:
1. **Lockfile delta.** I diffed `.packages` entries (key, version and integrity) between the base lock and the
   new lock. There are exactly 4 `<` lines and zero `>` lines:
   - nested load-nyc-config argparse 1.0.10
   - nested load-nyc-config js-yaml 3.15.2
   - `node_modules/esprima` 4.0.1
   - `node_modules/sprintf-js` 1.0.3

   I also deep-compared every surviving `.packages` entry: 0 differ. All top-level keys other than `.packages`
   are identical.
2. **audit-ci red/green.** All runs used the root `npx audit-ci`:
   - base lock + old config: exit 0. The old gate was blind.
   - base lock + new config: exit 1, "Failed security audit due to moderate vulnerabilities". The only failing
     advisory is GHSA-hp3w-g68c-fv3c.
   - new lock + new config: exit 0.
   - new lock + old config: exit 0.
3. **`npm audit --json`.** Results: moderate 0, high 27, critical 0. All 27 highs are covered by the HEL-1246
   entry, which run C passing proves.
4. **load-nyc-config probe.** I used a scratch dir containing a `{}` package.json and a `.nycrc.yaml` with
   `reporter: [text]` and `branches: 80`. js-yaml resolved to
   `<worktree>/node_modules/js-yaml/index.js` 4.3.2, and `loadNycConfig` returned
   `{"reporter":["text"],"branches":80,...}`. That is a real YAML parse through js-yaml 4's `load()`
   (load-nyc-config index.js:80). `npm ls` shows only js-yaml 4.3.2 and argparse 2.0.1, with no sprintf-js and
   no esprima.
5. **HEL-1246 braces allowlist entry.** It is byte-identical to the base: an `allowlist`-onward diff between base
   and HEAD `.audit-ci.jsonc` is empty.
6. **Stale "root at high" grep.** The only hits are `helio-mcp/.audit-ci.jsonc:5` (helio-mcp's own reason, not a
   claim about the root) and three `openspec/specs/pipeline-*` lane-"root" phrases. A wider sweep of `audit-ci`
   and `npm audit` mentions in ci.yml, CONTRIBUTING.md, docs/ and MISTAKES.md found no stale claim.

Doc accuracy:
- ci.yml:264 is a comment-only change and accurate.
- docs/dependency-management.md:102-106 is accurate.
- The root `.audit-ci.jsonc` header is accurate.
- The helio-mcp `.audit-ci.jsonc` header is accurate, and line 5 is kept.
- **MISTAKES.md:239-242 contains a factual error that this diff introduced.** It says: "js-yaml was once overridden
  to 3.x (for `@istanbuljs/load-nyc-config`) and 4.x (for `@eslint/eslintrc`) in different trees". That is wrong:
  - The root tree had both overrides at once. Base `8364b3cee:package.json` has
    `"@eslint/eslintrc":{"js-yaml":"^4.3.2"}` and `"@istanbuljs/load-nyc-config":{"js-yaml":"^3.15.2"}`.
  - frontend/ (before HEL-1320, `67c8ab224^`) carried only the 3.x override.
  - The 4.x eslintrc override is still live in the root today.

  MISTAKES.md is the repo's catalogue of traps. A wrong history line there misleads the next person debugging a
  js-yaml advisory. This is the reason for the FAIL.

### Phase 3: UI Review — N/A
No changed file matches `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**` or
`openspec/specs/**`. The only openspec writes are under `openspec/changes/`.

### Overall: FAIL

### Change Requests
1. `MISTAKES.md:239-242`: replace the inaccurate "History:" sentence with one that matches the record. Suggested
   wording: "History: the root tree overrode js-yaml to both 3.x (for `@istanbuljs/load-nyc-config`) and 4.x (for
   `@eslint/eslintrc`) at once, and frontend/ carried the same 3.x override; HEL-1320 (frontend/) and HEL-1364
   (root) retargeted the 3.x override to `^4.1.1`, so no tree pins js-yaml 3.x any more (the root's 4.x eslintrc
   override remains)."
   - Make this as a doc-only commit. Nothing else needs to change.
   - Re-run `npm run format:check` afterwards, because MISTAKES.md is prettier-checked.

### Non-blocking Suggestions
- **Spinoff claim (root eslint does not ignore `coverage/`): real.** I confirmed it with ESLint's own
  `isPathIgnored`, which returns `false` for `coverage/lcov-report/block-navigation.js`, `frontend/coverage/x.js`
  and `helio-mcp/coverage/x.js`.
  - `.gitignore:23` has `coverage/`, but `eslint.config.*`'s `ignores` list (lines 9+) has no coverage entry, and
    the config's own comments say flat config does not consult .gitignore.
  - So any local `jest --coverage` at the root makes the next `eslint . --max-warnings=0` (the husky pre-commit
    hook) fail on generated files outside the committer's diff. That is the same failure class the
    `.claude/worktrees/**` and `.concertino/**` ignores were added for.
  - It is out of scope here, so it is correctly flagged as a follow-up rather than fixed in this diff. Suggested
    fix: add `"**/coverage/**"` to the ignores.
- **Executor quality (Haiku trial).**
  - Instructions were followed closely. Tasks were done in order, the jq stale-entry deletion was disclosed (task
    1.3) and the scratch-dir/cache discipline was kept.
  - Every transcript claim I re-ran matched: the 4-line delta, exit codes A/B/C 0/1/0, the audit counts, the
    probe output and the grep hits. The executor also found the coverage/eslint interaction on its own.
  - Errors were minor:
    - audit-proof.md 3.4 shows `<scratch>` placeholders instead of real paths, so it is a summary rather than a
      verbatim transcript.
    - Run B is described as "10 path entries" without the raw list.
    - The one substantive miss is the MISTAKES.md history sentence (CR 1): the executor reworded it as asked
      (D6) but did not check the history against the git record.
