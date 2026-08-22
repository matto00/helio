## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `82d252f0` on `task/scope-openspec-archival-hygiene-check/HEL-657`
Base: `origin/main` = `3596b161` (HEL-775). `git merge-base --is-ancestor origin/main HEAD` → true;
`git rev-list --count origin/main..HEAD` = 1 (single, linear implementation commit — CON-129 satisfied).

All evidence below is from my own fresh runs in this worktree (or in throwaway copies under the
session scratch dir). The executor's own gate report was not relied on for any verdict
(`verification-before-completion`). Every probe was run read-only against the delivery worktree:
its ref set (`git for-each-ref | md5sum` = `8e74767b…`, 205 refs), `HEAD` (`82d252f0…`) and
`git status --porcelain` (only the orchestrator's own `workflow-state.md` PHASE edit) were
byte-identical before and after the entire evaluation.

---

### Phase 1: Spec Review — PASS

**AC1 — rule no longer fires on an executor's mid-Execution commit.** PROVEN LIVE, both directions,
against this worktree's real state (the change sits complete-and-unarchived, 37/37):

- OLD script (`git show origin/main:scripts/check-openspec-hygiene.mjs`, run against this worktree's
  real `openspec/` via a mirror root so nothing in the repo was touched):
  ```
  OpenSpec hygiene issues:
    - change "scope-archival-hygiene-rule" is complete (37/37) but not archived — run `openspec archive scope-archival-hygiene-rule`
  exit code = 1
  ```
- NEW script, in place, same state:
  ```
  openspec/changes/scope-archival-hygiene-rule: complete but in flight (absent from origin/main, last activity 0d ago)
  openspec/ is clean
  exit code = 0
  ```
  The exempt diagnostic (D13) is present and names both the change and the reason, so
  "examined and exempted" is distinguishable from "did nothing".

**AC2 — still fires when genuinely overdue. Not a check that stopped firing.** I did not settle for
the synthetic fixtures; I proved both overdue conditions against the REAL 37/37 change directory in a
throwaway shallow clone of this branch:

- *Escaped* — `git branch -f main HEAD` in the clone (change now reachable from the base branch):
  ```
  - change "scope-archival-hygiene-rule" is complete (37/37) but not archived — overdue: reachable from main — run `openspec archive …`   [exit 1]
  ```
- *Stale* — base ref removed, author date backdated 20d (committer date = now, i.e. the rebase shape):
  ```
  - change "scope-archival-hygiene-rule" is complete (37/37) but not archived — overdue: inactive for 20d (threshold 14d) — …   [exit 1]
  ```
  Same content with `OPENSPEC_HYGIENE_STALE_DAYS=30` → back to exempt, exit 0. With
  `OPENSPEC_HYGIENE_STALE_DAYS=abc` → default 14 applied → fires. The `%at`-vs-`%ct` claim is real:
  after `commit --amend`, `%ct` = now while `%at` held at 20d, and the check still fired.
- *Both conditions at once* renders as
  `overdue: reachable from main AND inactive for 20d (threshold 14d)` — matching the header comment.

**AC3 — no bypass needed for this reason.** `npm run check:openspec` passes in this worktree with the
change complete-and-unarchived (above). All nine pre-commit gates pass on this tree (Phase 2), so the
commit needed no `-n`; the commit body's "no bypass required" claim is consistent with what I measured.

**AC4 — executable evidence, not reasoning.** Satisfied by the above plus the reproduced mutation
controls (Phase 2).

**AC5 — rules 2 and 3 preserved.** Their code is textually identical to `origin/main` modulo
indentation (rule 1's move into `main()`), with the single specified addition of the D15 ENOENT guard
on `archive/`. Both message strings are byte-identical to the old ones, and the self-test asserts on
that text. Verified firing: stray-file case and leftover-`files-modified.md` case both exit 1 with the
expected wording.

**AC6 — HEL-775 / HEL-683 untouched.** `scripts/check-spec-structure.mjs` is absent from
`git diff --name-only origin/main...HEAD`. `jest.config.cjs` is absent from the diff. The only
`.husky/pre-commit` change is one added line; the file now reads lint → **typecheck (HEL-683)** →
format:check → check:schemas → **check:spec-structure (HEL-775)** → check:openspec →
check:openspec:selftest → check:scala-quality → test. Order intact, nothing removed or reordered.

**Tasks / scope.** All 37 task items are marked done and each maps to something I can point at in the
diff (1.2 `targetRoot` at `check-openspec-hygiene.mjs:73`; 1.3 telemetry env with `...process.env` at
`:224`; 1.4 `resolveBaseRef` `:113`; 1.5 `--full-tree` `:126`; 1.6 `%at` `:158`; 1.7 recursive mtime
incl. the dir's own `:137`; 1.8 threshold `:81`; 1.9/1.10 `:282`/`:291`; 1.11 `stdio` + D6 `:92`/`:275`;
1.12 ENOENT guard `:310`; 1.13 header `:1-39`). Diff touches exactly the four declared files plus this
change's own planning artifacts — no scope creep, no drive-by edits. `openspec validate
scope-archival-hygiene-rule --strict` → "Change 'scope-archival-hygiene-rule' is valid". Planning
artifacts describe the implemented behavior accurately (design D1–D15 all landed as written).

Issues: none.

---

### Phase 2: Code Review — PASS

**Gates, re-run individually by me in `WORKTREE_PATH` (not trusted from the executor):**

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (exit 0, eslint zero-warnings) |
| `npm run typecheck` | PASS (exit 0, `tsc --noEmit`) |
| `npm run format:check` | PASS — "All matched files use Prettier code style!" |
| `npm run check:schemas` | PASS — 66 checked across 47 protocol files; 7 enum surfaces |
| `npm run check:spec-structure` | PASS — 318 canonical specs, 0 issues |
| `npm run check:openspec` | PASS (exit 0) + exempt diagnostic printed |
| `npm run check:openspec:selftest` | PASS — 17 passed, 0 failed, 17 total (1980 ms) |
| `npm run check:scala-quality` | PASS — clean (128 soft warnings, pre-existing) |
| `npm test` | PASS — 254 suites, 2751 tests |

Self-test wall time 1.98–2.00 s across five runs, inside D14's stated 3 s budget. `openspec list --json`
with `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1` is byte-identical to without (`cmp` → identical) and 0.109 s
vs 0.509 s — so D14 removes a per-commit third-party network call with no output change. The
implementation correctly spreads `...process.env` (`:224`), so `PATH` is preserved.

**Mutation controls reproduced independently** (run against copies of both scripts in a scratch dir, so
the worktree was never modified; the unmutated copy scored 17/17 first as a sanity check):

- *Mutant A — rule 1 reverted to unconditional reporting*: 13 passed, **4 failed** — `2.10` (in-flight,
  AC1), `2.11` (fresh untracked), `2.12 A` (fresh change still exempt), `2.13` (invalid threshold).
  Failure output shows the exact false positive the ticket describes.
- *Mutant B — overdue predicate forced always-false* (the ticket's forbidden failure mode): 11 passed,
  **6 failed** — `2.6`, `2.7`, `2.8`, `2.9` (all four FIRES cases) plus both `2.12 C` degradation cases.
- *Mutant C — fixture setup made to throw* (my own addition, to test self-test honesty): the suite dies
  loudly with an uncaught exception and exit 1; it does not silently skip a case or report a green
  summary. The `finally` cleanup still removed every fixture.

So the suite genuinely can fail, in both directions, and the cases are real subprocess runs against real
git repositories driven by the real `openspec` CLI — not text-matching over a fixed string.

**The GIT_DIR hazard (highest-risk part of the diff) — verified, not taken on trust:**

- (a) Every child `git` invocation in both scripts funnels through a single helper (`runGit` at
  `check-openspec-hygiene.mjs:92`, `git()` at `check-openspec-hygiene.selftest.mjs:86`) and both call
  `gitChildEnv()`, which deletes `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`,
  `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`. There is no second `execFileSync("git"…)`
  path in either file.
- (b) The fix holds under injection. I exported the hook-shaped values git would set
  (`GIT_DIR=/home/matt/Development/helio/.git/worktrees/HEL-657`, `GIT_INDEX_FILE=…/index`,
  `GIT_WORK_TREE=<worktree>`, `GIT_COMMON_DIR=…/.git`) and re-ran both scripts: self-test 17/17, main
  check exit 0 with the exempt diagnostic. Afterwards the worktree's ref-set md5, ref count, `HEAD` and
  `git status` were unchanged — nothing was redirected onto the real branch.
- (c) No residue. `git log origin/main..HEAD` is exactly one commit; the two spurious fixture commits
  (`4b8c7c99 add escaped-change, on main`, `17cd72e9 seed main`) appear only in the reflog, followed by
  `reset: moving to 3596b161`, and the final commit's parent is `origin/main`. No `feature`/`trunk`/
  fixture-named refs exist. No fixture leftovers in `/tmp` after any run (`ls -d /tmp/openspec-hygiene-selftest*`
  → 0, including after the crashing Mutant C).

**D10 pinning verified by control, not by reading:** run from a subdirectory (`cwd=<target>/scripts`)
and from an unrelated cwd (`/`), the escaped case still fires identically. Run from
`<worktree>/scripts` with no argument, the real check still resolves the real repo and exempts. The
"silently returns false from a subdirectory" failure this guards against does not occur.

**Code quality.** DRY (one `runGit`, one `gitChildEnv`, one mtime walker); no magic values
(`DEFAULT_STALE_DAYS`, named env constants); errors handled at every boundary with D6's
degrade-toward-reporting semantics rather than a silent `false`; no `TODO`/`FIXME`/debug leftovers; no
shell interpolation anywhere (`execFileSync` with argv arrays, and both pathspecs sit after `--`, so a
change directory name can never be read as a git option). `check-openspec-hygiene.mjs` is 342 lines /
238 code lines, within CONTRIBUTING's ~250 soft budget. Rules 2/3 were not restructured — this is a
behavior-preserving move for them plus one documented guard, exactly as task 1.14 required.

Issues: none blocking (see Non-blocking Suggestions).

---

### Phase 3: UI Review — N/A

No UI-affecting file changed. The diff touches `scripts/**`, `package.json`, `.husky/pre-commit` and
this change's own `openspec/changes/**` artifacts only — no `frontend/**`, no
`backend/src/main/scala/routes/ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**`. No dev server
was started, per the orchestrator's instruction and the trigger list.

---

### Overall: PASS

The deliverable is still a check. It fires on both real overdue states and is exempt only for the
in-flight state the ticket names, and I confirmed the suite that proves this can actually fail.

### Change Requests

None.

### Non-blocking Suggestions

1. **Self-test fixture commits inherit `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` from the parent env.**
   This is the same env-leak family as the GIT_DIR bug the executor already fixed, one layer over.
   Measured: `GIT_AUTHOR_DATE="@<now-40d>" GIT_COMMITTER_DATE="@<now-40d>" npm run check:openspec:selftest`
   → **15 passed, 2 failed** (`2.10` in-flight and `2.13` invalid-threshold), because the "committed now"
   fixtures are backdated by the ambient env. It fails *red*, never green, so it cannot hide a defect —
   but a contributor who exports those vars would get an unexplained pre-commit failure, which is the
   routine-bypass pathology this very ticket exists to remove. Suggested fix, ~2 lines in
   `scripts/check-openspec-hygiene.selftest.mjs:56-69`: also strip `GIT_AUTHOR_DATE`,
   `GIT_COMMITTER_DATE`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`,
   `GIT_COMMITTER_EMAIL` in `gitChildEnv()` (each case re-supplies what it needs explicitly).
   For completeness I confirmed the task-2.2 scenario itself is genuinely covered: with
   `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null` (a contributor with no git identity at all)
   the suite is 17/17.
2. **Dead parameter.** `evaluateOverdue(change, gitOk, baseRef, staleDays, nowSeconds)` at
   `scripts/check-openspec-hygiene.mjs:185` never reads `gitOk`; it is passed at `:269`. ESLint's
   `no-unused-vars` defaults to `args: "after-used"`, so a middle parameter like this is not reported —
   worth deleting by hand.
3. **One spec scenario has no committed case.** "Threshold overridden — `OPENSPEC_HYGIENE_STALE_DAYS`
   set to a positive integer" is asserted by the spec delta but only the *invalid* value is covered by
   the self-test (`2.13`). I verified the positive path manually (a real 20d-stale change flipped back
   to exempt at `OPENSPEC_HYGIENE_STALE_DAYS=30`); a one-line case would make it recurring.
4. **File size.** `scripts/check-openspec-hygiene.selftest.mjs` is 450 lines (371 code), past
   CONTRIBUTING's ~250 soft budget and its ~400-line "propose a split in the PR description" threshold.
   The per-case structure justifies it, but call it out in the PR description as CONTRIBUTING asks.
5. **Handoff omission.** `files-modified.md` describes every part of the rewrite except the
   `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` stripping — the single highest-risk element of the diff.
   The commit body covers it thoroughly, so this is a handoff-completeness nit only.
6. **Diagnostic specificity.** When a predicate is unknown *and* a concrete overdue reason already
   holds, `:275` returns the generic "could not be fully evaluated" message and drops the concrete
   reason from `:282`. Still reports (correct per D6); the message is just less useful than it could be.
7. **Per-commit cost.** The self-test adds ~2.0 s and ~17 node + ~40 git subprocesses to every commit in
   the repo for every contributor. Inside the design's stated 3 s budget and partly offset by D14 making
   the existing `check:openspec` ~0.4 s faster — noted for visibility, not as an objection.
