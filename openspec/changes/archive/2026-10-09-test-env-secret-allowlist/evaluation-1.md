## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: f0fb3e5e402f9d1e8189d9401373bf79cbd14416 (base resolved live by resolve-review-base.sh: e6c37d541c8e3b1b60a0fdfe02345fa311bcbdc9).
All evidence below is by key name or by hash only (C1). No value from `backend/.env` was read or printed during this review.

### Phase 1: Spec Review — PASS

- AC1 (explain why tests got the full `.env` and why `.env` holds real values): covered in design.md Context and proposal.md Why.
- AC2 (narrow `Test / envVars`, red-first, key names only): `Test / envVars := DevEnv.testEnv` (backend/build.sbt:145), a fixed two-key test-only map. The build-level wiring guard (backend/build.sbt:224) compares the whole computed map to `DevEnv.testEnv` (C3), and `DevEnvSpec` covers the logic using a dummy fixture. I re-verified both red-first claims myself (see Phase 2).
- AC3 (MISTAKES.md entry): MISTAKES.md:289-300. It names `show Test/envVars`, `show Compile/run/envVars`, `printenv`, `env`, `cat`, `source` and `grep`-with-values, and gives `sed -E 's/=.*//'` and `sbt envVarKeys` as the safe alternatives.
- AC4 (CON ticket): CON-247 exists in Linear (Backlog) with the matching title.
- AC5 (no prod secret change): the diff does not touch infra/, `.github/`, Dockerfile or Secret Manager wiring.
- AC6 (HEL-1454 item 3): `DevEnv.runEnv` skips keys already in the process env, so a shell export wins. This is tested in DevEnvSpec.
- AC7 (owner `.env` untouched): `backend/.env` is untracked and does not appear in the diff. Its key set is still intact (checked by key name).
- tasks.md: every item is ticked and matches the diff.
- Spec delta: the four requirements match the implementation.
- Scope: no creep. `.env.example` gets a 2-line header comment.
- CONSTRAINTS C1-C4 are honored:
  - C1: no message formats a value or a whole map.
  - C2: `.env` was not edited.
  - C3: the guard compares the whole map and reports names only.
  - C4: a shape-only scan of the openspec change dir found only placeholders (`KEY=VALUE`, `SOME_KEY=<value>`, `<CI test value>`). The commit message has no `KEY=` lines. `check:no-credential-leak` passes (0 violations).

### Phase 2: Code Review — PASS

Gates I ran fresh in WORKTREE_PATH:
- `sbt testFull` (nice -n 19, -J-Xmx3g): 6507 succeeded, 0 failed, 4 canceled (the perf-median cancels, the same count as the executor's run), exit 0. All 7 DevEnvSpec tests ran and passed.
- `check:scala-quality`: clean (soft warnings only, none from this diff).
- `check:openspec`, `check:spec-structure`, `check:repo-integrity`, `check:precommit-ci-parity`: all pass.
- `check:no-credential-leak`: OK, 0 violations.
- Prettier on MISTAKES.md and the openspec markdown: clean.
- There are no frontend changes, so the npm gates do not apply.

Red-first claims, verified independently in a throwaway detached worktree at f0fb3e5e4. A copy of the dummy fixture served as `backend/.env`; the owner's file was never used. The worktree was removed afterwards (`git worktree list` shows 0 matches).
- Wiring mutation (`Test / envVars := DevEnv.testEnv ++ DevEnv.parseDotEnv(...)`): `testOnly DevEnvSpec` exited 1 at the build guard with this error. It names keys only, and no dummy value appears anywhere in the log (grep count 0):
  `Test / envVars must equal DevEnv.testEnv (HEL-1450). unexpected keys: ANTHROPIC_API_KEY, DATABASE_URL, DB_PASSWORD, GCLOUD_DB_PASSWORD, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, HELIO_OWNER_EMAILS; missing keys: ; keys whose value differs: CONNECTOR_MASTER_KEY, CONNECTOR_MASTER_KEY_ID`
- Semantics mutation (`testEnvFor` returns the dotEnv argument; `runEnv` returns dotEnv unfiltered): DevEnvSpec reported 1 succeeded and 6 failed. Every failure message is key-name or hash only (for example "test env leaks keys: ...", "run env contains GCLOUD_DB_PASSWORD", "run env sets HELIO_OWNER_EMAILS despite the process env having it").
- `sbt envVarKeys`, run twice in one sbt server session, printed output both times:
  - `test:` CONNECTOR_MASTER_KEY, CONNECTOR_MASTER_KEY_ID
  - `run:` 8 keys, without GCLOUD_DB_PASSWORD
- CI parity: the `CONNECTOR_MASTER_KEY` and `_ID` values in DevEnv.scala equal those in `.github/workflows/ci.yml`, compared by SHA-256 prefix (31e631975f3f and fa844ddebe56 match at both sites).
- Dev-server start (`.concertino.env`, `PORT=... CORS_ALLOWED_ORIGINS=... sbt run`): those keys are not in `.env`, so shell precedence changes nothing for start-servers.sh.

Checklist:
- Canonical code quality: no inline FQNs. DevEnv.scala is 80 lines and DevEnvSpec.scala is 71, both within the soft budgets.
- DRY: `loadDotEnv` was moved, not duplicated.
- Type safety: no escape hatches.
- Error handling: the guard fails loudly with `sys.error`.
- Tests are meaningful: proven failable by the mutations above.
- No dead code or TODOs. The one partial exception is noted under Suggestions.
- Uncached run env (D5): done.

Issues: none blocking.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. The spec delta lives under `openspec/changes/`.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- backend/project/DevEnv.scala:60: `testEnvFor(dotEnv)` ignores its parameter and exists only as a seam for the spec. The build uses `DevEnv.testEnv` directly (build.sbt:145), so the "with vs without a .env" spec test only checks the seam. The build side is covered by the wiring guard, so this is acceptable. Consider either dropping the parameter or using `testEnvFor(parseDotEnv(...))` in build.sbt so the spec and the build share the same call. The doc line at :60 is also 152 characters, longer than the surrounding code.
- design.md Risks says there is "a comment at both sites naming the other" for the duplicated CI test value. DevEnv.scala names ci.yml, but ci.yml has no reverse pointer to DevEnv.scala. Either add a one-line comment next to the `CONNECTOR_MASTER_KEY` env in ci.yml (a comment, not an env change) or amend the design text.
- The commit subject says "allowlist dev-server env", but the dev server uses a never-forward denylist (`GCLOUD_DB_PASSWORD`); only tests use a fixed allowlist. Reword it at squash time.
- Owner follow-up already noted in design.md: earlier `Test/envVars` results may still be cached in sbt's CAS under `~/.cache/sbt`. This is out of scope for the lane, since it would mean writing under `~`.
