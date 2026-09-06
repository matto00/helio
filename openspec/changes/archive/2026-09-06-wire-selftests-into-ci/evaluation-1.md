## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: 9fc85f11 on `task/wire-selftests-into-ci/hel-996` (diff vs `main`).

### Phase 1: Spec Review — PASS

Issues: none.

- **AC1** (gate + its self-test CI-wired) — confirmed already delivered on the base branch by HEL-846
  (`627fc281`), `ci.yml` `check:no-credential-leak` / `:selftest`. Correctly out of scope; not re-done, and
  explicitly fenced in proposal.md Non-goals. Not counted against the change.
- **AC2** (root-detected skip is a hard failure in CI, documented with reasoning) — delivered.
  `check-no-credential-in-agent-surface.selftest.mjs:1141-1157` replaces the `OK WITH SKIPS` exit-0 branch with
  a `process.env.CI` guard that writes `FATAL SKIP IN CI (...)` to stderr and `process.exit(1)`; outside CI it
  keeps exit 0 with the skip named. design.md Decisions 1-3 carry the policy and the `process.env.CI`
  detection rationale, including the "false positive is stricter, never laxer" direction argument.
  Decision 2's broadening from `isRoot` to `skippedCases.length > 0` is strictly stronger, in the same
  direction, and was flagged rather than slid in.
- **AC2b** (the new branch is itself covered by a probe, not asserted) — delivered and independently
  mutation-verified by me; see Phase 2.
- **AC4** (`check:openspec:selftest` in CI) — delivered at `.github/workflows/ci.yml:56-65`. Verified by
  parsing `ci.yml` as YAML: the `frontend` job's run list now contains `npm run check:openspec:selftest`.
  Explanatory comment matches the HEL-913/HEL-846 house style and names why CI rather than
  `.husky/pre-commit`.
- **AC5** (survey conclusion recorded) — present in proposal.md "What Changes" bullet 4 and design.md Context.
- **AC3** (mutation → CI red, run URL in PR body) — correctly deferred as a delivery-time action and tracked
  in tasks.md §3.1/3.2, left unchecked. Not failed at cycle 1 per scope note.
- Scope: exactly two source files touched (`ci.yml`, the self-test `.mjs`). `.husky/pre-commit`,
  `package.json` and `tsconfig.json` are untouched — confirmed by `git diff --stat`; the HEL-997 collision
  constraint is respected. No backend/frontend/schema surface.
- design.md carries the required **## Gate-Chain Implications Checklist** with all five answers, and each
  answer is substantive (execution surface, inherited env incl. the two newly-read vars, no new write path,
  worktree-vs-main path resolution via `fileURLToPath`, first-run statelessness). Answers match the shipped
  code: the child env is built as a derived copy (`{ ...process.env, ... }` / `delete env.CI`), never a
  mutation of the parent's `CI`.
- Planning artifacts match the implemented behaviour; files-modified.md is accurate.

### Phase 2: Code Review — PASS

**Gates re-run by me, fresh, in the worktree (no `CLEAN_WORKTREE`), all green:**

| Gate | Result |
|---|---|
| `npm run check:no-credential-leak` | OK (6031 files scanned, 0 violations) |
| `npm run check:no-credential-leak:selftest` | OK (includes the 2 new cases, 5 new assertions) |
| `npm run check:openspec` | `openspec/ is clean` |
| `npm run check:openspec:selftest` | 17 passed, 0 failed |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm run typecheck` | clean |
| `npm run format:check` | all files match Prettier |

No backend spec, no sbt, no dev server, no DB connection was run (HEL-974 constraint respected).

**Independent mutation verification of the two new probe cases** — I did not rely on the executor's
transcript. I copied the self-test to throwaway sibling files under `scripts/` (never editing the tracked
file), mutated each copy, ran it, and deleted the copies; `git status` is clean afterwards. Results:

1. Invert the CI-fatal condition (`if (process.env.CI)` → `if (!process.env.CI)`): **3 red** —
   "forced skip with CI set exits non-zero", "output carries the fatal-skip-in-CI token", and
   "forced skip with CI cleared exits zero". This is the load-bearing mutation and it is caught from both
   directions of the pair.
2. Redact the name from the `SKIP -` line: **1 red** — "output names the synthetic skipped case".
3. Route the fatal message to stdout instead of stderr: **1 red** — "output carries the fatal-skip-in-CI
   token". The stream is genuinely asserted, not incidental.
4. Redact both the `SKIP -` line and the summary's `skippedCases.join`: **2 red** — both naming assertions,
   confirming case 2's "output still names the skipped case" is failable (under mutation 2 alone it survives
   because the non-CI summary line still names the case, which is a legitimate second naming source, not a
   tautology).

All five new assertions are therefore demonstrably failable. The probe is not an unexecuted claim, and it is
not satisfiable by a child that died for an unrelated reason: the CI-set case additionally asserts the
distinctive `FATAL SKIP IN CI` token, and the CI-cleared twin asserts exit 0 on the identical child, so `CI`
is isolated as the only differing input.

**Design/structure review:**

- The forced-skip hook (`HEL996_FORCE_SKIP_SELFTEST`, `:151-166`) is add-only — it calls `skip()` and can
  never clear or suppress a real skip — so its worst-case misuse (being set in CI) is fail-closed. Verified
  by reading, not just by the comment.
- The hook doubling as the recursion guard (`if (!process.env.HEL996_FORCE_SKIP_SELFTEST)` around the probe
  block) is correct: every spawned child runs with the hook set and therefore never re-spawns. Confirmed by
  the run completing in bounded time with exactly two extra child runs.
- Probe placement at the end of the `try` block is correct and is the fix skeptic-design-1 note 1 asked for:
  the child re-plants the same fixed-path fixtures in the same worktree, and an interleaved placement would
  have let the child's `finally` delete a live parent plant. The in-file comment states this reason.
- Keying the terminal branch on `skippedCases` rather than `isRoot` removes a drift risk and makes any future
  skip reason inherit the guard. The now-inaccurate hardcoded "running as euid 0" wording was correctly
  dropped (task 1.3).
- No dead code, no TODO/FIXME, no unused import (`selfPath` is used; `isRoot` still has its four original
  callers). No type-safety or security surface. No over-engineering — one env var, one branch, two cases.
- Behaviour outside CI is preserved: on a non-root machine with `CI` unset the terminal output is still a
  plain `OK`, which my run confirms.

### Phase 3: UI Review — N/A

No UI-affecting file changed. The diff touches only `.github/workflows/ci.yml`, one `scripts/*.mjs`
self-test, and `openspec/changes/wire-selftests-into-ci/**` (a change directory, not `openspec/specs/**`).
There is no frontend, backend route, or schema surface, so no dev server or browser session was started —
consistent with the HEL-974 hard constraint.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `check:openspec` — the hygiene **gate itself** — is still absent from `ci.yml`; only its self-test is now
  wired there. CI therefore proves the guard is capable of failing without ever running it on the PR's own
  `openspec/` tree. That is outside this ticket's ACs (AC4 asked only for the self-test), and the pre-commit
  hook still runs the gate, but it is the same "wired in only one place" shape this ticket exists to close
  and is worth a spinoff ticket.
- The self-test now spawns itself twice, each child re-running the full case list, so wall-clock cost of
  `check:no-credential-leak:selftest` roughly triples. Acceptable today (design.md Risks acknowledges it),
  but if a third probe pair is ever added, consider a `--cases` filter so a child runs only what it needs.
- tasks.md 1.4 says the new explanatory comment follows "the house style of the HEL-913/HEL-846 comments in
  `.github/workflows/ci.yml`" while the comment it describes lands in the `.mjs` — the same harmless wording
  slip skeptic-design-1 note 3 flagged; intent is clear and the shipped comments are fine.
