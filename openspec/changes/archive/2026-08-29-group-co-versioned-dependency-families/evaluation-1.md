## Evaluation Report — Cycle 1 (evaluation-1.md)

Diff surface: `git diff 6352b1a2..HEAD` (20 files), per the orchestrator's merge-base instruction.

### Phase 1: Spec Review — PASS

Issues: none.

- AC1 (grouped FontAwesome PR, demonstrated not read): satisfied by the config-validation equivalent — `scripts/check-dependabot-groups.mjs` plus a recorded red run against the unmodified pre-change config. The real-Dependabot prong is correctly deferred to tasks 7.1–7.2 (orchestrator, post-merge), which design.md Decision 6 states explicitly rather than glossing.
- AC2 (does the family pass at matching versions): answered by the deterministic local probe. `evidence/fontawesome-matching-versions-typecheck.txt` shows the four resolved versions (core 7.3.1, free-solid 7.3.1, free-brands 7.3.1, react-fontawesome 3.5.0) and `typecheck exit=0`. Stated plainly: the split was the whole type-contract problem, 7.3.1 is not breaking us. The narrower scope of the probe (types only, not lint/jest) is disclosed in Decision 6 rather than overclaimed.
- AC3 (enumeration derived from manifests): verified independently. `frontend/package.json` has exactly 18 production deps; 12 are declared family members (fortawesome ×4, echarts ×2, redux ×2, markdown ×2, react, react-dom) and 6 are on `DECLARED_INDEPENDENT` (react-grid-layout, react-router-dom, axios, lucide-react, qrcode.react, tslib). 18/18, with no package covered twice and none missing. Root `package.json` has one production dep, `react-markdown`, on the allowlist for `/`. The allowlist matches design.md Decision 1's independent rows verbatim. `build.sbt` and github-actions are covered by existing `patterns: ["*"]`, recorded rather than silently skipped.
- Tasks: 1.x–6.x all marked done and all match what shipped; 7.1–7.4 correctly left unchecked as post-merge orchestrator work.
- Scope: no application code, no UI, no DB. Nothing touched in the declared out-of-scope areas (`e2e/hel813-*`, `dependabot-auto-merge.yml`, `dependabot-metadata.yml`, `backend/.../domain/steps/`). Spec delta `specs/dependabot-update-grouping/spec.md` matches implemented behavior.

### Phase 2: Code Review — PASS

Issues: none blocking.

**Priority 1 — is the validator genuinely failable? Verified by mutation, in a scratch copy, not by reading.** Baseline in the scratch copy exits 0. Four mutations, each restored afterward:

| Mutation | Result | Reason |
| --- | --- | --- |
| Remove the `fortawesome` group | exit=1 | `family "fortawesome" is split/ungrouped: ...all four... resolve to no group in npm /frontend` |
| Move `dev-dependencies` catch-all back above the pattern groups | exit=1 | `family "react" is split across 2 groups (react, dev-dependencies): react -> react, react-dom -> react, @types/react -> dev-dependencies, @types/react-dom -> dev-dependencies` |
| Add `some-new-lib` to `frontend/package.json` `dependencies` | exit=1 | `unaccounted production dependency "some-new-lib" in /frontend/package.json` |
| Extra: loosen `react` pattern to `react*` and declare that group first | exit=1 | `family "redux" is split across 2 groups (redux, react): react-redux -> react` and `family "markdown" ...: react-markdown -> react` |

Every failure is for the *right* reason, naming the offending family/package, not a generic non-zero. The fourth (unprompted) mutation confirms Decision 2's specific claim — that pattern precision becomes load-bearing once specific groups are declared first — is actually enforced by the anchored glob matcher, not merely asserted in a comment. The validator is failable in all three of its documented failure modes plus the ordering mode.

**Priority 2 — selftest names all six cases.** Run output lists `(a)` through `(f)` individually by name with a per-case PASS, then the summary. Task 6.2 satisfied, not by a count. Each negative case asserts on a reason regex, not on a non-zero result — the selftest header calls out why (a crash would otherwise "pass" a negative case). The `total !== 6` guard closes the silently-skipped-case hole.

**Priority 4 — no committed dependency version changes.** `git diff --stat 6352b1a2..HEAD -- '*package-lock.json' backend/build.sbt frontend/package.json` is empty. Root `package.json`'s entire diff is two lines in the scripts block. `git status --short` in the worktree is clean. The probe left no trace: `npm --prefix frontend ls` now reports core 7.2.0 / free-solid 7.2.0 / react-fontawesome 3.3.1, i.e. task 5.3's `npm ci` restore actually happened, so the Phase-2 gate runs below are against the shipping dependency set and not the probe's.

**Priority 5 — evidence files are real transcripts.** `validator-red-precommit.txt` records `git rev-parse HEAD = 6352b1a2`, the unmodified-config status, the full five-error output and `exit=1` — the validator has been seen red against the real pre-change config, not a fixture. `fontawesome-matching-versions-typecheck.txt` carries the `--no-save --no-package-lock` invocation verbatim, npm's real output, the `ls` version resolution and `typecheck exit=0`. Both gate-chain isolation transcripts are real CON-132 runs against a disposable `mktemp -d` worktree fixture with poisoned `GIT_DIR`/`GIT_INDEX_FILE`, and correctly separate the target script's own exit code from the corruption verdict.

Code quality: the YAML subset parser is the one thing here that could have been over-engineered and is not — it is scoped, documented as a subset, and justified by a real constraint (root `node_modules` is genuinely absent in this worktree, confirmed). Quote-aware comment stripping and flow-sequence parsing are needed by the actual file's shape. The check logic is exported and pure (`checkDependabotGroups({configText, manifests, families, independents})`), which is what makes the in-memory selftest possible without disk or subprocess. No `any`-equivalent escape hatches, no dead code, no TODO/FIXME, no fully-qualified-name inlining. Read-only, no network, no git shell-out — matching the gate-chain checklist's claims, which I verified against the source rather than taking on trust.

**Gates re-run by me, fresh, in the worktree** (`CLEAN_WORKTREE` not set):

- `npm run check:dependabot` → exit 0, `5 declared families ... every production dependency accounted for`
- `npm run check:dependabot:selftest` → exit 0, 6 passed / 0 failed
- `npm run lint` → clean (`--max-warnings=0`)
- `npm run typecheck` → clean
- `npm run format:check` → `All matched files use Prettier code style!`

`npm test` deliberately not treated as evidence (HEL-880: vacuous in a worktree); the change carries no jest-testable code anyway, and the selftest is a standalone script precisely for that reason.

### Phase 3: UI Review — N/A

No `frontend/**` source, no `ApiRoutes.scala`, no `schemas/**` change. Per the orchestrator's instruction and the diff, no dev servers were started.

### Overall: PASS

### Non-blocking Suggestions

- `DECLARED_INDEPENDENT` uses seven one-package entries where the `packages: []` array shape allows one entry per directory. Collapsing to two entries (`/frontend` with six packages, `/` with one) would read closer to the design table it mirrors. Purely cosmetic; the current shape is arguably easier to annotate per-package later.
- The coverage assertion is scoped to `dependencies` only, which design.md Decision 6 justifies (every devDependency is already swept into the catch-all). Worth revisiting only if a future config ever drops the `dev-dependencies` catch-all — at which point the assertion would silently narrow. A one-line comment in the coverage loop pointing at that dependency would make the coupling explicit.
- Tasks 7.1–7.4 are real post-merge obligations, notably 7.2 (compare the grouped PR's `frontend` result against the local probe, and report any disagreement rather than reconciling it) and 7.4 (post the `ci-complete` ruleset evidence to HEL-874). These are outside this evaluation's surface but should not be dropped at merge.
