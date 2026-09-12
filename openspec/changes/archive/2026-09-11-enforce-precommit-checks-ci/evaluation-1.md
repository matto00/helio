## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
- All ticket ACs addressed: (1) CI runs all four checks via `frontend` job, gated into `ci-complete` through
  the existing `needs: [frontend, backend, security, e2e]`; (2) drift guard `check:precommit-ci-parity` added,
  wired into CI (not the hook, deliberately, per design rationale); (3) all four checks re-verified clean on
  current worktree (matches design's "measured on 8fc7face" claim).
- No AC reinterpreted. `skip_specs: true` self-approved in planner notes is consistent with a CI/tooling-only
  change — no API/schema/behavior contract touched.
- Tasks 1.1–4.1 all marked done and match the diff; 4.2 (push + confirm CI green on the PR) is correctly left
  unchecked since it's not verifiable from a local worktree — appropriate deferral, not scope evasion.
- No scope creep: diff is `.github/workflows/ci.yml` (+15 lines), `package.json` (+2 lines), two new scripts,
  plus openspec change-dir artifacts. No unrelated files touched.
- No regressions: `.husky/pre-commit` is byte-identical to base (`git diff --stat` for it is empty).
- No API contracts/schemas affected; none expected per proposal.
- Planning artifacts (design.md decisions 1–3) match the implemented placement (after `check:openspec`/
  `check:openspec:selftest`, before `npm test`) and the guard's design (bare-alias parsing, generic
  package.json-based resolution, `ci-complete`-scoped CI parsing) — all verified directly against source below.
- `workflow-state.md` `CONSTRAINTS: []` — none to honor.

### Phase 2: Code Review — PASS
Ran all six checks fresh, in the worktree, myself (not trusting executor's report):
- `check:repo-integrity` — clean
- `check:scala-quality` — clean (164 soft warnings, no hard failures — pre-existing, unrelated to this diff)
- `check:schemas` — in sync (95/49 protocol files)
- `check:spec-structure` — passed (383 canonical specs, 0 issues)
- `check:precommit-ci-parity` — OK, 18/18 hook scripts covered
- `check:precommit-ci-parity:selftest` — 5/5 fixture cases pass (a: name-covered, b: bare-alias `npm test`,
  c: indirect `node <path>` coverage, d: uncovered script fails naming it, e: coverage outside `ci-complete`
  scope correctly does not count)

Read `scripts/check-precommit-ci-parity.mjs` in full and confirmed, from source (not executor's claims):
- Hook parsing recognizes both `npm run <script>` (regex `NPM_RUN_RE`) and bare aliases `npm test`/`npm start`
  (regex `NPM_BARE_ALIAS_RE`, explicitly excludes `npm ci`) — `parseHookScripts`.
- Script resolution is generic: `resolveUnderlyingPaths` reads each hook script's command string directly from
  the passed-in `package.json` `scripts` map and extracts `node <path>` references via regex — no hardcoded
  name→path table anywhere in the file.
- CI scoping is real, not just claimed: `parseCiCompleteNeeds` regex-extracts `ci-complete`'s own `needs:` array
  from `ci.yml`'s text, `extractJobBlocks` then extracts only those named jobs' blocks, and only those blocks are
  scanned for `npm run`/bare-alias/`node <path>` invocations — confirmed with fixture case (e), which puts
  `check:schemas` only in a job absent from `needs:` and asserts the guard still reports it uncovered.
- Placement in `ci.yml`: four checks + guard + selftest inserted immediately after `check:openspec:selftest` and
  before `npm test`, in the `frontend` job — matches design decision 1 exactly, confirmed via diff.
- DRY/readable/modular: small pure exported functions (`parseHookScripts`, `resolveUnderlyingPaths`,
  `parseCiCompleteNeeds`, `extractJobBlocks`, `checkPrecommitCiParity`), no duplication with existing scripts,
  follows the repo's established `check:X`/`check:X:selftest` convention.
- Type safety: plain JS/Node script, consistent with sibling `check-*.mjs` scripts in this repo — no untyped
  escape hatches beyond what the existing convention already uses.
- No security-relevant boundary (reads local repo files only).
- Error handling: guard exits non-zero with a clear, actionable message on failure; no silent failures.
- Tests meaningful: self-test drives the exported pure function against fixtures and asserts on reason-text
  (not just exit code), covering pass and fail branches including bare-alias and indirect-path cases as
  required — independently re-ran and confirmed 5/5 pass.
- No dead code, no leftover TODO/FIXME in the new files.
- No over-engineering: narrow regex-based CI/hook text scan matches the established convention cited in the
  script's own comment (`check-dependabot-groups.mjs`), not a full YAML parser — appropriately scoped.
- Behavior-preserving: `.husky/pre-commit` is confirmed unchanged (`git diff --stat` for it against base is
  empty) — the mutation-failability demo required by the ticket was NOT left in the diff, confirmed directly.

Independently re-ran the mutation-failability demonstration myself (design decision 3 / task 3.4), rather than
trusting the executor's transcript: appended `npm run check:does-not-exist-in-ci` to a scratch copy of
`.husky/pre-commit`, ran `npm run check:precommit-ci-parity`, and confirmed it failed non-zero naming
`check:does-not-exist-in-ci` exactly, then reverted via `git diff --stat -- .husky/pre-commit` showing empty
diff afterward. Confirmed working tree is fully clean (`git status --porcelain=v1` empty) — no stray files.

No new DB migration present (`git diff --stat` against `backend/src/main/resources/db/migration/` is empty),
consistent with the ticket's explicit non-goal.

### Phase 3: UI Review — N/A
No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` files
changed — CI/tooling-only change, matches proposal's stated scope.

### Overall: PASS

### Non-blocking Suggestions
- None.
