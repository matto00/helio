## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold review of HEL-657's revised plan. I read `skeptic-design-1.md` and `skeptic-design-2.md` for
history only; every conclusion below comes from commands I ran myself in this worktree and in
throwaway repos under the scratchpad. I did not accept any prior report's measurement — where I
agree with round 2, it is because I reproduced it.

**Tooling note (not a blocker).** `scripts/concertino/next-report-number.sh` still does not exist at
this branch point (`3596b161`); I ran the main checkout's copy against this change dir —
`READY number=3 path=…/skeptic-design-3.md` — so the filename is script-derived, not guessed.

---

### What I verified (with evidence)

#### 0. The plan is well-formed

`openspec validate scope-archival-hygiene-rule --strict` → `Change 'scope-archival-hygiene-rule' is
valid` (rc 0). `node scripts/check-spec-structure.mjs` → `spec-structure check passed (318 canonical
specs, 0 issues)` (rc 0). `openspec list --json` → this change at `0/37`, `status: "in-progress"`.
Working tree carries only `?? openspec/changes/scope-archival-hygiene-rule/` — the planner touched no
code, which is correct for a design gate. No `TODO`/`TBD`/`FIXME`/hand-waving in any artifact
(grepped design, tasks, proposal, spec). Every `D<n>` referenced by `tasks.md` (D5, D6, D9–D15)
exists in `design.md`; no dangling references (D7/D8 are numbering gaps, referenced nowhere).

**AC traceability.** AC1→1.9 + 2.10/2.11 + 3.3; AC2→2.6/2.7/2.8/2.9 + mutation control 2.15;
AC3→3.3 + 3.2/3.4; AC4→2.6–2.13 + 2.14/2.15/2.16; AC5→1.14 + 2.13 + the spec's "Preservation of the
other hygiene rules"; AC6→1.1 + 3.7. No AC uncovered; no task outside the ticket's scope except D14
and D15, both of which are justified in-line and needed to make the deliverable verifiable.

#### 1. Round 2's CR1 — telemetry / cost / budget: CLOSED, and the opt-out is better than "safe"

**Is `OPENSPEC_TELEMETRY=0` / `DO_NOT_TRACK=1` safe on the EXISTING `check:openspec` call?** Yes, and
I can do better than "it doesn't change anything" — it removes a latent crash.

Read the vendored source, not the docs: `/usr/lib/node_modules/@fission-ai/openspec/dist/telemetry/index.js`
gates exactly three things on `isTelemetryEnabled()` — `maybeShowTelemetryNotice`, `trackCommand`,
and the PostHog `shutdown` flush. Nothing in list/parse/status logic reads it. Confirmed empirically
in this worktree:

```
cmp on.json off.json  → STDOUT BYTE-IDENTICAL
cmp on.err  off.err   → STDERR BYTE-IDENTICAL
```

The unexpected part: `dist/cli/index.js:57` calls `maybeShowTelemetryNotice()` in a `preAction` hook
before **every** command, and that notice is a `console.log` — i.e. **stdout**, ahead of the JSON.
It fires once per `~/.config/openspec/config.json` (`noticeSeen`). So on any machine where `openspec`
has never run — a fresh clone, a new contributor, a cloud dev container per `docs/cloud-dev-setup.md`
— today's check dies. Reproduced with an isolated HOME (my own `$HOME` untouched):

```
$ HOME=<fresh> node scripts/check-openspec-hygiene.mjs
Failed to run `openspec list --json`: Unexpected token 'N', "Note: Open"... is not valid JSON
EXIT=2

$ HOME=<fresh> OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 node scripts/check-openspec-hygiene.mjs
openspec/ is clean
EXIT=0
```

Task 1.3 applying the opt-out to the pre-existing call is therefore not just behaviour-preserving,
it closes a real first-run failure. (Bonus: with telemetry off, `getOrCreateAnonymousId` never runs,
so the self-test's ~15 child invocations also stop writing to `~/.config/openspec/`.)

**Is the budget a decision rather than a deferral?** Yes, and the numbers hold. Reproduced cold:

| what | my measurement |
| --- | --- |
| `openspec list --json`, telemetry on ×5 | 1701 / 922 / 1432 / 1843 / 408 ms |
| `openspec list --json`, opt-out ×5 | 106 / 108 / 110 / 111 / 110 ms |
| 11 fixture builds + script runs, telemetry on | **13357 ms**, re-run **10749 ms** |
| 11 fixture builds + script runs, opt-out | **1445 / 1440 / 1453 ms** |
| 15 fixture builds + script runs, opt-out | **1971 / 1991 ms** |

D14's stated 1.40–1.45 s matches mine at 11 cases. `tasks.md` actually enumerates ~15 distinct
fixture cases (2.6–2.11, 2.12×3, 2.13×3), which measures ~1.99 s — still inside the stated 3 s
budget, with the concurrency fallback (D14, measured) held in reserve. The escalate branch is now
last, not first. CR1 is closed.

**D12's corrected HEL-775 sentence is accurate.** `ls scripts/` shows no `*.selftest.mjs` and no
fixtures dir; `openspec/changes/archive/2026-08-21-repair-malformed-canonical-specs/tasks.md:133`
is `7.4 **Prove the guard fails red.** In a temp dir outside the repo…` and `:164` is
`9.3 Delete all probe artifacts and temp fixtures…`. One-time, deleted afterwards — exactly as D12
now says.

**D12's three grounds for rejecting jest all reproduce.** `jest.config.cjs:4` `testMatch` is
`**/?(*.)+(spec|test).[tj]s?(x)` and `:23` `moduleFileExtensions` has no `mjs` (so `.test.mjs` never
matches); `:16` is the unanchored `"/.claude/worktrees/"`; and `.github/workflows/ci.yml:39` is a
bare `- run: npm test` in the `frontend` job with **no** `working-directory`, so root jest really
does execute in CI — where `openspec` (`/usr/bin/openspec`, absent from `package.json`) does not
exist.

#### 2. Round 2's CR2 — exit-code-only assertions: CLOSED, three times over

The crash is real and I reproduced it against a fixture with no `archive/`:

```
Error: ENOENT: no such file or directory, scandir '…/openspec/changes/archive'
    at readdirSync (node:fs:1590:26)  at …check-openspec-hygiene.mjs:53:21
EXIT=1
```

`check-openspec-hygiene.mjs:53` is indeed an unguarded `readdirSync(archiveDir)`. The revision closes
this on three independent axes: (a) 2.4 requires the expected **message text** in every case and I
checked all of them — 2.6 "escaped wording naming the base ref", 2.7 "stale wording including the
age", 2.8/2.9 "the stale wording", 2.10/2.11 "the exempt diagnostic", 2.12 "the stderr TEXT", 2.13
"their message text"; no case asserts an exit code alone any more; (b) 2.4 gives every fixture an
`archive/` dir; (c) D15/1.12 removes the crash from the script entirely, with a new spec scenario
("Archive directory absent"). Note the crash aborts before any rule output is printed, so a
message-text assertion cannot be green on it.

#### 3. Round 2's CR3 — fixture git environment and cleanup: CLOSED

Task 2.2 pins `git init -b main` and `-c user.name=… -c user.email=… -c commit.gpgsign=false` on
every commit, with the correct rationale (this repo carries a repo-local identity, so the
per-repo-identity pattern is live). Task 2.3 requires removal in a `finally`; 3.6 extends the
artifact sweep to `os.tmpdir()`. I re-checked the recursion hazard myself:
`git config --global --get core.hooksPath` → rc 1, `init.templateDir` → rc 1, repo `core.hooksPath`
→ `.husky/_`. Fixture repos get no hooks; the self-test cannot re-enter the pre-commit chain.

#### 4. Round 2's CR4 — `cwd: targetRoot` on the stale predicate: CLOSED

Now task 1.6, stating it as REQUIRED with the measured consequence. I reproduced the consequence in
a throwaway repo: from the repo root `git log -1 --format=%at -- openspec/changes/foo` → `1787360210`;
from `./scripts` → **empty**. Same repo, `git ls-tree main -- openspec/changes/foo` → 1 line from
root, **0 lines rc 0** from `./scripts`, 1 line from `./scripts` with `--full-tree`. Pathspec `foo`
matched only `foo`, not `foo-bar`. D10/1.5/1.6 are correct as written.

#### 5. Round 2's five non-blocking notes — all landed

- **`max(dir, entries)`** — in D5 and task 1.7. I verified the premise: editing a nested file in
  place left both the change dir and the intermediate `specs/` dir mtimes unchanged while the file
  advanced. (One inaccuracy in the supporting citation — see notes.)
- **D6's third branch** — now task 2.12, and its stated construction actually works, which I checked
  rather than assumed: with `refs/remotes/origin/main` pointed at an absent object,
  `git rev-parse --verify --quiet origin/main` → rc **0** printing the sha, and
  `git ls-tree --full-tree origin/main -- …` → `fatal: not a tree object`, rc **128**. Resolution
  succeeds, the predicate then fails — exactly the "condition cannot be evaluated" state.
- **`--reset-author-date` residual** — Risks lines 127-129, scoped honestly to deliberate acts.
- **Header comment + env var** — task 1.13; `check-openspec-hygiene.mjs:3` does still read
  "…(should be archived)".
- **Citation** — D11 and task 1.2 now cite `check-spec-structure.mjs:44`, which is the
  `process.argv[2]` line in this worktree.

#### 6. Did this revision introduce a new problem? I prototyped the algorithm to find out

Reading a plan cannot tell you whether its algorithm returns the right answers, so I implemented
tasks 1.2–1.12 as a ~45-line prototype in the scratchpad (repo untouched) and ran it against ten
constructed git states. All ten are correct:

```
2.6  FIRES escaped         → exit 1  "…present on main — run `openspec archive ch`"
2.7  FIRES stale tracked   → exit 1  "…inactive for 231d…"
2.8  FIRES stale untracked → exit 1  "…inactive for 231d…"
2.9  FIRES rebase control  → exit 1  "…inactive for 231d…"   [%at %ct = 1767340800 1787360595]
2.10 EXEMPT in flight      → exit 0  "openspec/changes/ch: complete but in flight (absent from main, last activity 0d ago)"
2.11 EXEMPT fresh untracked→ exit 0  same diagnostic
2.12a no base ref          → exit 0  notice "…deciding on staleness alone"
2.12b non-git dir          → exit 1  notice "…falling back to unconditional reporting" + legacy message
2.12c predicate fails      → exit 1  notice "escaped check failed for ch: …" + report
2.13 no archive dir        → exit 0  no crash
```

The `%at`/`%ct` pair after the rebase (`1767340800` vs `1787360595` = now) is the D5 control
reproducing live. I found no new blocking defect; the four issues round 2 raised are the ones that
were fixed, and the fixes did not introduce a fifth.

#### 7. The two items I was asked to rule on

- **`design.md` line count.** It is **150** lines, not 151 (`wc -l` = 150; `cat -n` ends at 150; the
  file terminates with a newline). The rule it is measured against is `openspec/config.yaml` →
  `rules.design`: *"Maximum 150 lines; wrap prose at 120 chars per line"*. So it is exactly at the
  limit, not over it, and its longest line is 116 chars. Compliant — nothing to fix. (`tasks.md` 49
  lines vs its 80 max; `specs/…/spec.md` has no limit.)
- **`tasks.md` section-vs-prefix mismatch.** Cosmetic, and I checked that nothing consumes the
  numbers: `openspec list --json` counted `totalTasks: 37` = 14 + 16 + 7, i.e. it parses checkboxes
  and is indifferent to prefixes; `openspec validate --strict` passes; all 37 ids are unique so no
  task can be confused for another; the group headings (`### Tooling` / `### Tests` /
  `### Verification`) are self-describing. Does not matter.

#### 8. Is anything left for the executor to decide?

No. Every predicate has a named command with its required flags and cwd; the threshold, its default,
and its invalid-value fallback are stated; all three degradation branches have a stated observable
outcome and a test; the message shapes are constrained by the spec ("identifies the base branch",
"states how long inactive") and asserted by the self-test; the cost control is mandated rather than
measured-then-decided; and the fallback if the budget is missed is named before the escalation is.

**And the deliverable is not a check that silently does nothing.** The rule after this change is a
strict subset of today's trigger, so it adds no new false positives, and the firing direction is
protected by four FIRES cases, the per-change exempt diagnostic (D13/1.10) that makes
"examined and exempted" distinguishable from "did nothing", 2.16's ban on a zero-case pass, and two
opposite-direction mutation controls — 2.15 being precisely the ticket's forbidden mutant (overdue
forced always-false must break all four FIRES cases). AC2's narrowing is bounded and disclosed:
an abandoned change is deferred by at most the threshold, never hidden, with both hide-forever
vectors (fresh-checkout mtime, rebase `%ct`) closed and individually tested.

---

### Verdict: CONFIRM

All four of round 2's change requests are closed against evidence I generated myself, all five of its
non-blocking notes landed, and — unlike the previous two rounds — this revision introduced no new
defect. A prototype of the designed algorithm returns the correct verdict in all ten states the plan
enumerates. The plan is implementable with no open design decisions.

### Non-blocking notes

1. **D5's `getLastModified` citation is not exact** (design.md:60). `openspec`'s
   `dist/core/list.js:11` walks **recursively over files** and uses the directory's own mtime only as
   a fallback when no files exist — it is not `max(dir, entries)`. Including the dir mtime is the
   safer choice and I would keep it; just don't claim it matches openspec. Related: "entries" in task
   1.7 doesn't say whether it recurses. Prefer recursive — the top-level-only reading misses a
   nested `specs/<cap>/spec.md` edit (I confirmed the parent dir mtime does not advance). Error
   direction either way is *spurious fire*, never hiding, so this cannot break AC2.
2. **Fixture 2.8 must backdate the directory AND every entry**, not just `tasks.md` — with `max()`
   semantics a single fresh entry keeps the change looking new and the case would fail. Worth
   spelling out in the task to save an execution cycle.
3. **Precedence when escaped AND stale are both true is unspecified.** Task 2.7's fixture, if built
   on the base branch, satisfies both and may print the escaped wording while the task asserts the
   stale wording. Either build 2.7's fixture on a feature branch absent from base (what I did — it
   works) or have 1.9 emit both reasons. Loud failure, not a silent one, but avoidable.
4. **git's own `fatal:` lines leak to the terminal in the degradation branches.** My prototype
   printed `fatal: not a git repository…` and `fatal: not a tree object` ahead of the script's own
   notice, because `execFileSync` inherits stderr. Harmless but alarming at pre-commit; capturing
   child stderr (`stdio: ["ignore","pipe","pipe"]`) keeps D6's notice the only thing the developer
   sees.
5. **Two spec scenarios have no matching task**: "No fully-checked change present → no exempt
   diagnostic" and "Threshold value is invalid → default". Both are satisfied by construction under
   1.8/1.10; adding them to 2.13 would be two cheap lines.
6. **Watch `env:` in `execFileSync`.** D14 is implemented correctly only as
   `env: { ...process.env, OPENSPEC_TELEMETRY: "0", DO_NOT_TRACK: "1" }`; a bare object drops `PATH`
   and the check degrades to `exit 2`. The self-test catches it immediately, so this is a hint, not
   a risk.
7. **Residual false-positive vector**, for the record: at pre-commit the in-flight commit is not yet
   in `git log`, so a branch whose change dir was last committed more than the threshold ago fires
   even while being actively edited. Requires a 14-day-dormant branch and errs toward reporting;
   D4 already rejected the obvious "exempt if touched by this commit" mitigation for good reason.
8. **Cosmetic:** `proposal.md` is 362 words against `config.yaml`'s advisory "Keep under 300 words"
   (unchanged since round 1; no gate enforces it). `design.md` numbering skips D7/D8 — harmless,
   nothing references them.
9. **Superficial tension between 2.4 and 2.13:** 2.4 says "give **every** fixture an `archive/`
   directory" while 2.13 requires a fixture deliberately without one. The intent is unambiguous in
   context and D15 makes the hazard moot; a three-word carve-out in 2.4 would remove the snag.
