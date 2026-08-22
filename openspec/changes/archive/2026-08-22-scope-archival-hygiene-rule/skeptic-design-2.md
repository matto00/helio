## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold review of the revised plan for HEL-657 (`proposal.md`, `design.md`, `tasks.md`,
`specs/openspec-archival-hygiene/spec.md`). I read `skeptic-design-1.md` for its seven change
requests but re-derived every conclusion below from my own commands in this worktree and in
throwaway repos under the scratchpad. Where round 1 and I agree, it is because I reproduced the
measurement, not because I accepted the narrative.

**Tooling note (not a blocker).** `scripts/concertino/next-report-number.sh` does not exist on this
branch point (`3596b161`), but it does in the main checkout; I ran the main checkout's copy against
this worktree's change dir — `READY number=2 path=…/skeptic-design-2.md` — so the filename is
script-derived, not guessed.

---

### What I verified (with evidence)

**Plan validity.** `openspec validate scope-archival-hygiene-rule --strict` → `is valid` (rc 0).
`node scripts/check-spec-structure.mjs` → `passed (318 canonical specs, 0 issues)`.
`node scripts/check-openspec-hygiene.mjs` in this worktree → `openspec/ is clean` (rc 0), i.e. the
current 0/30 tasks state is genuinely in-progress and today's rule is quiet.

**AC coverage.** AC1→2.7/2.8/3.3, AC2→2.3/2.4/2.5/2.6, AC3→3.3, AC4→2.x, AC5→1.10/2.10 + the
spec's "Preservation of the other hygiene rules", AC6→1.1/3.7. No AC is uncovered. No `TODO`/`TBD`
in any artifact. `.husky/pre-commit` line 5 is `npm run typecheck` and line 8 is
`npm run check:spec-structure`, exactly as task 1.1 asserts.

**No capability collision, and ADDED is the right delta type.** `openspec/specs/` contains no
`openspec-archival-hygiene`, and a `grep -rln` over `openspec/specs/` for
`check-openspec-hygiene|complete but not archived|archival` matches only
`openspec-spec-hygiene/spec.md` (a rationale mention, not a normative rule). Nothing existing
normatively describes rule 1, so nothing needed a MODIFIED delta.

#### The seven round-1 change requests — all seven verified CLOSED

**1. Test mechanism (D12 / tasks 2.1, 2.2, 2.13) — CLOSED, and the new supporting evidence checks
out.** All three of D12's grounds reproduce: `jest.config.cjs:4`'s `testMatch` plus
`moduleFileExtensions` (line 23, no `mjs`) exclude `.test.mjs`; `testPathIgnorePatterns` line 16 is
the unanchored `"/.claude/worktrees/"`; root `npm test` is `jest --passWithNoTests`. The **new**
claim is also true and is the strongest of the three: `openspec` is `/usr/bin/openspec`, absent
from root `package.json` (deps `react-markdown` only; devDeps carry no openspec), while
`.github/workflows/ci.yml:39` runs `npm test` in the `frontend` job — so the first-ever root jest
test really would newly execute in CI in an environment with no `openspec`. The chosen mechanism
works: I built a fixture repo (`openspec/changes/demo-change/tasks.md` at 2/2 + `changes/archive/`),
ran `openspec list --json` there (returned `status: "complete"`), and ran a copy of the real script
against it (`exit 1`, correct message). A plain node subprocess self-test is jest-free and runs
identically in a worktree. Task 2.13 forces per-case output to be recorded, which closes the
"passes with zero cases" hole.

**2. Target-root override (D11 / task 1.2) — CLOSED.** `scripts/check-spec-structure.mjs`
(line 44, not 45 — see notes) is the stated precedent and does exactly
`process.argv[2] ? join(process.argv[2]) : <default>`. Task 1.2 additionally requires the
`openspec list --json` cwd to derive from it, which is what makes fixtures reachable.

**3. cwd / `--full-tree` / "unknown → report" (D10, D6 / tasks 1.3, 1.4, 1.9) — CLOSED.**
Reproduced in a throwaway repo: from the repo root `git ls-tree main -- openspec/changes/foo` →
1 line; from `./scripts` → **0 lines, rc 0**; from `./scripts` with `--full-tree` → 1 line. Pathspec
`…/foo` does not match `…/foo-bar`. `git log -1 --format=%at -- <untracked dir>` → empty, rc 0.
D10 states the blanket rule and 1.3/1.4 name it per-call; 1.9 now defines the result of a failed
predicate as report-plus-stderr rather than a silent `false`. (One residual asymmetry — CR4.)

**4. The never-committed hide-forever hole (D5 / task 1.5 / spec) — CLOSED, and the Risks claim is
now true.** The mtime fallback is safe for AC1 in both directions I could construct: a directory's
mtime only advances when entries are added or removed, so a freshly written change dir is ~now
(exempt) and an old abandoned one stays old (fires) — the residual error direction is *spurious
firing*, never hiding. D5's safety argument is load-bearing and I verified it independently:
`scripts/concertino/setup-worktree.sh` copies only `${CONCERTINO_ENV_FILES}` (line 280-283) and the
configured module dirs (`cp -al`, line 324) — never `openspec/changes/` — so an untracked change
dir exists only in the checkout that created it and its mtime is genuine there, not a checkout
artifact.

**5. `%at` vs `%ct` (D5 / task 2.6) — CLOSED, reproduced cold.** Fixture: change dir committed on
`feature` with `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` = 2026-01-02, then `git rebase main` after
main moved. Before: `%at %ct` = `1767340800 1767340800`. After: `1767340800 1787359377` (= now).
Author date holds, committer date resets. The switch is correct and 2.6 is a real control.

**6. D6 degradation tested (task 2.9) — CLOSED** for both branches round 1 named (no
`main`/`origin/main` → staleness only; non-git dir → unconditional reporting), and 2.9 requires
asserting the stderr text rather than the exit code. (The third, newly-normative branch is
untested — see notes, non-blocking.)

**7. Anti-vacuity (D13 / task 1.8, 2.11, 2.12) — CLOSED, and this is the strongest part of the
revision.** The per-change exempt diagnostic makes "examined and exempted" distinguishable from
"did nothing", 2.7/2.8 assert it, and 2.11/2.12 are genuine opposite-direction mutants (rule 1
forced unconditional must break 2.7/2.8; overdue forced always-false must break 2.3–2.6). 2.12 is
precisely the ticket's forbidden failure mode.

#### Round-1 non-blocking items

- **D2 wording — now accurate.** I re-ran the grep myself:
  `grep -rnE "check:(openspec|spec-structure|schemas|scala)" .github/` → no matches, and `ci.yml`
  carries `paths-ignore: ["**.md", …]` on both `push` and `pull_request`. D2 now scopes the
  rejection to the *existing* workflow and concedes a dedicated workflow could work. Accurate.
- **`no-tasks` scenario added** to the preservation requirement, and task 1.7 says "leave the
  `no-tasks` branch unchanged". Matches the script (lines 36-40). Good.
- **Declining the `openspec-spec-hygiene` rationale edit — accepted, with one weak leg.** I read
  the sentence (`openspec/specs/openspec-spec-hygiene/spec.md:79-81`). The normative SHALL is
  untouched by this change and the parenthetical is defensible as history; declining is a
  reasonable call and it is now recorded explicitly, which is what round 1 asked for. The second
  leg of the reasoning is not sound, though: a `MODIFIED` delta authored during Execution is applied
  by `openspec archive` automatically and would need no "at archive" task at all, so it would not
  have held `tasks.md` below 100%. The conclusion survives on the first leg alone.
- **`tasks.md` numbering** restructured into `## 1. Implementation` / `## 2. Verification`. The
  section numbers still don't line up with the task prefixes (section 1 holds both 1.x and 2.x;
  section 2 holds 3.x). Cosmetic; `openspec validate` passes.

#### New findings introduced by the revision

**A. Wiring the self-test into `.husky/pre-commit` costs ~10s per commit as specified — 2× the
design's own escalation ceiling — and the cost is a third-party network call, not work.**
Measured, reproduced:

| what | measurement |
| --- | --- |
| 11 sequential fixture builds + script runs (self-test simulation) | **9.94 s**, re-run **9.46 s** |
| same 11 runs with `OPENSPEC_TELEMETRY=0` | **1.40 s**, re-run **1.45 s** |
| single `openspec list --json`, telemetry on | 415 / 631 / 625 / 1353 / 1636 ms |
| single `openspec list --json`, `OPENSPEC_TELEMETRY=0` | 107 / 108 / 108 / 109 / 111 ms |
| 11 runs executed concurrently instead of sequentially | 0.72 s |

The cause is in the tool: `/usr/lib/node_modules/@fission-ai/openspec/dist/telemetry/index.js`
ships a PostHog client (`POSTHOG_HOST = 'https://edge.openspec.dev'`) with opt-outs
`OPENSPEC_TELEMETRY=0`, `DO_NOT_TRACK=1`, `CI=true`. Per-invocation CPU is ~0.17 s against ~0.85 s
wall — the remainder is the flush. I confirmed `OPENSPEC_TELEMETRY=0` produces byte-identical
`openspec list --json` output, so the opt-out is behaviour-preserving.

Two consequences. (i) `design.md` Risks tells the executor to "measure … if it exceeds ~5s, stop and
escalate" — measurement says that branch fires, so the plan as written ends in an escalation rather
than a delivery, and the alternative outcome is worse: an executor who reads 9.5s as "close enough
to ~5s" taxes every commit in the repo permanently. (ii) The design's own Goals line
("stay local, offline, and fast enough for every commit") is violated by the mechanism: the script
today spawns `openspec` once per commit; the self-test makes that ~10 additional spawns, each
reaching for `edge.openspec.dev`. This is a decision the design must make, not defer.

Related: D12's closing sentence — *"It matches HEL-775's precedent of a script that self-tests
against an external fixtures directory"* — is not accurate. There is no
`check-spec-structure.selftest.mjs` and no fixtures directory in `scripts/` (`ls scripts/` →
`agent/`, `check-openspec-hygiene.mjs`, `check-scala-quality.mjs`, `check-schema-drift.mjs`,
`check-spec-structure.mjs`, `concertino/`). HEL-775's actual precedent is the opposite: a
**one-time delivery-time** proof — archived task 7.4 "In a temp dir outside the repo, build five
malformed fixtures…" followed by 9.3 "Delete all probe artifacts and temp fixtures". It added no
recurring per-commit cost. That doesn't disqualify wiring this one in, but it removes the precedent
the design leans on and makes the cost question load-bearing rather than incidental.

**B. Three FIRES cases assert on the exit code alone, which the ticket's own constraint forbids —
and I have a construction where a crash yields the same exit code.** Tasks 2.3 and 2.4 correctly
demand the message text ("Assert on output text, never exit code alone"), but 2.5 says only "Assert
exit 1", 2.6 says only "Assert it still fires", and 2.10 states no assertion at all. That
contradicts D9 and `ticket.md`'s constraint. It is not hypothetical: the script `readdirSync`s
`openspec/changes/archive` unconditionally (line 53), so a fixture built without that directory
crashes:
```
Error: ENOENT: no such file or directory, scandir '…/openspec/changes/archive'
    at …/check-openspec-hygiene.mjs:53:21
EXIT=1
```
An exit-code-only assertion passes on that crash. 2.5 is the case that proves the D5 hole is closed
and 2.6 is the `%at` control — the two tests whose green-ness the whole hide-forever argument rests
on.

**C. The self-test inherits the developer's git config for its fixture commits.** Fixture repos
built with a bare `git init` + `git commit` take identity, signing and `init.defaultBranch` from the
developer's environment. This machine happens to be safe (global `user.email`/`user.name` set,
`commit.gpgsign` unset, `init.defaultBranch=main`), but the helio checkout itself demonstrates the
hazard pattern: it carries a **local** identity override (`git config --local --get user.email` →
`eval@test.local`). A contributor who sets identity per-repo and has none globally, or who has
`commit.gpgsign=true`, would have every fixture commit fail — and because this is wired into
pre-commit, that blocks **every commit in the repo** for them, with a failure that has nothing to do
with the code being committed. Nothing in tasks 2.1–2.13 pins the fixture git environment, and
nothing requires the tmpdir fixtures to be cleaned up (3.6 covers leftovers *under the repo* only).

**No recursion hazard.** I checked: `git config --global --get core.hooksPath` and
`init.templateDir` are both unset, and husky's hook path is repo-local (`core.hooksPath=.husky/_`),
so fixture repos under `os.tmpdir()` have no hooks and cannot re-enter the pre-commit chain.

**No ordering hazard.** Task 2.2 inserts the self-test after `check:openspec` (line 9), leaving
HEL-683's `typecheck` (line 5) and HEL-775's `check:spec-structure` (line 8) untouched; 3.7 pins the
diff to that single added line. `set -e` semantics are unaffected.

**AC1 arithmetic holds.** For the executor's own commit here: `git ls-tree --full-tree origin/main
-- openspec/changes/scope-archival-hygiene-rule` → empty (not escaped); `git log -1 --format=%at`
→ empty on the first commit → mtime fallback → today (not stale) → exempt with a diagnostic. On
cycle 2+ the dir is tracked with today's author date → exempt. `origin/main` and `main` both resolve
inside this worktree (`3596b161`). Task 3.3's live proof will work.

---

### Verdict: REFUTE

All seven round-1 change requests are genuinely closed — the revision is substantive, and the
core discriminator plus D13's exempt diagnostic and D12's jest-free mechanism are the right calls.
I am refuting on issues the **revision itself introduced**, not on anything carried over. Both
blocking items are cheap to fix in the artifacts and expensive to discover mid-execution: one ends
in a forced escalation and a permanent repo-wide tax, the other weakens exactly the two tests that
carry the AC2 argument.

### Change Requests

1. **Decide the self-test's per-commit cost in `design.md` instead of deferring it to a
   measure-and-escalate branch that measurement says will fire.** As specified, the self-test costs
   **9.46–9.94 s** on every commit (two runs, table above), against the design's own "~5s → stop and
   escalate" ceiling, and it does so by making ~10 additional calls to `edge.openspec.dev` per
   commit — contradicting Goals' "stay local, offline". Amend D12 (and the Risks bullet) to name a
   concrete cost-control mechanism and a defined fallback, and add the matching task. Measured
   options, any of which suffices: (a) set `OPENSPEC_TELEMETRY=0` (or `DO_NOT_TRACK=1`) in the env
   the self-test passes to every child it spawns — **1.40–1.45 s** for the same 11 cases, with
   byte-identical `openspec list --json` output, and it removes the network dependency rather than
   just hiding it; (b) run the fixture cases concurrently — 0.72 s for 11; (c) share one fixture
   repo across cases to cut invocations; (d) follow HEL-775's actual precedent and keep the
   self-test a delivery-time proof (task 3.2) rather than a pre-commit gate. Whichever is chosen,
   replace "if it exceeds ~5s, stop and escalate" with a stated budget and a stated action, so the
   executor is never left choosing between escalating and shipping a 10s tax. While editing D12,
   correct its final sentence: HEL-775 has no committed self-test and no fixtures directory — its
   precedent (archived tasks 7.4/9.3) is a one-time temp-dir proof that is deleted afterwards.

2. **Make every FIRES case assert the specific message, not the exit code.** Tasks 2.5 ("Assert
   exit 1"), 2.6 ("Assert it still fires") and 2.10 (no assertion stated) must each name the
   expected output text, matching 2.3/2.4's wording and D9/`ticket.md`'s "assert on stdout, never
   `$?`". Grounds: a fixture missing `openspec/changes/archive/` makes the script die with an
   uncaught `ENOENT` at `check-openspec-hygiene.mjs:53` and **exit 1**, so an exit-code-only
   assertion is green on a crash. 2.5 and 2.6 are the two tests that carry the "no state is
   permanently hidden" claim; 2.10 is AC5's only executable evidence.

3. **Pin the self-test's fixture git environment and require fixture cleanup.** Extend task 2.1 to
   require that fixture repos are created and committed with the developer's environment explicitly
   overridden — `git init -b main` (so the base-ref case does not depend on the developer's
   `init.defaultBranch`) and commits made with `-c user.name=… -c user.email=… -c
   commit.gpgsign=false` — and that fixtures are removed in a `finally`. Grounds: this repo itself
   uses a repo-local identity (`git config --local --get user.email` → `eval@test.local`), so the
   per-repo-identity pattern is live here; a contributor with no global identity, or with
   `commit.gpgsign=true`, would have every fixture commit fail and therefore **every commit in the
   repo blocked** by a gate unrelated to their change. Without cleanup, each commit leaks ~10
   fixture repos into `os.tmpdir()`.

4. **State `cwd: targetRoot` in task 1.5 as 1.3 and 1.4 already do.** D10 states it as a blanket
   rule, but 1.5 is the one predicate whose task text omits it while its siblings spell it out, and
   it is the predicate that guards the hide-forever hole. Measured consequence of the omission:
   from a subdirectory `git log -1 --format=%at -- openspec/changes/foo` returns empty even for a
   committed change, which silently routes an old *tracked* change into the untracked mtime
   fallback — and in a fresh checkout that directory's mtime is checkout time, i.e. "recent", i.e.
   exempt forever. That is the exact hole D5 was rewritten to close, reopening through a one-clause
   omission.

### Non-blocking notes

- **Use the newest mtime in the change directory, not the directory's own.** A directory's mtime
  advances only when entries are added or removed, so editing `tasks.md` in place leaves it stale.
  The error direction is safe (spurious fire, never hiding), but `max(dir, entries)` — which is what
  `openspec list`'s own `getLastModified` does — is both more accurate and no harder.
- **D6's third branch is normative but untested.** The spec's "A condition cannot be evaluated →
  report + stderr notice" has no task. It is the branch most likely to be silently implemented as
  `false`. A cheap construction: point a fixture's `refs/remotes/origin/main` at a SHA whose object
  is absent, so base-ref resolution succeeds and `ls-tree` then fails.
- **Residual `%at` reset vector.** `git rebase --ignore-date` / `--reset-author-date` and
  `commit --amend --date=now` do rewrite author dates. These are deliberate acts and I would not
  design around them, but "never permanently hidden" is strictly true only for default rebase
  behaviour; a half-sentence in Risks would make the claim exact.
- **The script's own header comment goes stale.** `check-openspec-hygiene.mjs:3` still says
  "Active changes that are complete or have no tasks (should be archived)". Worth folding into task
  1.7, along with a line documenting `OPENSPEC_HYGIENE_STALE_DAYS`.
- **Citation off by one.** D11 and task 1.2 cite `scripts/check-spec-structure.mjs:45`; the
  `process.argv[2]` line is 44 in this worktree.
- **`tasks.md` section numbers still don't match task prefixes** (section 1 holds 1.x and 2.x).
  Cosmetic; validation passes.
