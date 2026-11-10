## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `e55f9265262cf24e7feee21b856924f3fb78adca`. The base was resolved live with `resolve-review-base.sh`
(main/origin) and is `afca73bc8ac9bf039937b2d21fcef459573a3650`, which is also the merge-base. The diff is 79 files,
+6219/-69. The spawn-cwd guard printed `READY`. This round covers the four delivery commits added after the round-1
CONFIRM at `e2bcf6b8c` (skeptic-final-1.md). It checks that they keep what round 1 confirmed.

### What I verified (with evidence)

**1. The squash 85a7e045d is not byte-identical to e2bcf6b8c. The difference is one documentation line.**
- The two trees differ (`37ce7d39a…` vs `6afd6a3b1…`). `git diff e2bcf6b8c 85a7e045d` shows exactly one change. It adds one line to
  `openspec/changes/helio-mcp-remote-oauth-connector/files-modified.md`, which declares `scripts/check-dependabot-groups.mjs`.
  `squash-branch.sh` builds its allowlist from that file, so this line was needed for the squash to stage the script.
- No code, test or config differs. The archive commit then removes files-modified.md. That matches repo convention:
  `git ls-files` finds 0 files-modified.md among 945 archived changes.
- The squash's parent is `afca73bc8`, the same base e2bcf6b8c's history was on.

**2. The archive commit 9c528a84e is faithful.**
- Every change-dir file is a 100% rename into `archive/2026-11-09-helio-mcp-remote-oauth-connector/`. The commit
  adds only evaluation-2.md and skeptic-final-1.md, and deletes only files-modified.md.
- For each of the three canonical specs, I compared everything from the first `### Requirement` down against the delta spec. All three
  are IDENTICAL. Requirement/scenario counts: transport 5/10, oauth 6/16, consent page 2/9, the same in both.
  Each canonical spec has a real one-sentence `## Purpose`. None contains TBD or TODO.
- `openspec validate <name> --type spec` reports all three as valid. `npm run check:openspec` prints "openspec/ is clean", exit 0.

**3. The Gate-Chain checklist commit 443435575 makes true claims.**
- `git diff afca73bc8 HEAD -- scripts/check-dependabot-groups.mjs` adds only three `DECLARED_INDEPENDENT` data entries, with no change to logic.
  `git diff -- .husky` is empty.
- A grep of the script finds no `process.env`, `process.cwd`, `child_process`, `spawn`, `exec`, file writes or fetch.
  It gets the root from `process.argv[2]` or from `dirname(fileURLToPath(import.meta.url))/..`, as the checklist states.
- The isolation transcript the checklist cites exists at
  `/home/matt/Development/helio/.concertino/runs/HEL-1709/evidence/.concertino/gate-chain-isolation-evidence/scripts__check-dependabot-groups.mjs.md`.
  It used a linked-worktree fixture with GIT_DIR exported, exited 0 and printed OK.
- `npm run check:dependabot` passes fresh, exit 0.

**4. The CredentialSurfaceEnumerationSpec allow-list commit e55f92652 is accurate and does not weaken the guard.**
- `grep -rl credential helio-mcp/src` finds exactly 19 files, and the case-insensitive count is also 19. The test's
  "nineteen" matches this.
- I checked each new entry's reason against the lines that actually match:
  - `httpConfig.ts:51`: an error string, "no path, query, fragment or credentials". True.
  - `oauth/patCheck.ts:12`: a doc comment, "not a usable connector credential". True.
  - `oauth/routes.ts`: line 5 (comment), line 44 (`credentials: false` CORS option), and lines 103/112/113 (three
    error-page sentences). True, and the count of three is correct.
  - `oauth/oauthFlow.test.ts:145`: asserts the `access-control-allow-credentials` header is null. True.
  - `testing/httpHarness.ts:3`: the comment "nothing here is a real credential". True.
- None of the matches is a credential value. Each is prose, an option name or a header name.
- The guard is still strict. The test asserts set equality (`actual shouldBe allowedMatches.keySet`), so any future file that
  mentions credential still fails it. The Scala agent-surface check ("ZERO files") was not changed.
- Fresh run: `sbt testOnly com.helio.services.assistant.CredentialSurfaceEnumerationSpec` ran 2 tests, 2 passed, and the
  hel1468 guard reported failed=0. The test names it printed include "nineteen", so it executed the new code.
- The only file outside `openspec/` that changed since e2bcf6b8c is this test file
  (`git diff --stat e2bcf6b8c HEAD -- . ':(exclude)openspec'`). So every frontend, helio-mcp, infra and UI result
  from round 1 still applies, and I did not repeat the UI or screenshot review.

**5. The CI claims are confirmed.**
- PR #1110's head is e55f92652. In run 42745872975, all seven e2e legs and e2e-prod-build fail at the step
  "Run ./.github/actions/e2e-setup", before any test runs. `security` fails at the backend CVSS, root audit, frontend audit and helio-mcp audit steps.
- PRs #1105 through #1109 each show `e2e (1)=fail security=fail` as well.
- I checked locally whether this branch adds any helio-mcp advisory, using `npm audit --package-lock-only --omit=dev` on the lockfile at each ref.
  Base afca73bc8 has 5 advisories (2 high: body-parser, zod; 3 moderate). HEAD has 1, zod high, which is already on main.
  The branch reduces the advisory count and adds none.
- When I checked, the backend, frontend and docker-image legs were still pending. The only backend change, the spec above,
  passes locally.

### Verdict: CONFIRM

The delivery commits only rename, document and widen a test allow-list, and each allow-list reason is true. The squash
differs from e2bcf6b8c by one declaration line, and the archive then removes that line. Nothing weakens what round 1
confirmed.

### Non-blocking notes
- The orchestrator's description of the squash as "tree-identical" is not literally true. It differs by the one files-modified.md
  line described in section 1, and has no effect on code.
- The backend, frontend and docker-image CI legs were still pending when I reviewed. Confirm they finish green before merge.
