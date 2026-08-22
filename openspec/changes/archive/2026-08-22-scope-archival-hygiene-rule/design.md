## Context

`scripts/check-openspec-hygiene.mjs` enforces three rules at pre-commit (`npm run check:openspec`,
`.husky/pre-commit:9`). Rule 1 reports any change `openspec list --json` marks `status: "complete"`.

**Measured trigger (probe, this worktree).** A synthetic change at 2/2 yields `status: "complete"` and exit 1;
flipping one box back yields `in-progress` and exit 0. The trigger is exactly `completedTasks === totalTasks`
against the **working tree** — no git, branch, PR or phase input. It fires the instant the last box is checked.
That is wrong here: concertino runs `openspec archive` in Phase 3, *after* the gates pass, in a separate commit
after the executor's implementation commit, so a 100%-complete unarchived change at executor-commit time is the
correct, intended state.

**Why it is not universal.** Changes carrying a task only checked at archive time stay `in-progress` through
Execution and never trip it — e.g. HEL-773's `tasks.md` "7.1 At archive, correct the capability's stale Purpose
wording", which archived with no bypass. That is the whole ~29%-vs-rest difference: task phrasing, not design.

## Goals / Non-Goals

**Goals:** exempt in-flight changes; keep firing where a complete unarchived change actually causes harm; stay
local, offline, fast enough for every commit; prove both directions executably.

**Non-Goals:** merging or modifying `scripts/check-spec-structure.mjs` (HEL-775 kept it separate *specifically*
to avoid compounding this false positive); changing rules 2/3 behavior; touching `typecheck` (HEL-683); network
or Linear/GitHub lookups at pre-commit.

## Decisions

**D1 — Replace "complete" with "overdue": escaped OR stale.** Report a complete, unarchived change only when
either holds:
- **Escaped** — the change directory is reachable from the base branch (`origin/main`, falling back to local
  `main`). Under the concertino flow the archive commit precedes the PR, so a complete unarchived change on the
  mainline means Phase 3 was skipped or aborted.
- **Stale** — the change's last activity is older than `OPENSPEC_HYGIENE_STALE_DAYS` (default 14). Catches the
  abandoned-on-a-branch case that reachability alone cannot see.

Anything else — new on this branch, recently touched — is in-flight and exempt. Both conditions are pure local
git reads, no network.

**D2 — Reject moving the rule into the existing CI workflow (the ticket's own suggestion).** Evidence: no
hygiene script (`check:openspec`, `check:spec-structure`, `check:schemas`) is wired into any workflow today, and
`ci.yml`'s `paths-ignore` includes `"**.md"` on both `push` and `pull_request` — a change directory is entirely
markdown, so a drift-only PR skips CI outright. Scoped to the *existing* workflow: a new dedicated one without
`paths-ignore` could work, but is more machinery and fires later than the mistake.

**D3 — Reject gating on `workflow-state.md`'s `PHASE:`.** Phase 3 squashes (a commit, so pre-commit runs)
*before* `openspec archive`, so exempting `Execution` alone still false-positives on the squash; exempting
`Delivery` too leaves only `Cleanup`, by which point the change is archived and unlisted. The rule would never
fire for any concertino-authored change.

**D4 — Reject "exempt changes touched by the current commit".** A cycle-2+ fix commit may touch only source
files, leaving an already-100% `tasks.md` unstaged — the false positive returns on exactly the "cycle-1+" commits
this ticket is named for.

**D5 — Measure activity by git AUTHOR date, with a filesystem-mtime fallback only for untracked changes.**
`openspec list --json`'s `lastModified` is filesystem mtime for *tracked* files, which a fresh worktree/clone
resets to now — unusable as an age signal. Use `git log -1 --format=%at -- <dir>`. Author date, not committer
date: a measured rebase moved `%ct` to now while `%at` held, so `%ct` would let a long-lived, repeatedly-rebased
branch reset the staleness clock indefinitely and hide a complete change forever. For a change directory with no
commits at all, `git log` is permanently empty, so staleness falls back to the newest filesystem mtime among the
change directory and its entries (`max(dir, entries)`, matching `openspec list`'s own `getLastModified`; a bare
directory mtime does not advance when `tasks.md` is edited in place) —
legitimate here precisely because an untracked change dir exists only in the checkout that created it
(`setup-worktree.sh` copies only env files and `node_modules`, never `openspec/changes/`), making its mtime a
genuine age signal rather than a checkout artifact. This is safe for AC1: an executor's freshly-written change
directory has an mtime of ~now and stays exempt.

**D6 — Degrade toward reporting, and define what "unknown" means.** A predicate that throws, returns unparsable
output, or cannot be evaluated means **condition unknown → report the change**, plus a stderr notice naming what
failed — never a silent `false`. Base ref unresolvable → staleness alone. Git unavailable or target not a git
repo → legacy unconditional reporting, said so on stderr. Fail-open is the one outcome this rule must never have.

**D10 — Pin every git invocation to the target root and anchor its pathspec.** Both predicates silently evaluate
to "exempt" from a subdirectory: measured, `git ls-tree main -- openspec/changes/foo` returns empty with rc 0 from
`./scripts` for a change that *is* on main, and `git log -1 -- <dir>` likewise. So every git call — without
exception — passes `cwd: <targetRoot>` and `ls-tree` uses `--full-tree`. Pathspec `…/foo` does not match
`…/foo-bar` (measured).

**D11 — Add a target-root argument.** `repoRoot` derives from the script's own location, so it cannot be pointed
at a fixture repo — proven: run from a throwaway repo with two 100%-complete changes it printed `openspec/ is
clean`, having evaluated this worktree. Accept `process.argv[2]`, mirroring `check-spec-structure.mjs:44`,
defaulting to today's behavior.

**D12 — Verify via a self-test script wired into pre-commit, NOT a jest test.** Three measured reasons. (a)
`openspec` is a global binary (`/usr/bin/openspec`), absent from `package.json` — root jest currently matches
zero tests and passes on `--passWithNoTests`, so adding the first-ever root test would make CI newly execute it
in an environment with no `openspec`. (b) `jest.config.cjs:16`'s `testPathIgnorePatterns: ["/.claude/worktrees/"]`
is an unanchored substring regex, so nothing under a delivery worktree runs — the executor, evaluator and
skeptic would all verify in the one place the test cannot run; fixing it means editing HEL-768's deliberate
exclusion. (c) `.test.mjs` does not match `testMatch` anyway. Instead: `scripts/check-openspec-hygiene.selftest.mjs`
spawns the real script as a subprocess against fixture git repositories under `os.tmpdir()`, exposed as
`npm run check:openspec:selftest` and wired into `.husky/pre-commit`. This runs identically inside a worktree and
in the main checkout, needs no jest config change, and adds no new environmental requirement (pre-commit already
fails without `openspec`). HEL-775's precedent is *not* a committed self-test — it has none; its archived tasks
7.4/9.3 build temp fixtures once at delivery time and delete them. This change deliberately goes further by
making the proof recurring, which is why D14's cost control is load-bearing rather than incidental.

**D14 — Disable openspec's network telemetry for every invocation; budget the self-test at 3s.** Measured: a
single `openspec list --json` takes 415-1636 ms with telemetry on and 107-111 ms with `OPENSPEC_TELEMETRY=0`,
byte-identical output. The bundled PostHog client (`dist/telemetry/index.js`, `https://edge.openspec.dev`) is the
entire difference, and it means today's pre-commit already makes a third-party network call. So **both** the main
script and the self-test pass `OPENSPEC_TELEMETRY=0` and `DO_NOT_TRACK=1` to every `openspec` child: an 11-case
self-test drops from 9.46-9.94 s to 1.40-1.45 s, removing the network dependency rather than hiding it. Stated
budget, not a judgment call: the self-test must finish in **<= 3s**. If it exceeds that, run the fixture cases
concurrently (measured 0.72 s for 11); only if it still exceeds 3s does the executor stop and escalate — never a
choice between escalating and shipping a per-commit tax.

**D15 — A missing `openspec/changes/archive/` must not crash the script.** Rule 3 `readdirSync`s it
unconditionally (`check-openspec-hygiene.mjs:53`), so a repo without it dies with an uncaught ENOENT **and exit
1** — indistinguishable by exit code from a real report, which is how a crash passes for a pass. Treat it as "no
archived changes": defensive, not a behavior change — rule 3 still reports every handoff file it finds.

**D13 — Emit a per-change exempt diagnostic.** The success path prints `openspec/ is clean` whether it examined
and exempted a complete change or saw none at all — indistinguishable, which is exactly how a check that silently
does nothing passes review. Each exempted complete change prints one line naming it and why (e.g. "absent from
origin/main, last activity 0d ago"); the negative self-tests assert that line, which is what makes them a control
rather than an assertion that nothing happened.

**D9 — Any openspec shell-out asserts on stdout, never `$?`.** `openspec archive` exits 0 even when it aborts
(HEL-775). The existing `openspec list --json` call parses stdout and is correct; this binds the self-test too,
where D15 shows a crash and a real report share exit 1.

## Risks / Trade-offs

- **AC2 is narrowed, deliberately.** "Abandoned" becomes "escaped to the mainline, or inactive for 14 days"
  rather than "complete this instant". With D5's mtime fallback closing the untracked case and `%at` closing the
  rebase case, every state that fires today still fires — **deferred by at most the threshold, never permanently
  hidden.** That claim is load-bearing and is what the self-test's staleness cases exist to prove. It is exact for
  default rebase behavior; `rebase --reset-author-date` and `commit --amend --date=now` do rewrite author dates,
  but those are deliberate acts and this design does not try to defeat them.
- **"Escaped" has never been true in this repo's recent history** (last 30 commits on `main`: zero non-archive
  change directories). AC2's practical coverage therefore rests mainly on staleness — which is why D5's two
  hide-forever vectors had to be closed rather than noted.
- **Threshold is a judgment call.** 14 days exceeds any delivery observed here (same-day) and still surfaces
  drift within a sprint. Env-overridable, which is how the self-test drives it.
- **Pre-commit gets slower, by a budgeted amount.** The self-test builds several small git repos on every commit:
  measured 1.40-1.45 s with D14's telemetry opt-out, against a stated 3s budget and a stated escalation path.
  D14 also makes the *existing* `check:openspec` call faster than it is today, so the net per-commit cost is
  below the raw self-test figure.
- **Local `main` may lag `origin/main`.** Resolution prefers `origin/main`; a lagging local fallback can only
  delay a report, never suppress one.

## Planner Notes

Self-approved: escaped-OR-stale over the ticket's two suggested alternatives (D2/D3 reject them on measured
evidence); the 14-day default; author-date over committer-date (D5); the self-test mechanism over jest (D12).

**Deliberately NOT changed:** `openspec/specs/openspec-spec-hygiene/spec.md`'s rationale sentence citing "that
script's known false-positive". The normative SHALL is unaffected (AC6 forbids touching HEL-775's guard) and the
sentence remains accurate *as history* — HEL-775 did separate for that reason at that time. Rewriting a canonical
spec to re-narrate a merged ticket's motivation is churn with its own `check-spec-structure` risk.
