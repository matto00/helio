## Context

`scripts/check-no-credential-in-agent-surface.mjs` is a pre-commit gate (`.husky/pre-commit` runs both it and its
self-test). HEL-956 made its coverage a declared `SURFACES` table and added three structural guards. Three residual
"silence reads as green" paths remain, recorded in the script header. See proposal.md — Why.

## Goals / Non-Goals

**Goals:**
- Every collected file is either examined or is a loud failure. The printed count means "examined".
- The entry guard cannot produce a silent zero-exit no-op.
- `importGraph` and `credentialProp` are proven live by the self-test, mutation-verified against the shipped file.

**Non-Goals:**
- Widening `credentialProp` past the assistant surface, or replacing the surface table with exclusions (see
  proposal.md — Non-goals; both are HEL-956 judgement calls preserved deliberately).
- Any new allowlist entry, or a full module resolver for the import walk.

## Decisions

**Decision 0 — an unlistable directory is an error too (design-gate CR2).** `collectFiles`'s
`catch { return out }` on `readdirSync` silently drops every file beneath an unlistable directory: the count shrinks,
the surface is usually still non-empty so vacuity does not fire, and the gate prints OK over code it never
collected. That is the same defect class as the two `readFileSync` catches, so it is closed here rather than
deferred: `collectFiles` accumulates listing errors and the caller treats them exactly like read errors. The
existing tolerance for a *missing* surface root stays — that case is deliberately routed to the vacuity check, which
is the loud failure HEL-956 built for it; only a root that exists and cannot be listed is an error.

**Decision 1 — read every surface file once, up front; a read failure is an error.** `runChecksForSurface` today
reads inside the per-check branch and swallows failures. Instead, each surface's collected files are read in one
place; a failure appends an error naming the file and `err.code`/`err.message` rather than `continue`-ing, and the
file is excluded from that surface's counted list. *Alternative rejected:* keeping the read where it is and adding
an error push at each `catch`. Two catch sites means two chances to regress, and it does not fix the count, which
the acceptance criterion explicitly requires ("A file the gate cannot read is never counted as scanned").

**Decision 1a — exactly which list is filtered, and where access errors are reported (design-gate CR3).** A file
that fails to read is removed from `surfaceRecords[].files`, so the printed count and per-surface breakdown mean
"examined". Because the vacuity check reads that same array and `process.exit(1)`s before content violations are
printed, access errors (read *and* listing) are collected into their own array and reported **first**, in the same
early-exit batch as drift and vacuity, ordered access → drift → vacuity. A surface whose every file is unreadable
therefore fails naming those files and their errors, with the vacuous-surface line appearing after them rather than
instead of them — which is what the new spec scenarios require. Access errors are never suppressed by, and never
suppress, a drift or vacuity finding.

**Decision 2 — an unreadable file in the import-graph BFS is also an error.** It gets its own self-test case
(design-gate CR4): the surface-level case cannot stand in for it, because the two catch sites are independent code
paths and a mutation of one leaves the other green — precisely the "a green check that proves nothing" trap. `findBannedImport`'s
`catch { continue }` silently truncates the walk, so "no banned import found" would be unproven. It returns a read
error alongside its finding, surfaced with the same wording. Files that simply do not resolve (a CSS specifier)
remain a non-error `null` — that is best-effort resolution, not a failed read, and is already a documented limit.

**Decision 3 — entry guard: an independent entry test plus a `mainRan` flag.** `main()` sets a module-level
`mainRan = true` on entry. After the existing strict guard, an independent, deliberately weaker test
(`basename(realpathSync(process.argv[1])) === basename(fileURLToPath(import.meta.url))`) determines whether this
module was plausibly the process entry; if it was and `mainRan` is false, the gate prints a diagnostic and exits 1.
The second test must not reuse the first's expression, or a defect in the expression under test would mask itself.
*Alternative rejected:* replacing the strict guard with the weaker one — the weaker one would false-positive on a
same-named importer. It is a fail-closed backstop, never the primary.

**Decision 4 — self-test cases plant real files on the assistant surface and are mutation-verified against the
shipped script.** New cases plant a `.ts` module under `frontend/src/features/assistant/` (one re-exporting a
banned module transitively through a second planted module, one declaring `credential:`), assert non-zero, remove,
assert zero. Each is then mutation-verified via the existing `runMutatedScript` helper, which reads the **shipped**
file and requires the target string to occur exactly once — so a case cannot degrade into testing a copy that has
drifted. Planted values are obviously synthetic and `.hel993-`-prefixed, `finally`-guarded and cleaned idempotently
at startup, matching the HEL-956 convention. The unreadable-file case plants a `helio-mcp` file and `chmod 000`s it;
the entry-guard case runs a mutated copy with the comparison forced false.

**Decision 4a — what "shipped" means here (design-gate non-blocking note).** The red/green assertion arm of every
case runs the shipped script itself. The mutation arm necessarily runs a derived copy, but `runMutatedScript` reads
the shipped source and requires the target string to occur exactly once, so the copy cannot drift from the file it
stands for. Planted probes are dot-prefixed `.hel993-*.ts`; `collectFiles` does not skip dotfiles and
`isSourceFile`/`isTestFile` accept them, so a probe under the assistant root is genuinely collected — verified
before relying on it. Every planted path is registered in `.gitignore` by explicit path, matching HEL-956's
convention there (it lists paths, not a prefix glob), so task 3.2's clean `git status` holds.

**Decision 5 — the clean-tree count stays `82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp`.** No surface,
root or inclusion rule changes; only unreadable files are subtracted, and a clean tree has none.

## Risks / Trade-offs

- `chmod 000` behaves differently for `root` (reads succeed) → the self-test case skips with an explicit printed
  SKIP line when the effective uid is 0, rather than asserting a failure that cannot occur. A silent skip would be
  the very defect this ticket closes, so the skip is printed and reasoned about.
- A `chmod 000` file left behind by a crashed self-test would poison later runs → startup cleanup restores mode
  before removal, idempotently, as HEL-956's cases already do.
- Closing the readdir path (Decision 0) could in principle turn a previously tolerated environment into a failure →
  measured: the clean tree lists every directory under all three roots, and the missing-root case still routes to
  vacuity, so no behavior changes on a healthy checkout.
- Planting under `frontend/src` briefly makes a banned import real → planted files are prefixed, gitignored and
  removed in `finally`; they never enter a commit.

## Gate-Chain Implications Checklist

- **What does it execute?** `node scripts/check-no-credential-in-agent-surface.mjs` and its self-test, both already
  run by `.husky/pre-commit` (lines 17–18). No new command is added to the chain.
- **What environment does it inherit, and from where?** The committing shell's environment via Husky; it reads only
  the repository tree, resolving paths from `import.meta.url`, never from `cwd` or `git`.
- **Does it write anything outside its own sandbox?** The gate writes nothing. The self-test writes only prefixed,
  gitignored probe files inside the repo, removes them in `finally`, and cleans them idempotently at startup; the
  new case additionally restores a file's mode before removing it.
- **Does it behave differently from a linked worktree than from a main checkout?** No — the coverage-drift guard is
  already checkout-stable (existing spec scenario), and nothing here reads uncommitted top-level output.
- **What happens on its first run?** Identical to today on a clean tree: `OK (82 files scanned: 13
  assistant-surface, 3 fixture, 66 mcp, 0 violations)`, exit 0.

## Planner Notes

Self-approved, reversible, stated here and in the PR because the owner is away:
1. The independent entry test is basename-based (Decision 3) — weaker on purpose, backstop only.
1b. The unlistable-directory path (Decision 0) is closed in this change rather than deferred to a follow-up: it is
   the same defect class, in the same function family, and deferring it would leave the ticket's own thesis half
   applied.
2. Unreadable files are subtracted from the count rather than reported separately; the run fails anyway.
3. The root-uid `chmod` case is skipped loudly rather than dropped.
None changes the specs or the task breakdown; each is a one-line reversal if the owner disagrees.
