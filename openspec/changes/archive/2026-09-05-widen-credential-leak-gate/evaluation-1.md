## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `3a370987`. All gate runs below are my own fresh runs in the worktree,
not the executor's reported results.

### Phase 1: Spec Review — FAIL

Ticket ACs, checked individually:

- AC1 (`check:no-credential-leak` scans `helio-mcp/**`) — **PASS**. Measured: 66 mcp files in the
  count, and an ad-hoc planted `helio-mcp/.probe-email.ts` with `qa@evilcorp.com` was reported at
  `helio-mcp/.probe-email.ts:1` (so the surface's email/bcrypt checks are live, not just the new
  secret-literal one).
- AC2 (scan-root set documented in the script, matching its stated purpose) — **PASS in prose,
  partially FAIL in mechanism**; see Change Request 1. The header surface table is accurate and
  the `IGNORED_TOP_LEVEL` `.gitignore` line-number table is byte-accurate against the post-change
  `.gitignore` (lines 6/8/10/11/17/18/19 verified: `node_modules/`, `dist/`, `build/`,
  `backend/target/`, `coverage/`, `playwright-report/`, `test-results/`). The `target`/`out`
  exclusion rationale checks out.
- AC3 (vacuous run distinguishable from a clean run) — **FAIL for a table-declared surface**. See
  Change Request 1. It holds for the three surfaces that are hand-wired into the scan loops.
- AC4 (proven by measurement in the self-test) — **PASS**, and independently mutation-verified
  (Phase 2).
- AC5 (false-positive policy decided and stated, convention over allowlist) — **PASS**. `.test` TLD
  added structurally; synthetic-marker convention is the sole exemption path; no new per-value
  allowlist entries (`ALLOWED_BCRYPT_HASHES` unchanged, `ALLOWED_CREDENTIAL_PROPS` still empty).
  The one pre-existing violation was fixed in the file, not allowlisted.
- AC6 (before/after counts reported) — **PASS**. `files-modified.md` quotes both OK lines verbatim;
  the "after" line matches my run byte-for-byte.

Other Phase 1 checks:

- Task items: all 30 marked `[x]`; I spot-verified 1.2, 2.4, 2.6, 3.2a, 3.4a, 4.2a, 4.2b, 5.5
  against the code and by measurement. Task 1.2's "each entry declares … an include/exclude rule,
  and the list of checks that apply" is the one item marked done that is not actually true of the
  shipped `SURFACES` table (Change Request 1).
- Scope: clean. The only non-tooling file touched is `helio-mcp/e2e/connector-authoring.ts:111`,
  which design.md Decision 4 predicted by measurement. The reword is safe: the literal is consumed
  only by that file's own `POST /api/auth/register`, `RequestValidation.scala:8` enforces a
  *minimum* of 8 characters with no maximum, the value is 50 characters (well under bcrypt's 72-byte
  truncation), and it is not re-used for a later login in that script (grep: `password` appears on
  line 111 only). Not run, per constraint.
- No regressions: the `fixture` and `assistant` surfaces report 3 and 13 — identical to the
  documented `16 files scanned: 13 assistant-surface, 3 fixture` baseline, so HEL-927's and
  HEL-829's coverage is preserved exactly.
- No API/schema/migration changes, correctly.

### Phase 2: Code Review — FAIL

**Gate runs (mine, this worktree):**

- `npm run check:no-credential-leak` → exit 0,
  `OK (82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 0 violations)`. Confirms the
  claimed 16 → 82 and the 13/3/66 breakdown.
- `npm run check:no-credential-leak:selftest` → exit 0, all 21 assertions ok.
- `git status --short` after the self-test run → **clean, no output**. No planted artifact
  (`helio-mcp/.hel956-selftest-secret.ts`, `hel956-selftest-drift-probe/`,
  `helio-mcp-hel956-selftest-moved/`) survived, and `helio-mcp/` was restored.
- `npm run lint` → clean (`--max-warnings=0`). `npm run format:check` → clean.
  `npm run typecheck` → clean. `npx tsc --noEmit` in `helio-mcp/` → clean (covers the one edited
  source file).
- `npm test` / `sbt test` not run: no file under `frontend/**` or `backend/**` is in the diff
  (`git diff --name-only main...HEAD` = `.gitignore`, `helio-mcp/e2e/connector-authoring.ts`,
  two `scripts/*.mjs`, and `openspec/**`), so neither trigger matches.

**Falsifiability of the new self-test cases (task 4.5, verified independently by mutation).** Each
mutation was applied to the shipped script, the self-test run, and the script restored from a
pristine copy; `git status --short` and `git diff --stat` are empty at the end.

| Mutation | Result |
| --- | --- |
| Comment out `checkSecretLiterals(file, text)` in the mcp loop (line 597) | mcp-secret case goes **red** (2 assertions) |
| `const vacuousSurfaces = []` (line 608) | vacuity case goes **red** on the message assertion — and *only* that one, confirming task 4.2a's point that the exit-status assertion alone was satisfied by the drift check firing on the moved-aside directory |
| `const driftErrors = []` (line 560) | drift case goes **red** (2 assertions) |
| Entropy floor `{20,}` → `{0,}` in `VENDOR_PREFIX_SECRET_REGEX` (line 213) | main gate goes **red** with 11 findings on exactly the files design.md Decision 4a's table predicted: `config.ts:6,17,28`, `queryParamsOrdering.test.ts:74`, `README.md:45,53,56,68,230`, `sleeper-rebuild.ts:44` |

No new case is vacuously green, and the entropy bound is load-bearing rather than decorative.

**Classifier verification over the main checkout (tasks 2.6 / 5.5), re-run by me** via
`classifyTopLevelDirs(readdirSync("/home/matt/Development/helio", {withFileTypes:true}).filter(isDirectory))`.
Nothing was written to the main checkout. Result: `covered: [helio-mcp]`,
`partial: [backend, frontend]`, `unscanned: [docs, e2e, infra, notes, openspec, schemas, scripts]`,
`unclassified: []`. The main checkout's extra `node_modules/` and `test-results/` were skipped by
`IGNORED_TOP_LEVEL` as designed, and all twelve dot-directories were skipped.

**No real credential in the diff.** Grepping added lines for `helio_pat_`/`sk-ant-` with a
credential-length suffix, `AKIA`, PEM headers, and bcrypt shapes returns nothing. The self-test's
planted token is assembled at runtime as `"helio_pat_" + "a".repeat(64)`; the e2e password carries
the `not-a-real-password` marker.

**Code quality.** Readable, well-commented against the design decisions, no dead code, no TODO/FIXME,
no untyped escape hatches (JSDoc types used consistently), errors handled at every filesystem
boundary (`walkAllFiles`'s tolerant `readdirSync`, per-file `readFileSync` try/catch). One
substantive finding follows.

### Phase 3: UI Review — N/A

No trigger path in the diff (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**` —
the change's spec delta lives under `openspec/changes/`, not `openspec/specs/`). Tooling-only change;
no dev or backend server started, per the orchestrator's instruction.

### Overall: FAIL

### Change Requests

1. **`scripts/check-no-credential-in-agent-surface.mjs:130-134` and `:602-608` — the `SURFACES`
   table is not actually the coverage source of truth it is documented as, and a surface declared in
   it is silently scanned-zero while the gate prints OK.** Each entry is only `{ id, root }`; the
   include rule and the check selection live in the imperative body (lines 562-598), and the file
   counts are re-declared in a parallel object literal keyed by hand-written id strings
   (`surfaceCounts`, line 602). Two consequences:
   - The shipped table contradicts what this change's own spec delta requires — *"Each surface SHALL
     declare an identifier, a root directory relative to the repository root, the file-inclusion rule
     for that root, and the set of checks that apply to it"* — and what design.md Decision 1
     (`{ id, root, include, checks }`) and tasks 1.2/3.1 say was built. Task 1.2 is marked `[x]` for
     something the code does not do.
   - **Measured, not theoretical:** I appended `{ id: "phantom", root: join(repoRoot, "docs") }` to
     `SURFACES` and re-ran the gate. It printed
     `OK (82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 0 violations)` and exited 0. The
     phantom surface scanned nothing, contributed nothing, produced **no** vacuity error
     (`surfaceCounts["phantom"]` is `undefined`, and `undefined === 0` is false at line 608), and
     simultaneously counted as `covered` in the drift guard — so it would *suppress* the drift guard
     for `docs` too. That is precisely the failure class this ticket exists to eliminate: a surface
     the gate claims to cover, reported green over zero files. (Mutation reverted; tree clean.)

   Fix: drive both the file collection and the check selection from the table. Concretely, give each
   entry its `include` (e.g. `"sourceNonTest"` vs `"allNonBinary"`) and its `checks` array, build a
   `files` list per entry in one loop over `SURFACES`, dispatch the checks from that entry, and
   derive the counts and the OK line from the same loop — deleting the hand-keyed `surfaceCounts`
   literal. A minimum acceptable alternative, if the full restructure is judged out of budget, is to
   make an id present in `SURFACES` but absent from the counts a hard failure of its own (not merely
   `=== 0`), so the hole cannot be reached silently; but the table-driven version is what the spec
   delta and design.md already promise, and it removes the duplication rather than guarding it.

   Re-verification for this request: repeat the phantom-surface probe above and confirm the gate
   exits non-zero, and confirm the self-test and the 82/13/3/66 OK line are unchanged.

### Non-blocking Suggestions

- `scripts/check-no-credential-in-agent-surface.mjs:505` — the module now has an `export`, but the
  scan still runs as a top-level side effect at import time. Importing `classifyTopLevelDirs` (as
  tasks 2.6/5.5's verification does, and as I did) executes a full scan, prints the OK line, and can
  `process.exit(1)`. Harmless today; if the exported surface grows, consider moving the CLI body
  behind an `import.meta.url === process.argv[1]`-style entry guard.
- `walk()` (line 261) has no missing-directory tolerance, unlike `walkAllFiles()` (line 281). If
  `frontend/src/features/assistant` were ever removed, the gate would throw an unhandled `ENOENT`
  rather than emit the `VACUOUS SURFACE` message the ticket asks for. Not currently reachable, and
  not covered by a self-test case (the design deliberately declined to relocate that directory), but
  the two walkers' error behavior is inconsistent.
- The self-test covers the mcp surface's *secret-literal* check only. The bcrypt and email checks
  are newly applied to that surface and have no mcp-specific case. I verified the email one by hand
  (planted `helio-mcp/.probe-email.ts`, gate reported it, removed); a permanent case would be cheap.
