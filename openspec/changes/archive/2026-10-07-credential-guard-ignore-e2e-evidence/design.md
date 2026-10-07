## Context

`classifyTopLevelDirs()` in `scripts/check-no-credential-in-agent-surface.mjs` skips dot-directories and the names in
`IGNORED_TOP_LEVEL` (lines ~762-769: node_modules, dist, build, coverage, playwright-report, test-results); anything
else unclassified becomes a `COVERAGE DRIFT` error. The header comment (lines ~117-146) says the set is a hand-kept
duplicate of root-matching `.gitignore` directory patterns and must be updated in the same commit as `.gitignore`.
HEL-1363 added `/e2e-evidence/` (`.gitignore:103`) without doing so. The self-test
(`check-no-credential-in-agent-surface.selftest.mjs`) runs the real gate as a subprocess in the live checkout, so
its "baseline exits 0" assertions also go red in any worktree holding `e2e-evidence/`.

## Goals / Non-Goals

**Goals:** stop the false drift failure; prove it red-then-green; make the next forgotten entry fail mechanically.

**Non-Goals:** runtime `.gitignore` parsing in the gate itself; any change to SURFACES, PARTIAL_COVERAGE or
ACKNOWLEDGED_UNSCANNED; the `security` CI job.

## Decisions

1. **Add `"e2e-evidence"` to `IGNORED_TOP_LEVEL`** and refresh the header table: correct the stale `.gitignore` line
   numbers, add the `e2e-evidence` row, fix the "six names" count, and state that anchored root patterns
   (`/name/`) count as root-matching too. Alternative (move it under `ACKNOWLEDGED_UNSCANNED`) rejected: it is never
   committed, which is exactly what the ignore set is for.
2. **Red/green self-test case for e2e-evidence.** Plant `e2e-evidence/` (with a placeholder file) only if it does not
   already exist, and remove it afterwards only if the self-test created it — a real lane's evidence screenshots
   must never be deleted (use `existsSync` before creating; `finally`-guarded cleanup; startup cleanup only of a
   self-test marker-owned dir, identified by a `.hel1369-selftest-marker` file inside it). Cleanup never removes the
   dir recursively: it deletes only the marker and placeholder files, then `rmdir`s the dir only if it is empty.
   Run this case after the earlier probe cases have removed their dirs, and choose the mutation `find` string so it
   removes only the `"e2e-evidence",` entry; assert the red stderr names `e2e-evidence`. Assert: the real gate
   exits 0 with it present; a mutated copy of the gate (via the existing `runMutatedScript` helper, with
   `"test-results",\n]);` -> without the `e2e-evidence` entry, or equivalent exact-once replacement) exits 1 with
   `COVERAGE DRIFT` naming `e2e-evidence`. The mutated case is the permanent "fails before the fix" evidence.
3. **`.gitignore` consistency check in the self-test.** Export `IGNORED_TOP_LEVEL` (read-only use) from the gate.
   Parse `.gitignore`: skip blanks/comments/negations; take patterns ending in `/` whose remaining path has no `/`
   other than an optional leading one (`name/` or `/name/`), not dot-prefixed, no glob characters. Assert each is in
   `IGNORED_TOP_LEVEL` unless it is in an explicit `SELFTEST_PROBE_DIRS` allowlist (`hel956-selftest-drift-probe`,
   `helio-mcp-hel956-selftest-moved` — these must stay classifiable-as-drift for cases 2/3). Also assert the reverse
   (every `IGNORED_TOP_LEVEL` name appears as such a pattern) so the comment's "duplicate of .gitignore" claim is
   checked. Add a red check: the parser, fed a synthetic `.gitignore` text with an extra `/zz-probe/` line, reports
   `zz-probe` as missing — proving the check is not vacuous.
4. **Audit (AC 3).** Grep `.gitignore` root-level directory patterns on main against `IGNORED_TOP_LEVEL`; the check
   in Decision 3 is the mechanical form. Today only `e2e-evidence` is missing (premise validation); record the
   audit output in the evaluator-visible handoff.

## Risks / Trade-offs

- A self-test that touches the real repo root: mitigated by create-only-if-absent plus marker-owned cleanup.
- The parser handles only the simple shapes this repo uses; a future globbed root pattern would be a false negative,
  documented in a comment.

## Gate-Chain Implications Checklist

- **What does it execute?** `node scripts/check-no-credential-in-agent-surface.mjs` and its `.selftest.mjs`, as
  today; the self-test additionally spawns a mutated copy under `scripts/.hel1369-*` (gitignored) via `node`.
- **What environment does it inherit, and from where?** The pre-commit hook's environment (npm run), unchanged; no
  new env vars, no git invocations added.
- **Does it write anything outside its own sandbox?** Only within the repo root: a transient `e2e-evidence/` (only
  when absent, removed afterwards) and a transient mutated script under `scripts/` (gitignored, removed in `finally`
  and at startup). Nothing outside the checkout.
- **Does it behave differently from a linked worktree than from a main checkout?** That difference is the bug;
  after the fix the verdict is identical whether or not `e2e-evidence/` exists. The planted dir is never created
  over an existing one.
- **What happens on its first run?** Startup cleanup removes only marker-owned leftovers; then all cases run.
  With no prior state, cases create and remove their own fixtures and leave the tree as found.

## Planner Notes

- Self-approved: exporting `IGNORED_TOP_LEVEL` (no behavior change; the module already exports
  `classifyTopLevelDirs` with an entry guard).
- The mutated-script path must be added to `.gitignore` alongside the existing `.hel956-`/`.hel846-` entries — and
  it is a file under `scripts/`, not a root directory, so the consistency check ignores it.
