## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Commits reviewed: `ac30b845` + `05fab563`, as a branch against `main`. No Playwright, no e2e, no dev
servers, no DB, no migration (change touches only `scripts/**` + `.gitignore`; no UI surface). Every
mutation was applied to the SHIPPED script/harness from a byte-identical backup and reverted; the
shipped script was verified `diff`-identical to its backup at the end and `git status --porcelain` was
empty at exit.

### What I verified (with evidence)

**Clean-tree contract (AC5) — CONFIRMED, byte-for-byte.**
`node scripts/check-no-credential-in-agent-surface.mjs` →
`check-no-credential-in-agent-surface: OK (82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 0 violations)`,
exit 0. Re-run three times across the session (before mutations, after the crash-state reproduction,
after full mutation battery) — identical every time.

**Full self-test green, no skips.** `node scripts/check-no-credential-in-agent-surface.selftest.mjs`
→ exit 0, terminal line plain `OK`. `id -u` = 1000, so all four `chmod 000` cases really ran.

**Round-1 CR1 (unrecoverable crashed-harness state) — FIXED, reproduced independently.**
I recreated the exact state round 1 described: `mv helio-mcp helio-mcp-hel956-selftest-moved`,
`mkdir helio-mcp`, planted `helio-mcp/.hel993-only-file.ts`, `chmod 000` it. Confirmed the pre-state
was the dirty one (`git status --porcelain | wc -l` = 66). Then ran the self-test on that state:
- exit 0, terminal `OK`, all cases green — no `ENOTEMPTY`;
- `git status --porcelain | wc -l` = **0**;
- `helio-mcp/` restored with its real contents (`e2e`, `node_modules`, `package.json`);
- `helio-mcp-hel956-selftest-moved/` gone;
- the gate then printed the exact 82-file OK line at exit 0.
The fix is `removeHel993McpStandIn()` (selftest.mjs ~159-176), called from BOTH the startup-cleanup
block and the `finally`, before `restoreMcpRootIfMoved()`. Its removal is gated on
`existsSync(mcpMovedRoot) && existsSync(mcpRoot)` — it only ever deletes at `mcpRoot` when the real
directory is confirmed parked aside, so a real `helio-mcp/` cannot be destroyed; and in my ordinary
(non-crashed) runs `helio-mcp/` was untouched, with all 66 mcp files still scanned afterwards.

**Round-1 CR2 (gitignore gap) — FIXED.** `git check-ignore -q` returns 0 for all nine planted paths:
`helio-mcp/.hel993-unreadable-secret.ts`, `helio-mcp/.hel993-only-file.ts`, the four
`frontend/src/features/assistant/.hel993-*` files, `frontend/src/features/assistant/.hel993-locked-dir/`,
`frontend/src/shared/.hel993-bfs-unreadable.ts`, `/scripts/.hel993-selftest-mutated-entry.mjs`.
`git check-ignore -v helio-mcp/.hel993-only-file.ts` → `.gitignore:67`.

**Round-1 CR3 (tasks 2.7/2.8 ticked without evidence) — FIXED.** Both now carry EVIDENCE blocks stating
the reproduction and the fix, not intent. No unticked tasks remain, and the evidence they state matches
what I independently reproduced above.

**Round-1 non-blocking note (BFS first arm not site-specific) — FIXED, mutation-proven.** The probe moved
to `frontend/src/shared/.hel993-bfs-unreadable.ts` (never collected directly; reached only through the
import-graph walk). Mutating `findBannedImport`'s catch to a bare `continue` (dropping the
`accessErrors.push`) now turns **both** arms red — "unreadable imported module fails the gate" AND
"failure names the unreadable imported module and the import-graph walk". Independence confirmed both
ways: the `readSurfaceFiles`-catch mutation leaves the BFS case green, and the BFS-catch mutation leaves
the `readSurfaceFiles` cases green.

**AC1–AC4 re-verified by mutation of the SHIPPED script (8 mutations, each reverted).** Each mutation
turned red only the case(s) owning the mutated behavior — no case passes vacuously, and every case is
bound to the shipped file, not a copy:

| Mutation (shipped `check-no-credential-in-agent-surface.mjs`) | Self-test |
|---|---|
| `readSurfaceFiles` catch → silent (`void err`) | red ×3 (unreadable-planted-file, its message arm, access-before-vacuity ordering) |
| `collectFiles` catch → silent | red ×2 (unlistable directory + message) |
| `findBannedImport` catch → message-only stub | red ×1 (message arm only — my own weak mutation, still pushes) |
| `findBannedImport` catch → fully silent `continue` | red ×2 (both BFS arms) |
| backstop `entryRealPath && !mainRan` → `false` | red ×2 (forced-false entry exit + `main() never ran` diagnostic) |
| `importGraph` dispatch → `if (false)` | red ×4 (transitive-import arms + BFS arms) |
| `credentialProp` dispatch removed | red ×2 (credential-property arms) |
| access errors dropped from the early-exit condition | red ×6 (all access-error arms) |
| `files: readable` → `files: collected` | red ×1 (access-before-vacuity / count-means-examined arm) |

The one case that must exercise a mutated copy (entry guard) is still bound: disabling the backstop in
the SHIPPED file is what turns it red, and the paired no-op-replacement case pins that "any copy fails"
vacuity is excluded.

**euid-0 SKIP path cannot claim undelivered coverage.** I forced `isRoot = true` in the harness and ran
it: the four `chmod`-dependent cases each printed an explicit `SKIP - <name> (running as root; ...)` line
and the terminal line was
`OK WITH SKIPS (4 case(s) skipped, running as euid 0): unreadable mcp file fails the gate; unlistable directory fails the gate; every-file-unreadable surface names access errors, not bare vacuity; unreadable imported module fails the import-graph walk`.
A plain `OK` is unreachable with any skip. (Harness restored; tree clean.) The `importGraph` and
`credentialProp` cases are not root-gated and still ran under the forced-root simulation.

**No planted probe or credential-shaped value entered the commit.** `git diff main...HEAD -- scripts/ .gitignore`
grepped for `helio_pat_|sk-ant|$2[aby]$|AKIA|PRIVATE KEY|password[:=]|api_key[:=]`: the single hit is
`'export const HEL993_SELFTEST_TOKEN = "helio_pat_' + "b".repeat(64) + '";'` — assembled at runtime,
obviously synthetic. Working tree clean (`git status --porcelain` empty) at every checkpoint.

**HEL-956's two judgement calls intact.** `SURFACES` is still an explicit three-entry table
(`assistant-surface` / `fixture` / `mcp`) with explicit roots — no whole-repo-minus-exclusions. Every
occurrence of `credentialProp` in the shipped script is either the `assistant-surface` table entry, the
`KNOWN_CHECKS` set, the dispatch that reads `surface.checks`, or a comment — it is never applied to
`mcp`. No exclusion widened, no per-value allowlist added.

**Repo hygiene.** `npm run check:openspec` → `openspec/ is clean`. `npx prettier --check` on both scripts
→ clean. `npx eslint` on both → exit 0. `node --check` on the harness → ok.

### Verdict: CONFIRM

### Non-blocking notes

- `check:no-credential-leak:selftest` runs only in Husky pre-commit (`.husky/pre-commit:18`), not in
  `.github/workflows/ci.yml`. That's pre-existing HEL-956 wiring, not a regression, but it means the
  euid-0 `OK WITH SKIPS` degrade is only ever exercised on a developer machine. If the self-test is ever
  added to CI in a root container, consider making `OK WITH SKIPS` non-zero there.
- `removeHel993McpStandIn()` chmods only `mcpRoot`'s top-level entries to `0o644` before `rmSync`. That
  is exactly right for the stand-in (one flat file), but in the contrived state where a stale
  `helio-mcp-hel956-selftest-moved/` coexists with a real `helio-mcp/`, chmodding real subdirectories to
  `644` would make the subsequent `rmSync` throw `EACCES`. That fails loudly and is git-recoverable — it
  does not destroy a real `helio-mcp/` — so no action needed; noting it only so the trade-off is on record.
