## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `65a363d7` (base `9f1d37d2`; `origin/main` is now `922323da`).

### Phase 1: Spec Review — PASS

All seven acceptance criteria checked against the diff and re-verified by my own runs:

- **AC1 (race removed)** — PASS. The 64 MiB buffer, the poller `Thread`, both `AtomicBoolean`s and the `java.util.concurrent.atomic.AtomicBoolean` import are gone. No surviving test in `LocalFileSystemSpec` depends on a sleep, a buffer size, a background thread or a scheduling window. The only clock in the file is the pre-existing `Await.result(f, 5.seconds)` helper, which is unchanged, applies to every test in the suite, and is a hang detector rather than an observation window — and the change strictly *reduces* its exposure by deleting the one test (a 64 MiB blocking write) that had any chance of approaching it.
- **AC2 (mutation-proven)** — PASS, re-performed by me (see Phase 2, "Mutation proof").
- **AC3 (no vacuous pass)** — PASS, and independently probe-verified, not just read (see Phase 2, "Vacuity guards").
- **AC4 (second test independently investigated)** — PASS. `fd-leak-evidence.md` carries the verbatim CI excerpt showing test 2 failed at `LocalFileSystemSpec.scala:149` inside its own `Files.write(inner.txt)` *fixture setup*, never reaching an assertion, as collateral damage from descriptor exhaustion — not a shared racy fixture. The ticket's "the two are related" assumption is explicitly tested and corrected rather than inherited, and the ticket's stated mechanism for test 1 (poller never scheduled) is also explicitly refuted in favour of the fd leak. This is the strongest part of the change.
- **AC5 (post-conditions retained)** — PASS. The "no `.tmp` residue after a successful write / only the target remains" assertion survives the deleted test as its own standalone test (`leaves no .tmp residue…`, spec line ~236). The failed-move post-condition is untouched.
- **AC6 (direction stated with reasoning)** — PASS. design.md Decision 1 weighs all three suggested directions and states why a fourth was adopted; Decision 2b takes up the criterion's explicit invitation and states plainly that P2 (same-directory staging) is **not** deterministically observable and is left unguarded, rather than engineering around it. Decision 2 also *withdraws* an earlier draft's false claim that D2 proved P2. Both are exactly the honesty the criterion asked for.
- **AC7 (suite green; >= 20 repeated runs)** — PASS. Executor recorded 21 runs; I re-ran the full `sbt test` (3819/3819) plus 10 further `testOnly LocalFileSystemSpec` iterations under 3-way CPU contention, all 17/17.

Tasks 1.1–4.3 are all marked done and each matches what is actually in the diff (spot-checked 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8 line by line). No scope creep: `git diff --name-only main...HEAD` is one backend test file plus this change's own OpenSpec docs. No spec deltas, so none to review.

### Phase 2: Code Review — FAIL

Gates re-run by me in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set):

| Gate | Result |
| --- | --- |
| `cd backend && sbt test` | **3819 succeeded, 0 failed** (`[success] Total time: 342 s`) |
| `npm run check:scala-quality` | clean (155 pre-existing soft warnings; none new — `LocalFileSystemSpec.scala` is 363 lines, over the 250 soft budget, but that is a warning, not a failure, and the file was already over it) |
| `npm run format:check` | clean |
| `npm run check:schemas` | clean |
| `npm run check:openspec` | clean |
| `npm run check:repo-integrity` | clean |

Frontend gates are not applicable — no file under `frontend/**` changed.

#### Mutation proof (task 3.1–3.4) — RE-PERFORMED, confirms the executor's claim

I did not take this on trust. I edited `LocalFileSystem.write`'s body down to `Files.createDirectories(target.getParent); Files.write(target, bytes)` myself and ran the suite. **Both discriminators went red, each for the mechanism design.md predicts:**

```
- should publishes via rename: a write to a read-only target file succeeds *** FAILED ***
  java.nio.file.AccessDeniedException: /tmp/helio-fs-test8248381640996503045/d1-readonly-target/target.bin
    at java.base/java.nio.file.Files.write(Files.java:3505)
    at com.helio.infrastructure.storage.LocalFileSystem.$anonfun$write$2(LocalFileSystem.scala:31)

- should requires write permission on the target directory: staging fails even though the
  target file itself is writable *** FAILED ***
  false was not equal to true (LocalFileSystemSpec.scala:221)

Tests: succeeded 15, failed 2
```

D1's red is the bare `Files.write` being denied by the `0444` bit, with the stack frame landing on the mutated line 31 — the predicted reason, positively identified, not a coincidental red. D2's red is `result.isFailure shouldBe true` failing, i.e. the write unexpectedly *succeeded* where a staged write must fail — also the predicted reason. Both are genuine discriminators, not happy-path assertions.

I then restored the file and re-confirmed: `git diff -- backend/.../LocalFileSystem.scala` is **empty**, `git diff origin/main -- <same file>` is **empty** (byte-identical to `origin/main`), `git status --porcelain` is clean, and `testOnly LocalFileSystemSpec` is back to **17/17 green**. No production code has a net change anywhere in this branch.

#### Vacuity guards (design.md Decision 3) — PROBED, they fire

I did not accept "the assert is there" as evidence. I neutered the precondition fixtures' `setWritable(false)` calls (simulating a platform that does not enforce POSIX permissions) and re-ran. Both guards failed **loudly, naming the unmet precondition**, before reaching any atomicity assertion:

```
- should publishes via rename: ... *** FAILED ***
  precondDenied was false precondition not met: POSIX permissions are not enforced here
  (running as root?) — this guard cannot discriminate (LocalFileSystemSpec.scala:163)
- should requires write permission on the target directory: ... *** FAILED ***
  precondDenied was false precondition not met: POSIX permissions are not enforced here
  (running as root?) — this guard cannot discriminate (LocalFileSystemSpec.scala:200)
```

Neither degrades to a silent pass, and neither reports "atomicity broken" for what is actually an unenforceable-permissions environment. AC3 is genuinely satisfied. Spec file restored afterwards; tree clean.

#### Retained move-failure test (task 2.6) — unchanged in substance

`git diff main...HEAD` shows **zero** modified lines inside `cleans up the temp file and leaves the original untouched when the atomic move fails`. Read in full at spec lines 243–258: it still forces `Files.move`'s destination to be a non-empty directory, asserts the write fails, asserts no `.tmp` sibling remains, and asserts `inner.txt` survives. It therefore still exercises `write`'s `case NonFatal(e) => Files.deleteIfExists(tmp)` branch — the only test that does, since it is the only fixture in which a staging file is actually created before the failure. Not folded into D2, not weakened.

#### Scope (constraint check)

Only `backend/src/test/scala/com/helio/infrastructure/storage/LocalFileSystemSpec.scala` changed in backend source. No Flyway migration (`git diff --name-only` shows nothing under `db/migration/`), no frontend file, no `NodeDependencyClosure`/preview-engine file, no browser/Playwright use. Confirmed.

#### Quality checks

DRY / readability / modularity: PASS. The two discriminators are self-contained, use only `java.nio.file` + `Try`, name their fixtures descriptively (`d1-readonly-target`, `d2-readonly-dir`), and every non-obvious step carries a comment explaining *why* rather than *what*. No magic values beyond the deliberate 3-byte payloads. No unused imports (`AtomicBoolean` correctly dropped; `Try` and `asScala` still used). No dead code, no TODO/FIXME, no over-engineering, no type-safety escape hatches. `chmod` state is restored in `finally` in all four places, so a failing assertion cannot leave a `0555` directory in the shared temp tree. The rewritten block comment is accurate on every claim I checked against the code.

D2's failure-shape risk is mitigated as design.md promised — it asserts the exception *type*, that the message names the staging directory, **and** that the target still holds its original bytes by byte comparison. That is a positive identification, not a bare "something threw".

#### The one blocking finding — the `git commit -n` justification is factually wrong

The executor bypassed the pre-commit hook citing "a PRE-EXISTING unrelated helio-mcp TypeScript typecheck failure". I verified this independently and **it does not reproduce on main**:

- In the delivery worktree, `npm run check:helio-mcp-types` fails with **195** `error TS` lines — but the head of that output is `TS2307: Cannot find module '@modelcontextprotocol/sdk/client/index.js'`, and `helio-mcp/node_modules` **does not exist** in the worktree. The `TS7031 implicitly has an 'any' type` errors the executor apparently read as the failure are downstream fallout of the missing type declarations.
- In the main checkout at `origin/main`, the identical command exits **0** — clean.
- `helio-mcp/` is **byte-identical** between the branch base `9f1d37d2`, `origin/main`, and this branch's HEAD (`git diff --stat 9f1d37d2 origin/main -- helio-mcp` is empty; `git diff --stat main...HEAD -- helio-mcp` is empty). So the two environments differ only in installed dependencies.
- Conclusive probe: I ran `npm ci --prefix helio-mcp` inside the worktree and re-ran the gate — it now exits **0 at this exact commit**.

So the gate failure was a worktree environment gap (`setup-worktree.sh`'s module linking does not cover `helio-mcp/`), not a pre-existing code failure. The root cause was asserted, not probed — the exact pattern `.concertino/laws/systematic-debugging` forbids, applied here to a decision to *skip verification*. The practical consequence is real, even though this particular change is innocent: the hook aborts at step 5 of 18, so `format:check`, `check:schemas`, `check:spec-structure`, `check:openspec`, `check:scala-quality`, `check:no-credential-leak` and `npm test` never ran at commit time either, and a genuine typecheck regression in a future change would be waved through by the same reasoning.

I have run every skipped gate that applies to this diff (table above) and they all pass, so there is **no hidden defect** — the code is fine. What is not fine is the recorded justification, which is a false statement that will be read as precedent. Change request 1 is a records-and-re-run fix, not a code fix.

### Phase 3: UI Review — N/A

No UI-affecting file changed: the diff is one backend ScalaTest file plus OpenSpec markdown. Nothing under `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`. Per the orchestrator's instruction I did **not** start the dev servers and did **not** drive a browser — HEL-968 owns the shared Playwright session in this parallel fleet.

### Overall: FAIL

The engineering is excellent and would otherwise be a clean pass — the root-cause work in Decision 4 is genuinely better than the ticket's own hypothesis, the discriminators are real (mutation-proven by my own hand), the vacuity guards fire, and Decision 2b's refusal to fake a P2 guard is the right call stated plainly. The single blocker is the unverified bypass justification, which the orchestrator flagged for particular rigour and which does not survive checking.

### Change Requests

1. **Correct the `git commit -n` justification and re-verify the skipped gates.** The claim that the `helio-mcp` typecheck failure is pre-existing on main is false: `helio-mcp/` is byte-identical to `origin/main`, and `npm run check:helio-mcp-types` exits 0 both on the main checkout and — as I proved — in this worktree once `npm ci --prefix helio-mcp` has been run. The real cause is that `helio-mcp/node_modules` was never installed in the delivery worktree.
   - `helio-mcp/node_modules` is now installed in the worktree (I ran `npm ci --prefix helio-mcp` as part of this verification), so the gate is unblocked — re-run the full pre-commit hook (or `npm run check:helio-mcp-types && npm run typecheck && npm run check:scala-quality && npm run format:check`) and confirm green.
   - Replace the "PRE-EXISTING unrelated failure" wording wherever it is recorded (`files-modified.md` final paragraph and the PR body) with the actual diagnosis: *"the pre-commit hook was bypassed because `helio-mcp/node_modules` is not installed in delivery worktrees, so `check:helio-mcp-types` fails on missing module declarations; the gate passes at this commit once dependencies are installed."* Do not restate it as pre-existing.
   - If the commit is amended anyway, prefer committing without `-n` now that the hook can pass.

### Non-blocking Suggestions

- `LocalFileSystemSpec.scala:221` — D2's mutation-red message is the bare `false was not equal to true`. It is the correct red for the correct reason, but a future reader hitting it in CI gets no clue. Consider `withClue("write succeeded where staging into a non-writable directory must fail — has write reverted to a bare Files.write?")` around the `result.isFailure shouldBe true` assertion, so the guard explains itself when it fires.
- `LocalFileSystemSpec.scala:239` (and the retained move-failure test at ~253) still use `Files.list(parentDir).iterator()` without closing the returned `Stream` — the identical unclosed-`DirectoryStream` pattern this ticket traced to the CI abort. Here it is one call per test rather than a tight loop, so it leaks 2 descriptors instead of 40,002 and is harmless in practice. Still, leaving the exact leaking idiom in the file that documents it as the root cause invites it to be copied; wrapping both in `Using.resource(Files.list(parentDir))` would close the loop rhetorically as well as literally. Not blocking.
- `LocalFileSystemSpec.scala` is now 363 lines against the 250-line soft budget in `check:scala-quality` (warning only, and the file was already over before this change). Worth noting for a future split, not for this ticket.
- Worktree-setup follow-up (outside this ticket's scope): `setup-worktree.sh`'s module linking covers the root and `frontend/`, but not `helio-mcp/`, which is what made a pre-commit gate unrunnable in a delivery worktree and produced the bypass above. A spinoff ticket to add `helio-mcp/node_modules` to the linked-modules set would remove this trap for every future delivery run.
