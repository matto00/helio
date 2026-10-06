## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `38fc5d567937ba157716aabc7bf3e0a7ca2c0ba3`. Diff base resolved live: `2c1884ac5b2cc2578320ace4a21e37b32df5c603`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/nodepayload-spec-share-control/HEL-1334`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (use the shared helper): `NodePayloadWiringSpec.scala:101` now uses `TokenHashing.sha256Hex(shareToken)`. The
  `java.security.MessageDigest` import is removed, and nothing else in the file uses it. `TokenHashing.sha256Hex`
  (`backend/src/main/scala/com/helio/infrastructure/crypto/TokenHashing.scala:15`) is the same helper the production
  `ShareTokenValidatorImpl` uses.
- AC2 (positive control): `:129-133` sends `GET /api/dashboards/:d/panels/:p/history?token=<share>` through the full
  `api` tree. It asserts `200` and a non-empty `points` body. The control is not vacuous. The public viewer grant now
  goes in only after the control (phase B, `:137-141`). Before that, `:126-128` asserts that anonymous `/history` gets
  `404`. That makes the share token the only way in, as the design's Context section requires. HEL-1276's original
  coverage is still there: the payload path is asserted `401` both with and without the public grant
  (`assertPayloadPathRefused()` at `:134` and `:141`).
- Red/green evidence is recorded in `mutation-evidence.md`. I reproduced both independently (see Phase 2).
- Tasks 1.1–1.6 are all checked, and they match the diff. Scope: one test file plus openspec artifacts. There are no
  production, CI, Playwright or `.gitignore` changes.
- Driver constraint "the positive control must pass on unmodified product code" holds: it passed without any product
  change, so nothing needs escalating.
- `workflow-state.md` CONSTRAINTS is `[]`, so there is nothing to check against.

### Phase 2: Code Review — PASS
Issues: none.

Gates and evidence, all from my own fresh runs in `WORKTREE_PATH`:
- GREEN on unmodified HEAD: `nice -n 19 sbt "testOnly com.helio.api.NodePayloadWiringSpec"` gave
  `Tests: succeeded 2, failed 0`.
- RED under the mutation `val tokenHash  = TokenHashing.sha256Hex(shareToken + "-broken")`, applied by me with sed:
  the same command failed with
  `should store a payload ... *** FAILED ***  404 Not Found was not equal to 200 OK (NodePayloadWiringSpec.scala:130)`
  and `Tests: succeeded 1, failed 1`. Line 130 is the positive-control status assertion. This matches the executor's
  recorded red exactly.
- Revert: I restored the file with `git checkout -- <file>`. After that, `git status --short` and `git diff --stat`
  were both empty. The mutation was never committed.
- Full backend gate, after the revert: `nice -n 19 sbt testFull` exited 0 with
  `Tests: succeeded 6030, failed 0, canceled 0, ignored 0, pending 0`. The default forked-group concurrency is 1, which
  is within the 2-worker cap. Afterwards I ran `sbt --client shutdown` as its own call.
- Pre-commit checks relevant to this diff all exited 0: `check:scala-quality` (clean, soft warnings only, none of them
  new for this file), `check:openspec`, `check:spec-structure`, `check:repo-integrity`, `check:test-temp-dir-hygiene`,
  `check:no-credential-leak`, `format:check`.
- No frontend files changed, so the frontend gates do not apply.

Code quality:
- Readable and DRY. The local `assertPayloadPathRefused()` helper removes what would otherwise be two copies of the
  `401` loop. The comments explain why the public grant has to come after the control.
- No dead code, no unused imports, no TODOs, no over-engineering.
- The test is meaningful: it is red-then-green under a token-breaking mutation, so a broken token can no longer pass
  for the payload path refusing tokens.

### Phase 3: UI Review — N/A
No UI-trigger paths changed (no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `NodePayloadWiringSpec.scala:97`: the comment "Public payload path through the FULL tree: 401 anonymous and
  token-only, no row data" now introduces a block that also contains the 200 positive control. It could mention that.
