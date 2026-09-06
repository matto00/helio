## Evaluation Report — Cycle 2 (evaluation-2.md)

Scope: ONLY the delivery-time amendment — commit `809c7af2` (`git diff HEAD~1..HEAD`) plus the
plan revision in `53adc7d8`. Cycle 1's AC2 work was not re-litigated. No backend server, no sbt,
no DB connection was opened (HEL-974 holds the shared dev Postgres). No `package.json`,
`tsconfig.json`, or `.husky/pre-commit` edit exists in this diff (verified via the file list).

### Phase 1: Spec Review — PASS

Issues: none blocking.

- Tasks 4.0–4.5, 4.7 are checked and each matches what actually landed. 3.1/3.2 and 4.6 remain
  unchecked as delivery-time-only (real CI run) — correct, and not counted against this cycle.
- **Task 4.0 verified independently.** The un-archive reset is committed, not merely staged:
  `git diff main...HEAD --stat -- openspec/specs/` → **empty** (no canonical spec touched by this
  change), and `git grep -n "self-test is enforced in continuous integration" HEAD -- openspec/specs/`
  → **no hits, exit 1**. The change dir is out of `openspec/changes/archive/`. The literal
  two-dot `git diff main -- openspec/specs/` in the task text does report 63 deletions, but every
  one belongs to `openspec/specs/pipeline-zero-root-db-guard/spec.md`, added to `main` by HEL-987
  after this branch's merge-base — base drift, exactly the unsatisfiability skeptic-design-3's
  non-blocking note predicted, not a defect in the reset.
- Amendment scope matches the coordinator ruling (install-in-ci, gate wired alongside its
  self-test) and design.md Decision 6 as re-passed at round 3. No scope creep: the diff touches
  only `ci.yml`, `check-openspec-version.mjs`, `tasks.md`, and a new `files-modified.md`.
- `files-modified.md` accurately describes all three code/config surfaces.

### Phase 2: Code Review — PASS

Gates re-run by me, fresh, in the worktree (`CLEAN_WORKTREE` not set):

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm test` | exit 0 — 256 suites / 2654 tests passed |
| `npm run check:openspec` | exit 0 |
| `npm run check:openspec:selftest` | exit 0 |
| `npm run check:no-credential-leak:selftest` | exit 0 |
| `npm run check:openspec-version` (no args) | exit 0 — `check:openspec-version OK — openspec 1.10.0` |

`npm --prefix frontend run build` not run: no `frontend/**` file is in `git diff --name-only
main...HEAD` (changed surfaces are `.github/`, `openspec/`, `scripts/`). No `backend/**` change →
no sbt, consistent with the hard constraint.

**`--print-expected` — verified by running it, both ways.**

- Byte-exact stdout: `od -c` → `1 . 1 0 . 0 \n`. Bare version, exactly one line, no banner, no
  prefix. Exit 0.
- STDOUT-only confirmed: `OUT=$(node scripts/check-openspec-version.mjs --print-expected 2>/dev/null)`
  → `[1.10.0]`. The early-return sits above `readInstalledVersion()`, so no `execFileSync("openspec")`
  runs on this path — the flag works even where the CLI is absent, which is the whole point on a
  bare runner.
- Default no-argument behaviour genuinely unchanged: the flag guard is a pure additive early
  return placed after `EXPECTED` and before the first function declaration; the no-arg run still
  prints its usual `console.error` banner and exits 0.

**`ci.yml` install step — the failable form is proven, not merely read.** I extracted the exact
step body into a probe run under GitHub's default `bash -e -o pipefail` and substituted stub
scripts for the printer:

| Printer stub | Probe outcome |
| --- | --- |
| prints nothing, exit 0 | **exit 1** — `[ -n "$V" ]` aborts before any install |
| exits 3 without printing | **exit 3** — the assignment itself trips `set -e`, status propagates |
| writes a banner to stderr, version to stdout | exit 0, captured `1.10.0` — stderr does not poison `$V` |
| the real script | exit 0, captured `1.10.0` |
| *control:* the rejected inline `@$(...)` form with the empty stub | **exit 0**, expands to `...openspec@` — i.e. would install `latest` and stay green |

The control confirms CR1a's hazard is real and that the shipped assign-then-check form is what
closes it. This is the shipped step verbatim; only the printer was stubbed.

**Step ordering (CR1b) — verified by parsing the YAML, not by eye.** Tail of the `frontend` job:
`check:no-credential-leak:selftest` → **Install openspec CLI** → `npm run check:openspec-version`
→ `npm run check:openspec` → `npm run check:openspec:selftest` → `npm test`. The runtime assertion
sits immediately after the install and before both openspec checks, exactly as task 4.2a requires.
Both the gate and its self-test are wired. The whole block sits after `npm ci` (node available)
and the ordering relative to the other gate families is coherent with the existing file.

Other checks: no duplication (the version is declared once, in `EXPECTED`, and consumed by both
consumers); the comment block extends the existing HEL-996 comment rather than duplicating the
HEL-913/HEL-846 reasoning, and records why these checks were pre-commit-only plus the pointer to
the script header's deferred devDependency fix (task 4.7); no dead code, no TODO/FIXME, no type
escape hatches; the shell is quoted correctly (`"$V"` inside the package spec prevents word
splitting); the installed spec is an exact pinned version, never a range.

Issues: none blocking.

### Phase 3: UI Review — N/A

No UI-affecting file changed. `git diff --name-only main...HEAD` for this amendment covers
`.github/workflows/ci.yml`, `scripts/check-openspec-version.mjs`, and change-dir markdown — no
`frontend/**`, no `ApiRoutes.scala`, no `schemas/**`. The `openspec/specs/**` trigger is not met:
this change touches no canonical spec (three-dot diff empty, per Phase 1). No dev server was
started, per the hard constraint.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `tasks.md` 4.0's first verification command (`git diff main -- openspec/specs/`) is
  unsatisfiable on this branch because `main` moved (HEL-987 added
  `openspec/specs/pipeline-zero-root-db-guard/spec.md` after the merge-base). The reset itself is
  correct; only the recorded command is. Consider the merge-base-scoped form
  `git diff "$(git merge-base HEAD main)" -- openspec/specs/` (or the two-file scoped form) so a
  later reader re-running the task's own check does not read base drift as a failure. Do not
  "fix" it by rebasing content into this change's diff.
- Task 4.6 (real-CI confirmation of the install step and all three openspec-related steps) is the
  only remaining evidence gap and can only close on the runner. The first PR CI run is the
  measurement — if `npm i -g @fission-ai/openspec@1.10.0` needs elevated permissions on
  `ubuntu-latest`'s node setup, that surfaces there and nowhere earlier.
