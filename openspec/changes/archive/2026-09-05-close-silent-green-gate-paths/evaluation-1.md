## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `ac30b845`. All evidence below is from my own fresh runs, not the executor's transcripts.

### Phase 1: Spec Review — PASS

Issues: none.

- All five acceptance criteria addressed and independently re-verified by mutation (see Phase 2).
- No AC reinterpreted. The unlistable-directory path (Decision 0) is an addition beyond the ticket's three
  residuals, but it is the same defect class, declared in proposal.md/design.md and covered by a spec scenario —
  in-scope, not creep.
- All 17 task items marked `[x]` and each matches shipped code (1.1–1.7 → `readSurfaceFiles`, `findBannedImport`,
  `mainRan` backstop, `collectFiles`, access→drift→vacuity ordering, header notes; 2.1–2.8 → seven new self-test
  cases + `.gitignore`; 3.1–3.2 → mutation matrix, gates).
- Diff touches only `scripts/check-no-credential-in-agent-surface{,.selftest}.mjs`, `.gitignore` and the change
  dir. No product code, no migration, no schema. Confirmed by `git diff --stat main...HEAD`.
- No regression to HEL-956 behavior: `SURFACES`, `ALLOWED_CREDENTIAL_PROPS` and the exclusion sets are byte-identical
  (grep over the diff for `allow|exclu|checks:` returns only comment lines).
- `openspec validate close-silent-green-gate-paths --strict` → valid. Spec deltas match implemented behavior.

**HEL-956 judgement calls intact:**
- `credentialProp` stays assistant-only — `SURFACES` still gives `mcp` only `["secretLiteral","bcrypt","email"]`.
- Coverage stays an explicit surface table; no whole-repo-minus-exclusions rewrite, no new allowlist/exclusion entry.

### Phase 2: Code Review — PASS

**Gates (my own runs, in `WORKTREE_PATH`; `CLEAN_WORKTREE` not set):**
- `node scripts/check-no-credential-in-agent-surface.mjs` → `OK (82 files scanned: 13 assistant-surface, 3 fixture,
  66 mcp, 0 violations)`, exit 0. Exactly the required clean-tree line; count unchanged.
- `node scripts/check-no-credential-in-agent-surface.selftest.mjs` → all cases ok, `OK`, exit 0 (euid 1000, so no
  chmod cases were skipped).
- `npm run lint` → clean (`--max-warnings=0`). `npm run format:check` → clean. `npm run typecheck` → clean.
- `npm test` / `sbt test` not run: no file matching `frontend/**` or `backend/**` changed (diff is `scripts/`,
  `.gitignore`, `openspec/changes/**` only).
- `git status --porcelain` empty before and after every run; no planted probe or evidence file is tracked, and
  `git diff --stat` is empty after the mutation matrix (all mutations reverted).

**Mutation matrix — re-run independently against the SHIPPED script** (each mutation applied to
`scripts/check-no-credential-in-agent-surface.mjs` itself, self-test run, script restored):

| # | Mutation (shipped script) | Self-test | Case that went red |
|---|---|---|---|
| M1 | `readSurfaceFiles` access-error push → `void err;` | exit 1 | "unreadable planted file fails the gate (never reported as scanned)", "failure names the unreadable file and 'cannot read file'", "…AND still reports VACUOUS SURFACE, access before vacuity" |
| M2 | `findBannedImport` BFS access-error push → `void err;` | exit 1 | "failure names the unreadable imported module and the import-graph walk" |
| M3 | `collectFiles` `if (!(isRoot && err.code === "ENOENT"))` → `if (false)` | exit 1 | "unlistable directory fails the gate", "failure names the directory and 'cannot list directory'" |
| M4 | ordering `[...accessErrors, ...driftErrors, ...vacuityErrors]` → access last | exit 1 | "failure names the unreadable file AND still reports VACUOUS SURFACE, access before vacuity" |
| M5 | entry-guard backstop `!mainRan &&` → `false &&` | exit 1 | "forced-false entry comparison does not exit 0 silently", "diagnostic states main() never ran" |
| M6 | `if (surface.checks.includes("importGraph")) {` → `if (false) {` | exit 1 | "transitive banned import fails the gate", "failure names the importer file and the banned module and chain" |
| M7 | `credentialProp` dispatch → `if (false) checkTextPatterns(...)` | exit 1 | "planted 'credential' property fails the gate", "failure names the file, line, and 'credential'" |

Every one of the seven closed paths goes red in its **matching** case, and no case is masked by another. No case
tests a drifted copy: the red/green arms invoke the shipped script directly, and the only copy-based case
(entry guard) goes through `runMutatedScript`, which reads the shipped file and hard-errors unless the target
string occurs exactly once — I confirmed M5 (a mutation of the shipped backstop, not of the copy) turns it red.

**No real credential committed.** Planted values are obviously synthetic: `helio_pat_` + `"b".repeat(64)`,
`export interface Hel993Selftest { credential?: string }`, and comment-only stand-ins. All planted paths are
`.hel993-`-prefixed, `finally`-guarded, cleaned idempotently at startup (including `chmodSync` restore before
`rmSync`), and registered in `.gitignore` by explicit path.

Code quality: `CONTRIBUTING.md`-compliant — no inline fully-qualified names, imports at top, comments explain
*why* (each new block cites the design decision it implements). No dead code, no TODO/FIXME, no `any`-equivalent
escape hatch. Errors are surfaced with `err.code ?? err.message` rather than swallowed — the entire point of the
change. `DESIGN.md` not applicable (no `frontend/**` UI change).

### Phase 3: UI Review — N/A

No UI-affecting file changed (diff is `scripts/`, `.gitignore`, `openspec/changes/**`; no `frontend/**`, no
`ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**`). Per the review constraints I did **not** start the dev
servers and did **not** use Playwright or run any e2e spec.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `scripts/check-no-credential-in-agent-surface.selftest.mjs:542` creates `helio-mcp/.hel993-only-file.ts`, which is
  the one planted path **not** listed in `.gitignore` (`git check-ignore` reports it as not ignored). It is
  `finally`-removed and the surrounding case already renames `helio-mcp/` aside, so a crash leaves a far dirtier
  tree regardless — but task 2.7's "every new planted path, by explicit path" is not literally satisfied. One line
  in `.gitignore` would close it.
- In the BFS case, the first assertion ("unreadable imported module fails the gate") still passes under M2, because
  the planted `.hel993-bfs-unreadable.ts` also lives under the assistant root and is therefore caught by
  `readSurfaceFiles` first. Only the second, message-specific assertion is mutation-sensitive to the BFS catch site.
  The case is genuinely mutation-proven, but by one assertion rather than two; planting the unreadable module
  outside a scanned surface root (e.g. under `frontend/src/components/`) would make both arms specific.
