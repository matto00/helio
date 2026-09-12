## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit: `35a7abad731d1220107638fedeed51b08cc8b6e0`
Review base, resolved LIVE via `scripts/concertino/resolve-review-base.sh` (exit status checked):
`BASE_SHA=8fc7face201a696ba4c3011d5a148702b3a3d79d`

### What I verified (with evidence)

**Scope of the diff** — `git diff --stat 8fc7face...HEAD`: 13 files, +786/-0.
Code surface is exactly `.github/workflows/ci.yml` (+15), `package.json` (+2),
`scripts/check-precommit-ci-parity.mjs` (new, 210), `scripts/check-precommit-ci-parity.selftest.mjs`
(new, 186); the rest is the openspec change dir. No unrelated files, no migration, no `frontend/**`.

**AC1 — CI runs all four checks in a job feeding `ci-complete`.** Read the ci.yml hunk directly:
four `- run:` steps (`check:repo-integrity`, `check:scala-quality`, `check:schemas`,
`check:spec-structure`) plus the guard and its self-test, inserted in the `frontend` job after
`check:openspec:selftest` and before `npm test`. Confirmed in the full file that `ci-complete` is
`needs: [frontend, backend, security, e2e]`, so `frontend` already gates it — no new `needs:` entry
required, matching the HEL-913/846/1037/996 precedent the ticket's driver context asked for.
The `check:spec-structure` placement after the `openspec` CLI install/version-pin steps is real and
load-bearing (that script resolves the CLI via `which openspec`).

**AC2 — drift guard, and the three design-gate gaps.** Read `check-precommit-ci-parity.mjs` in full
and confirmed each gap is closed in source, then proved each empirically rather than trusting the
self-test's fixtures:
- *Bare npm-alias parsing:* `NPM_BARE_ALIAS_RE = /npm(?:\s+--prefix\s+\S+)?\s+(test|start)\b(?!\S)/g`,
  deliberately excluding `npm ci`. Against the REAL hook the guard reports 18 hook scripts including
  `test` — the hook's last line is a bare `npm test`, so a `npm run`-only parser would have found 17.
- *Generic package.json-based resolution:* `resolveUnderlyingPaths` reads each name's command string
  from the passed-in `scripts` map and regex-extracts `node <path>`. There is no name→path table
  anywhere in the file (grep of the source confirms).
- *`ci-complete`-needs-scoped CI coverage, not an all-workflows glob:* only `.github/workflows/ci.yml`
  is read; `parseCiCompleteNeeds` extracts that file's own `ci-complete` `needs:` array and
  `extractJobBlocks` limits scanning to those jobs. No `.github/workflows/*.yml` glob exists.

**Anti-vacuity / mutation probes I ran myself** (against copies of the REAL hook + REAL ci.yml +
REAL package.json in a scratch dir, so the worktree was never mutated — the guard takes a `repoRoot`
argument, so this needed no edit to tracked files):
- Baseline on the scratch copy: `OK — every hook script is covered`, 18/18, exit 0.
- MUT1, append `npm run check:brand-new-hook-only` to the hook copy: `FAILED`, exit 1, naming
  `check:brand-new-hook-only`. This is the ticket's literal AC2 scenario.
- MUT2, strip the four newly-added `run:` lines from the real ci.yml text: `FAILED`, exit 1, naming
  exactly `check:repo-integrity, check:scala-quality, check:schemas, check:spec-structure` — proves
  the guard genuinely reads the shipped ci.yml and that today's green is not vacuous.
- MUT3, drop `frontend` from `ci-complete`'s `needs:`: `FAILED`, exit 1, covered set collapses to 0 —
  proves the `ci-complete` scoping is real and not a whole-file scan.

**AC3 — all four run clean on the current tree.** Fresh runs in the worktree, exit codes read:
`check:repo-integrity` exit 0; `check:scala-quality` exit 0 ("clean (164 soft warning(s))" — soft
line-budget advisories on pre-existing backend test files, no hard failures, untouched by this diff);
`check:schemas` exit 0 ("schemas in sync ... 95 checked across 49 protocol files"); `check:spec-structure`
exit 0 ("383 canonical specs, 0 issues"). Nothing flagged, so nothing to fix or file.

**Mutation demo absent from the shipped diff.** `git diff 8fc7face...HEAD -- .husky/` is empty —
`.husky/pre-commit` is byte-identical to base. No `check:does-not-exist-in-ci` line landed. (That
name appears only as a fixture string inside the self-test, which is correct.)

**Gates fresh.** `check:precommit-ci-parity` exit 0 (18/18 covered); `check:precommit-ci-parity:selftest`
exit 0 (5/5 cases, including the bare-alias, indirect-`node <path>`, and out-of-scope-job cases, and it
hard-fails if the case count ever drifts from 5); `lint` exit 0; `format:check` exit 0 ("All matched
files use Prettier code style!"); `check:openspec` exit 0 ("openspec/ is clean");
`check:openspec:selftest` exit 0 (17/17).

**Reverse direction stated.** design.md Non-Goals says explicitly: no guard for CI checks absent from
the hook, "not a bypass hole." The driver context asked for this to be stated; it is.

**UI review:** N/A — no `frontend/**` in the diff, so no servers started and no screenshots taken.
No mtime-ordering or positional evidence was relied on anywhere in this review, and none was accepted
from the evaluator's report; every claim above rests on command output or file content I read myself.

### Verdict: CONFIRM

### Non-blocking notes
- `tasks.md` 4.2 (confirm `ci-complete` green on the PR) is correctly left unchecked — it is not
  verifiable from a local worktree. It does mean the four new steps have never actually executed on a
  runner; the residual risk is environmental (e.g. `check:repo-integrity`'s `git config` shell-out
  under `actions/checkout`), not logical, and the PR's own CI run is the right place to settle it.
- `evaluation-1.md` is present but untracked in the worktree (`git status` shows `??`). Not part of the
  reviewed diff; flagging so the delivery step commits it with the other change-dir artifacts rather
  than dropping it.
- `resolveUnderlyingPaths` does not recurse into nested `npm run <name>` references inside a resolved
  command string (only `node <path>`), so a hook script that is a pure composite of other npm scripts
  would be reported uncovered even if each constituent runs in CI. That direction fails closed (noisy,
  never silent), so it is not a hole — worth a comment if such a script is ever added.
