## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Scope: the three round-2 change requests, plus re-establishing that the code cleared in round 2 is
unchanged. No servers started, no backend spec run, no DB connection opened (HEL-974 constraint
honoured — the only commands run were `git`, `gh`, `grep`, and one Linear read).

### What I verified (with evidence)

**Code is byte-identical to what round 2 cleared.** `git diff --stat 809c7af2 1b8cad30` returns
exactly three files, all delivery artifacts: `evaluation-2.md` (new), `skeptic-final-2.md` (new),
`tasks.md` (+17/-4). Zero changes under `.github/`, `scripts/`, `package.json`, `.husky/`,
`frontend/`, `backend/`, or `openspec/specs/`. I read the full diff, not just the stat. So the AC1–AC5
code findings from round 2 stand without re-derivation, and nothing new entered the diff.

**CR1 — both run URLs recorded in the live PR body.** Fetched with `gh pr view 579 --json body`
(headRefOid `1b8cad301a59c3b0bd800f394ee1406b733e9478`, i.e. the body as it stands on the reviewed
commit). Under "AC3 — mutation proven red in CI, not merely in the local hook" it now carries both,
as real URLs, with no `_pending_` placeholders anywhere in the body:
- failing: `https://github.com/matto00/helio/actions/runs/34017981081`, described accurately as
  failing at `check:no-credential-leak:selftest` while `check:no-credential-leak` itself printed
  `OK (6030 files scanned, 0 violations)` — matching what I read in that run's job log in round 2.
- green after revert: `https://github.com/matto00/helio/actions/runs/34019846261` (`809c7af2`), with
  the four openspec-related steps named. Also matches my round-2 reading.
The body additionally records the discarded `return;` mutation attempt and why it was discarded —
more than the CR asked for, and it is the honest account.

**CR2 — the false bullet is gone and the cycle-2 story is told.** Grepped the fetched body: the
string "still absent from" does not occur; the whole "Follow-up candidate (not in scope): `check:openspec`
… still absent from ci.yml" bullet is deleted. In its place the body has a dedicated section, "Why
the openspec checks differed — the real answer to AC4", which states the `spawnSync openspec ENOENT`
root cause, that these checks were pre-commit-only because they *could not* run on a runner (not an
oversight — explicitly correcting the original design's assertion), the `Install openspec CLI` step
quoted verbatim, the `--print-expected` single-sourcing, why the assignment form rather than inline
`$(…)` is required (the `set -e`-does-not-trip hazard, which the evaluator's probe matrix in
evaluation-2.md independently confirmed expands to `openspec@` and stays green), and
`check:openspec-version` as the runtime PATH assertion. A reviewer reading this body today does
learn that ci.yml gained an install step.

**CR3 — tasks.md 3.1, 3.2, 4.6 ticked with inline evidence.** `grep -n '^- \[ \]' tasks.md` returns
**nothing** — no unchecked task remains in the file. 3.1 carries run 34017981081 plus the discarded-
attempt note; 3.2 carries run 34019846261 and the byte-identical-restore claim; 4.6 names steps 20–23
of that run. Each matches evidence I verified myself in round 2.

**HEL-1000 filed, not duplicated, and referenced.** Read the issue directly (`get_issue HEL-1000`):
"Make openspec a real devDependency instead of a globally-installed CLI", Helio Platform, Backlog,
Medium, created 2026-09-06T07:53Z. Its body is the correct scope (real devDependency + rewiring
Concertino `core/` bare-command invocations + deciding the fate of `check-openspec-version.mjs` +
removing HEL-996's install step once unnecessary), and it explicitly records *why* it is new rather
than a duplicate: CON-130 and CON-154 each considered and declined a real devDependency without
filing an owner, so the script's "tracked separately" claim was unbacked. The PR body's
"Risks / follow-ups" references it by identifier and repeats that provenance. This closes the loop on
the one genuinely false comment this ticket surfaced.

**CI green on the reviewed commit itself, not merely on its parent.** Round 2's green run was on
`809c7af2`. I waited for the run on `1b8cad30` to complete rather than assuming the artifact-only diff
was inert: run `34020592757` (workflow CI, headSha `1b8cad301a59…`) → `completed success`. The
delivery artifacts are themselves subject to `check:openspec` hygiene, so this was worth measuring.

**Working tree clean.** `git status --porcelain` is empty — no uncommitted residue, no stray probe
scripts.

### Verdict: CONFIRM

All three round-2 change requests are addressed against ground truth, the code is provably unchanged
from the version already cleared, the residual follow-up has a real owning ticket, and CI is green on
the exact reviewed commit. This ships.

### Non-blocking notes

- Carried forward from round 2, unchanged and still non-blocking: the two probe cases add ~107s to the
  frontend job; `--print-expected` must stay positioned above `readInstalledVersion()` (an implicit
  ordering constraint, load-bearing for a runner where the CLI is absent); task 4.0's recorded
  `git diff main -- openspec/specs/` command is unsatisfiable due to base drift from HEL-987 and would
  read as a failure to a later re-runner.
- `scripts/check-openspec-version.mjs`'s header still says pinning is "tracked separately" without
  naming a ticket. That claim is now *true* (HEL-1000 exists), so this is no longer a defect — but a
  one-word edit adding the identifier would make it dereferenceable. Natural to fold into HEL-1000
  itself; not worth another cycle here.
