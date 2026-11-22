## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 1f8e762b5b0055a2c1c76eddd47771eeca8823db (the change dir is untracked, not yet committed).

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/remove-deleted-user-upload-folders/HEL-1802`.
- **Conversation path layout:** `AssistantConversationService.scala:190-191` builds
  `assistant-conversations/${user.id.value}/${id.value}.json`. Confirmed.
- **The empty-folder mechanism:** `LocalFileSystem.delete` is `Files.deleteIfExists(resolve(path))` and nothing else.
  `resolve` is `baseDir.resolve(path).normalize()` with no containment check, so D1's "a path outside baseDir is not
  walked" guard is needed. Confirmed.
- **The queue covers conversation rows:** V132 `hel1530_enqueue_conversation_object` (lines 93-105) inserts
  `OLD.gcs_body_ref` with `claimed_at='infinity'` and `not_before=now()` on every row delete. The AFTER DELETE trigger
  is `ENABLE ALWAYS`. `StoredObjectDeletionService.scala:88` drains through `fileSystem.delete(row.storageKey)`. Confirmed.
- **Production has no account deletion:** grepping `backend/src/main` for a `users` delete
  (`delete from users`, `sqlu` plus `users` plus `delete`) finds no application deletion of a `users` row. The only
  matches are comments, `UPDATE users` and deletes on other tables. `docs/user-reference-inventory.md:5` says
  "No application code deletes users today". Confirmed.
- **Other families are flat:** every write-site key in `backend/src/main` is flat. The keys are `csv/<id>.csv`,
  `text/`, `pdf/`, `image/`, `images/<id>.<ext>` and `form-uploads/<uuid>.<ext>`. Only `assistant-conversations` is
  nested. A read-only `find` count of `~/.helio/uploads` found 0 subdirectories in csv, form-uploads, image, images, pdf
  and text. Confirmed.
- **Folder counts (read-only, counts only):** `~/.helio/uploads/assistant-conversations` has 331 directories. 297 are
  empty, 0 entries are not directories, 0 are symlinks, and nothing sits at depth 3 or more. This matches the
  premise-validation claim of "331 folders, 297 empty, 34 non-empty".
- **Callers of `buildUserDeleteSql`:** `git grep` finds three: `e2e/support/userCleanup.ts:78`,
  `helio-mcp/scripts/layoutPreconditionSeam.ts:234` and **`scripts/landing-captures/run.mjs:123`**.
- **How the uploads root is resolved:**
  - The dev backend's env is `DevEnv.runEnv(parseDotEnv(backend/.env), sys.env)` (`backend/build.sbt:152`,
    `backend/project/DevEnv.scala:65-66`). So `backend/.env` keys reach `LocalFileSystem.fromEnv` whenever the shell
    has not exported them.
  - The e2e DB helper copies that behaviour: process env first, then `backend/.env` (`e2e/support/db.cjs:2,16,29-38`).
  - `git grep` finds no `HELIO_UPLOADS_ROOT` in `scripts/concertino/start-servers.sh` or anywhere else in the lane
    tooling. Only `helio-mcp/scripts/isolatedRun.ts:249` sets one, for its own isolated server.
  - (I did not read any `.env` file, per C1.)
- **Pre-commit/CI parity:** `scripts/check-precommit-ci-parity.mjs` fails when a hook `npm run X` has no
  `.github/workflows/ci.yml` counterpart. The existing user-cleanup selftests are wired in both places
  (`.husky/pre-commit:24-26` and `ci.yml:139-141`).
- **Spec deltas:** `stored-object-lifecycle` and `e2e-test-user-cleanup` both exist under `openspec/specs/`.
  `orphan-upload-folder-prune` is new. All three deltas are ADDED requirements with scenarios.
- **AC coverage:**
  - AC1 (a red test proving the user folder is gone) maps to task 1.1 and the stored-object-lifecycle scenario.
  - AC2 (prune dry run lists orphans and changes nothing) maps to D3, task 3.2 and task 5.3.
  - AC3 (production behaviour documented in the PR) maps to D4.

### Verdict: REFUTE

### Change Requests

1. **D2's uploads-root resolution does not match the root the dev backend uses. The spec requires it to.**
   - The `e2e-test-user-cleanup` delta says teardown removes the folder "under the uploads root **the backend uses**".
   - D2 specifies `resolveUploadsRoot(env, homedir)` "mirroring `LocalFileSystem.fromEnv`", which reads process env
     only.
   - The dev backend also gets `backend/.env` through `DevEnv.runEnv`. A per-key merge applies: a shell-exported key
     wins, and `.env` fills in the keys that are missing.
   - So a developer who sets `HELIO_UPLOADS_ROOT` in `backend/.env` (the HEL-269 setup CLAUDE.md recommends for several
     worktrees) gets a teardown that resolves `~/.helio/uploads`. The force `rmSync` then silently does nothing, and
     the residue this ticket exists to stop keeps accumulating.
   - Required revision: resolve from the same merged map the backend sees. That means process env, then
     `backend/.env` for keys the process env lacks, reusing `db.cjs`'s `readEnvFile` (never printing values). Then
     apply `HELIO_UPLOADS_ROOT`, then `HELIO_UPLOADS_DIR`, then the home default.
   - Add a selftest case: `.env`-only `HELIO_UPLOADS_ROOT` is honoured, and a process-env key overrides the `.env` key.
2. **Correct the false mitigation claim in design.md Risks.** "lanes set `HELIO_UPLOADS_ROOT` for both" is not true
   of the lane tooling: `start-servers.sh` sets no uploads root, and nothing else in the repo does except
   `isolatedRun.ts`. Restate the risk using the resolution from item 1. Decide whether teardown should log the count of
   folders it found and removed per run, so that a mismatch is visible rather than silent. The count would be a number
   only, with no path under `~` and no id.
3. **The spec and the tasks disagree on which callers are covered.**
   - The `e2e-test-user-cleanup` delta says "every repository caller of the throwaway-user delete", and the proposal
     says "for every `buildUserDeleteSql` caller in this repo".
   - D2 and task 3.1 name only `userCleanup.ts` and `layoutPreconditionSeam.ts`. The third caller,
     `scripts/landing-captures/run.mjs:120-123`, is uncovered.
   - Fix this one of two ways:
     - add it to D2 and task 3.1; or
     - narrow the spec and proposal wording to the callers whose users can own a conversation, and state why
       landing-captures is excluded. Its throwaway user never calls an assistant route: `grep -i
       "assistant|conversation" scripts/landing-captures/` returns nothing.
   - Either way, the spec, the proposal and the tasks must agree.
4. **Task 3.2 and the Impact section miss the CI wiring.**
   - The plan wires `check:prune-orphan-conversations:selftest` into `.husky/pre-commit` only.
   - `check-precommit-ci-parity.mjs` will fail CI unless the same `npm run` line is added to a `ci-complete`-gated job
     in `.github/workflows/ci.yml`. The existing selftests sit next to each other at lines 139-141.
   - Add `ci.yml` to task 3.2 and to the proposal's Impact list.

### Non-blocking notes

- **D1, missing file:** D1 should say whether the upward walk also runs when `deleteIfExists` returns false (the file
  was already gone). Running it unconditionally is cheap. It also lets a re-drained or already-missing key still clear
  an empty `<userId>/` folder. Pick one behaviour and test it.
- **Task 1.1, statement order:** task 1.1 says "via the buildUserDeleteSql statement order". A Scala test cannot call
  the JS builder, so a hand copy can drift. The trigger fires on any `assistant_conversations` row delete, so a plain
  `DELETE FROM users WHERE id = ...` cascade, or the explicit child delete, is a sufficient and drift-free fixture. Say
  which one.
- **`layoutPreconditionSeam.ts`:** it drives a remote `BASE_URL` backend whose uploads root may not be this process's
  root. Its user never creates a conversation, so adding the folder removal there is harmless but unproven. Keep it if
  the spec stays "every caller", and say that it is a no-op in practice.
- **D5 follow-up:** design.md says the CON lane-cleanup follow-up is "raised at Delivery", but no task tracks it. The
  orchestrator should carry it in workflow-state so it is not dropped. Users created in a lane DB outside the e2e
  registry, such as a manual evaluator signup, are cleaned only by the prune script.
