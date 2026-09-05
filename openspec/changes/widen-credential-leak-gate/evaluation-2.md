## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit under review: `f17e9781` on top of `3a370987`. Every result below is my own fresh run or
probe in the worktree; nothing is accepted on the executor's report.

### Phase 1: Spec Review — PASS

Cycle-1's single change request is **resolved, and resolved the way the spec delta requires** —
the executor took the full table-driven fix rather than the minimum guard alternative.

`SURFACES` (`scripts/check-no-credential-in-agent-surface.mjs:149-163`) now carries `include` and
`checks` per entry, matching the spec delta's *"Each surface SHALL declare an identifier, a root
directory …, the file-inclusion rule for that root, and the set of checks that apply to it"* and
design.md Decision 1's `{ id, root, include, checks }`. Task 1.2 is now true of the shipped code.
`collectFiles` (`:290`) is the single file-collection path, `runChecksForSurface` (`:474`) is the
single check-dispatch point (driven off `surface.checks`, never off an `id` string matched
elsewhere), and both the vacuity check (`:659`) and the total/breakdown (`:676`, `:697`) are derived
from the same `surfaceFiles` map. The hand-keyed `surfaceCounts` literal is gone — `grep
surfaceCounts` returns only header prose describing its removal.

All six ticket ACs re-checked and still met; the cycle-1 findings on AC1/AC4/AC5/AC6 are unchanged
by this commit, and AC2/AC3 now hold mechanically rather than only in prose.

Scope discipline held: this commit touches only the two scripts plus the planning artifacts. No
frontend/backend/schema/migration change.

### Phase 2: Code Review — PASS

**Gate runs (mine):**

- `npm run check:no-credential-leak` → exit 0, and the OK line is byte-identical to cycle 1's:
  `check-no-credential-in-agent-surface: OK (82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 0 violations)`.
  The refactor is behavior-preserving on the real tree.
- `npm run check:no-credential-leak:selftest` → exit 0, all assertions ok (now 24, +3 for the new
  mcp bcrypt/email case).
- `git status --short` after the self-test run → **clean, no output**. No planted artifact survived
  and `helio-mcp/` was restored.
- `npm run lint` (`--max-warnings=0`), `npm run format:check`, `npm run typecheck` → all clean.
  `npm test` / `sbt test` still not triggered (no `frontend/**` or `backend/**` file in the diff).

**Phantom-surface probe, all three variants (cycle-1 CR1's re-verification condition).** Each entry
was inserted into `SURFACES`, the gate run, and the script restored from a pristine copy:

| Probe | Result |
| --- | --- |
| `{ id: "phantom", root: <repo>/nope, include: "allNonBinary", checks: ["email"] }` | exit **1**, `VACUOUS SURFACE: "phantom" (root nope) matched zero files` — the silently-green case from cycle 1 is now loud |
| `{ id: "phantom", root: <repo>/docs, … }` (my original cycle-1 probe, now fully declared) | exit **1**, and it **actually scanned `docs/`**, reporting `docs/dependency-management.md:154` on `helioapp.dev`. So a table entry that suppresses the drift guard for a directory now genuinely scans it — the "silently marked covered while scanning nothing" hole is closed at its root, not merely detected |
| `{ id: "phantom", root: <repo>/docs }` (no `include`/`checks` — the exact cycle-1 probe text) | exit **1**, throws `collectFiles: unknown include rule "undefined"`. A malformed entry fails loudly instead of contributing zero |

**Mutation verification (all reverted; `git status --short` and `git diff --stat` empty afterwards):**

| Mutation | Result |
| --- | --- |
| mcp `checks` → `["secretLiteral"]` (drop bcrypt/email) | the **new** mcp email case goes red (2 assertions) — the new self-test case is genuinely falsifiable, not vacuously green |
| mcp `checks` → `["bcrypt", "email"]` (drop secretLiteral) | mcp secret-literal case goes red (2 assertions) |
| `vacuousSurfaces = []` | vacuity case goes red on the message assertion only — still correctly distinguishing vacuity from the drift error that also fires while `helio-mcp/` is renamed aside |
| `driftErrors = []` | drift case goes red (2 assertions) |
| entropy floor `{20,}` → `{0,}` | main gate red with the same 11 findings as cycle 1 |
| assistant `include: "sourceNonTest"` → `"allNonBinary"` | OK line becomes `101 files scanned: 32 assistant-surface, …` — proving the `include` field is load-bearing and the counts are derived from it, not hardcoded |

**Entry guard.** Confirmed it did not change CLI behavior: invoked as Husky does
(`node scripts/check-no-credential-in-agent-surface.mjs` via the npm script) the gate runs and
prints the OK line as before. Confirmed the import side no longer has the side effect I flagged in
cycle 1: importing the module and calling `classifyTopLevelDirs` now prints nothing and cannot
`process.exit`. See the one non-blocking suggestion below for its residual edge.

**Classifier over the main checkout (tasks 2.6/5.5), re-run by me** against
`readdirSync("/home/matt/Development/helio")` filtered to directories; nothing written there.
Unchanged and complete: `covered: [helio-mcp]`, `partial: [backend, frontend]`,
`unscanned: [docs, e2e, infra, notes, openspec, schemas, scripts]`, `unclassified: []`.

**No real credential in the cumulative `main...HEAD` diff.** The only grep hit for
credential-length token shapes / `AKIA` / PEM headers / bcrypt prefixes is a line of my own
`evaluation-1.md` describing the search.

**Quality of the refactor.** Behavior-preserving as claimed (identical OK line, identical
per-surface counts, identical self-test outcomes for the pre-existing cases). The two walkers are
genuinely unified — `collectFiles` is the only walker, and it carries the missing-directory
tolerance that the old `walk()` lacked, so the `assistant` surface would now hit the loud
`VACUOUS SURFACE` path rather than an unhandled `ENOENT`, closing my cycle-1 second suggestion. No
dead code, no duplication reintroduced, comments explain the invariant rather than restating it.

### Phase 3: UI Review — N/A

Tooling-only change; no trigger path in the diff. No dev or backend server started, per the
orchestrator's instruction.

### Overall: PASS

### Non-blocking Suggestions

- `scripts/check-no-credential-in-agent-surface.mjs:685` — the entry guard is
  `import.meta.url === \`file://${process.argv[1]}\``, which is string-comparing a raw path against
  a URL. I measured two inputs where it evaluates `false` and `main()` therefore never runs: a path
  containing a character that `import.meta.url` percent-encodes (a space becomes `%20`), and
  invocation through a symlink (`argv[1]` is the symlink path, `import.meta.url` the realpath).
  Neither is reachable in this repo today — I verified the real CLI invocation runs and prints the
  OK line — and the failure would be a *missing* OK line rather than a false one, which is why this
  is not a change request. But it is a one-line hardening in a script whose whole subject is gates
  that pass without examining anything, so it is worth folding in before merge:
  `import { pathToFileURL } from "node:url"` and compare against
  `pathToFileURL(realpathSync(process.argv[1])).href` (or drop the guard entirely by moving
  `classifyTopLevelDirs` into its own tiny importable module).
- The new permanent mcp case plants an email only; the bcrypt half of that check pair is covered on
  the `fixture` surface but not on `mcp`. Acceptable — `checkFixtureFile` handles both and the
  `checks` mutation above proves the pair is wired — but a second planted line would make it
  symmetric for free.
