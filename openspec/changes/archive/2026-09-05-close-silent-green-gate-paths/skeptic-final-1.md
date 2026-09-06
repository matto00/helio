## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit reviewed: `ac30b845`. No Playwright, no e2e, no dev servers, no DB (change touches only
`scripts/**` + `.gitignore`; no UI surface). Working tree was left clean and re-verified after every
mutation experiment.

### What I verified (with evidence)

**Clean-tree contract (AC5) — CONFIRMED.**
`node scripts/check-no-credential-in-agent-surface.mjs` →
`check-no-credential-in-agent-surface: OK (82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 0 violations)`,
exit 0. Byte-for-byte the required line. Re-run twice more (after mutation runs) with identical output.

**Full self-test — green, no skips.** `node scripts/check-no-credential-in-agent-surface.selftest.mjs`
→ exit 0, terminal line `OK` (not `OK WITH SKIPS`). `id -u` = 1000, so the euid-0 SKIP branch was not
taken and every `chmod 000` case really ran. The SKIP path itself cannot launder coverage: `skip()`
appends to `skippedCases`, and the terminal branch prints `OK WITH SKIPS (... running as euid 0): <names>`
— a plain `OK` is only reachable with zero skips, which is what I observed.

**AC1–AC4 verified by mutation of the SHIPPED script, not by reading.** I applied 8 single-string
mutations to `scripts/check-no-credential-in-agent-surface.mjs` (backup + restore; tree verified clean
after) and ran the full self-test against each. Each mutation turned red only the case(s) that own the
mutated behavior — so no case is passing vacuously, and every case is bound to the shipped file:

| Mutation | Self-test result |
|---|---|
| M1 `readSurfaceFiles` catch → silent skip | red: "unreadable planted file fails the gate", "…names the unreadable file and 'cannot read file'", all-unreadable-surface ordering arm |
| M2 `collectFiles` catch → silent return | red: "unlistable directory fails the gate", "…'cannot list directory'" |
| M3 `findBannedImport` catch → silent continue | red: "…names the unreadable imported module and the import-graph walk" |
| M4 backstop condition `!mainRan` → `false` | red: "forced-false entry comparison does not exit 0 silently", "diagnostic states main() never ran" |
| M5 `importGraph` dispatch disabled | red: transitive-banned-import arms |
| M6 `credentialProp` dispatch disabled | red: credential-property arms |
| M7 report vacuity before access errors | red: the access-before-vacuity ordering arm |
| M8 count `collected` instead of `readable` | red: the all-unreadable-surface arm |

M4 is the important binding check for the one case that must run a mutated copy: `runMutatedScript`
reads the SHIPPED source, requires the target string to occur exactly once (throws otherwise), and the
paired no-op-replacement case asserts the copy is still green — so "any copy fails" vacuity is excluded,
and removing the backstop from the shipped file is what turns the case red.

**Case 1 is not vacuous in the way the AC cares about.** I wrote the exact planted content
(`helio_pat_` + 64×`b`) to `helio-mcp/.hel993-unreadable-secret.ts` *readable* and ran the gate: it
FAILs with 2 real `secretLiteral` violations. So the file the case then `chmod 000`s is a genuine
credential-shaped violation — the case proves a real credential is not swallowed by unreadability,
not merely that some file was unreadable. (Removed immediately; tree clean.)

**Entry-guard backstop is genuinely independent.** It computes basename equality from `entryRealPath`
vs `fileURLToPath(import.meta.url)` rather than reusing the strict comparison, so a defect in the
strict expression cannot mask itself. Confirmed by M4 that this, not some incidental error, is what
produces the non-zero exit; the case also asserts the specific `main() never ran` diagnostic, which no
other failure path emits.

**No credential-shaped or planted value entered the commit.** `git diff main...HEAD` grep for
`helio_pat|sk-|$2[aby]$|bcrypt|password|secret|token`: the only credential-shaped value is
`'…"helio_pat_' + "b".repeat(64) + '"'`, assembled at runtime and obviously synthetic. `git status`
clean apart from the untracked `evaluation-1.md`.

**HEL-956's two judgement calls intact.** `SURFACES` still has exactly three explicit entries
(`assistant-surface` / `fixture` / `mcp`) with explicit roots — no whole-repo-minus-exclusions — and
`credentialProp` appears only in `assistant-surface`'s `checks` (`mcp` = `secretLiteral, bcrypt,
email`). No exclusion widened, no per-value allowlist added; `.gitignore` additions are self-test
artifact paths only.

**Where it fails: the new case 3 breaks the self-test's own crash-recovery invariant.** Reproduced
twice, deterministically. Case 3 (`selftest.mjs` ~537-545) renames `helio-mcp/` aside AND creates a
stand-in `helio-mcp/` containing `.hel993-only-file.ts`. HEL-956's recovery function is
`restoreMcpRootIfMoved()`, guarded by `existsSync(mcpMovedRoot) && !existsSync(mcpRoot)` — which held
for HEL-956 (it left no stand-in) but does NOT hold for this new case. I simulated a crash in that
window (park real `helio-mcp/`, create the stand-in, `chmod 000` its file) and then ran the self-test:

- startup cleanup did **not** recover — `restoreMcpRootIfMoved()` no-ops because `helio-mcp` exists;
- the run then **crashed** at `renameSync` with `ENOTEMPTY` (`path: .../helio-mcp`, `dest: .../helio-mcp-hel956-selftest-moved`), and will do so on every subsequent run until a human intervenes;
- `git status --porcelain | wc -l` = **68**: 66 real `helio-mcp/**` files reported deleted, plus an untracked, **not-gitignored** `helio-mcp/.hel993-only-file.ts` (`git check-ignore` exit 1).

This is exactly the state that this change's own `.gitignore` comment ("a crashed run must not leave a
committable artifact behind"), design.md's Risks entry ("startup cleanup restores mode before removal,
idempotently"), and tasks 2.7/2.8 (both marked `[x]`) promise cannot happen. The evaluator flagged the
missing `.gitignore` line as non-blocking on the reasoning that "a crash leaves a far dirtier tree
regardless" — that reasoning is the defect, not a mitigation: the tree is not merely dirtier, it is
unrecoverable by the harness's own idempotent-startup-cleanup contract. On a change whose thesis is
that an unverified confident green is the defect, a task ticked complete that measurement shows is not
satisfied is the same failure applied to itself.

(Restoration verified: after the simulation I restored `helio-mcp/` by hand; `git status` clean and the
gate again prints the exact 82-file OK line at exit 0.)

### Verdict: REFUTE

### Change Requests

1. `scripts/check-no-credential-in-agent-surface.selftest.mjs` — make case 3's stand-in recoverable.
   Add a dedicated idempotent cleanup (e.g. `removeHel993McpStandIn()`) that, when `mcpMovedRoot`
   exists and `mcpRoot` is the stand-in, chmods and `rmSync(mcpRoot, { recursive: true, force: true })`
   before `restoreMcpRootIfMoved()`, and call it from BOTH the startup cleanup block (~line 184-192)
   and the `finally` (~line 716-723). Verify by mutation of the harness itself: reproduce the state I
   did (park `helio-mcp/`, create the stand-in with a `chmod 000` file), then run the self-test and
   confirm it recovers to a clean tree and green, instead of throwing `ENOTEMPTY`. Guard against
   destroying a real `helio-mcp/` (only remove when `mcpMovedRoot` exists).
2. `.gitignore` — add `helio-mcp/.hel993-only-file.ts` to the HEL-993 block, so task 2.7's "every new
   planted path, by explicit path" is literally true. Verify with `git check-ignore -v` (currently
   exit 1 = not ignored).
3. `openspec/changes/close-silent-green-gate-paths/tasks.md` 2.7/2.8 are ticked but were not satisfied
   on this commit. Re-tick only after CR1/CR2 are verified by the reproduction above, and state the
   evidence rather than the intent.

### Non-blocking notes

- BFS case, first arm: under M3 the assertion "unreadable imported module fails the gate" still passes,
  because `.hel993-bfs-unreadable.ts` lives under the assistant root and is caught by `readSurfaceFiles`
  first; only the message-specific second arm is sensitive to the BFS catch site. The case IS
  mutation-proven, but by one arm. Planting the unreadable module outside a scanned surface root (e.g.
  `frontend/src/components/`) would make both arms site-specific. (Independently reproduced; matches the
  evaluator's own note.)
- No case asserts the printed count line while an unreadable file is present — but that state always
  exits 1 before the OK line is printed, so the count is unobservable there. M8 shows the
  readable-vs-collected distinction is still mutation-detected. No action needed.
