- `scripts/check-no-credential-in-agent-surface.mjs` — restructured around a declared `SURFACES` table
  (`assistant`, `fixture`, new `mcp`); added the `mcp` surface (`helio-mcp/**`, excluding `node_modules/`/`dist/`)
  with a new entropy-gated secret-literal check; added the vacuous-surface failure (a declared surface matching
  zero files now exits non-zero) and the coverage-drift guard (every top-level repo directory must classify as
  covered/partial/acknowledged-unscanned, exported as a pure `classifyTopLevelDirs` function for external
  verification); added the `.test` TLD to the placeholder-domain convention; documented the surface table,
  drift-guard rationale, and `IGNORED_TOP_LEVEL`/`.gitignore` line-number table in the header.
- `scripts/check-no-credential-in-agent-surface.selftest.mjs` — added three new self-test cases per design.md
  Decision 5, in order: (1) a planted credential-shaped literal under `helio-mcp/`, (2) an unacknowledged top-level
  directory (`hel956-selftest-drift-probe/`), (3) `helio-mcp/` renamed aside to force a zero-file surface. Added
  idempotent startup cleanup for all three planted/renamed paths.
- `helio-mcp/e2e/connector-authoring.ts` — reworded the one pre-existing convention violation the widened scan
  found: the throwaway e2e test-user password literal now carries the `not-a-real-password` synthetic marker
  (design.md Decision 4, measured).
- `.gitignore` — added entries for the three new self-test planted/renamed paths so a crashed run can't produce a
  committable artifact.
- `openspec/changes/widen-credential-leak-gate/tasks.md` — all 30 tasks marked complete.

## Cycle 2 (evaluation-1.md change requests)

- `scripts/check-no-credential-in-agent-surface.mjs` — **blocking CR1 fixed**: the `SURFACES` table
  now carries `include`/`checks` per entry (as task 1.2 always claimed but the code didn't do), and
  a single loop (`collectFiles` + `runChecksForSurface`) both builds each surface's file list and
  derives the vacuity/total counts from that same list — the hand-keyed `surfaceCounts` object
  literal that let a phantom/misconfigured surface silently count as `undefined !== 0` is deleted.
  Re-verified: appending a phantom surface with a non-existent root now exits non-zero with the
  `VACUOUS SURFACE` message (probe run and reverted; see below). The 82/13/3/66 OK line and the
  full self-test are unchanged.
- Also addressed the three non-blocking suggestions: `collectFiles` replaces both `walk`/`walkAllFiles`
  with one missing-directory-tolerant walker (closes the `ENOENT` inconsistency); the CLI body moved
  behind an `import.meta.url` entry guard so importing `classifyTopLevelDirs` no longer runs a scan
  or calls `process.exit`; added a permanent self-test case proving the mcp surface's email check
  (newly applied there) is genuinely wired, not just declared.
- `scripts/check-no-credential-in-agent-surface.selftest.mjs` — added the mcp-surface email case
  described above.

### Phantom-surface re-verification (blocking CR1)

Appended `{ id: "phantom", root: join(repoRoot, "hel956-phantom-nonexistent"), include: "allNonBinary", checks: [] }`
to `SURFACES`, ran the gate:

```
check-no-credential-in-agent-surface: FAIL

  - VACUOUS SURFACE: "phantom" (root hel956-phantom-nonexistent) matched zero files. ...
exit=1
```

Reverted; `git diff` on the script is empty relative to the reverted state. Gate and self-test then
re-run clean:

```
check-no-credential-in-agent-surface: OK (82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 0 violations)
check-no-credential-in-agent-surface.selftest: OK
```

## Cycle 3 (skeptic-final-1.md REFUTE)

- `scripts/check-no-credential-in-agent-surface.mjs` — added `KNOWN_CHECKS` and `assertSurfacesValid()`,
  called first thing in `main()`, which throws before any scan runs if `SURFACES` has a duplicate `id`,
  an entry with an unrecognized `checks` name, or an entry with an empty `checks` array (CR1/CR2). Also
  replaced the `surfaceFiles` `Map` keyed by `surface.id` with positionally-paired `{ surface, files }`
  records everywhere (`main()`), so a duplicate id can no longer silently drop a surface's file list even
  independent of the new assertion (CR2, structural fix). Fixed the entry guard to compare
  `pathToFileURL(realpathSync(process.argv[1])).href` instead of a raw `file://${process.argv[1]}` string,
  so a symlinked invocation or a path containing a percent-encoded character no longer silently skips
  `main()` (evaluator's non-blocking note). Updated the header comment's "no second hand-keyed place"
  claim, which was not quite true while the `Map` was keyed by `id`.
- `scripts/check-no-credential-in-agent-surface.selftest.mjs` — added `runMutatedScript`, a harness that
  writes a mutated COPY of the real script (one exact string replacement, asserted to match exactly once)
  under `scripts/.hel956-selftest-mutated-surfaces.mjs` and runs that copy as a subprocess — the real
  script has no injection hook for this (deliberately, per design.md Decision 5), so this is the only way
  to exercise `assertSurfacesValid` through the real subprocess harness. Added three red cases (unknown
  check name, empty checks, duplicate id) plus a no-op-mutation green control proving the harness itself
  isn't the reason the red cases pass.
- `.gitignore` — added the mutated-copy scratch path.

### Sibling reproductions (skeptic's exact probes), before and after the fix

**Sibling A — typo'd check name (`"secretLiteral"` -> `"secretLiterals"`), planted `helio_pat_` + 64 hex
under `helio-mcp/`:**

- Before: `check-no-credential-in-agent-surface: OK (83 files scanned: 13 assistant-surface, 3 fixture,
  67 mcp, 0 violations)`, exit 0 — planted credential undetected.
- After: `Error: SURFACES: surface "mcp" declares unrecognized check "secretLiterals" — known checks are:
  importGraph, credentialProp, bcrypt, email, secretLiteral`, exit 1.

**Sibling B — duplicate `id: "fixture"`:**

- Before: `check-no-credential-in-agent-surface: OK (85 files scanned: 13 assistant-surface, 3 fixture,
  3 fixture, 66 mcp, 0 violations)`, exit 0 — the real fixture surface's files silently dropped from one
  of the two entries.
- After: `Error: SURFACES: duplicate id "fixture" — every surface id must be unique`, exit 1.

**Sibling C — empty `checks: []`** (my own additional probe, same class): before, `OK` with the surface
counted and zero checks run; after, `Error: SURFACES: surface "mcp" declares an empty "checks" array`,
exit 1.

All three probes were run against copies, never the shipped script; `git status --short` was clean
before and after each.

Gate and self-test re-run clean after the fix:

```
check-no-credential-in-agent-surface: OK (82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 0 violations)
check-no-credential-in-agent-surface.selftest: OK
```

## Before/after scan counts (acceptance criterion)

Before: `check-no-credential-in-agent-surface: OK (16 files scanned: 13 assistant-surface, 3 fixture, 0 violations)`

After: `check-no-credential-in-agent-surface: OK (82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 0 violations)`
