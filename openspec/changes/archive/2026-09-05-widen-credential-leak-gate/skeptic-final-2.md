## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review. Every claim below is derived from a command I ran in this worktree or a file I
read, not from evaluation-*.md or skeptic-final-1.md. No UI changed (script/tooling only), so
no servers were started and no browser was used (HEL-972 holds it).

### What I verified (with evidence)

**Scan counts / AC6 — 16 -> 82, breakdown 13/3/66.**
- Main checkout (read-only, pre-change script): `check-no-credential-in-agent-surface: OK (16 files scanned: 13 assistant-surface, 3 fixture, 0 violations)` exit 0.
- Worktree: `check-no-credential-in-agent-surface: OK (82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 0 violations)` exit 0.
- `git ls-files helio-mcp | wc -l` = **66** — the mcp count equals the entire tracked helio-mcp
  tree (6 root, 2 e2e, 1 scripts, 13 src, 44 src/tools), i.e. nothing tracked is silently pruned.
  Counts are recorded for the PR body in `files-modified.md:111-113`.

**AC1 (`helio-mcp/**` scanned) / AC4 (proven by measurement).**
`node scripts/check-no-credential-in-agent-surface.selftest.mjs` -> 26/26 `ok`, exit 0,
including plant-red/remove-green pairs for an mcp secret literal and an mcp non-placeholder
email, the drift probe, and the helio-mcp-renamed-aside vacuity case (asserted on the
`VACUOUS SURFACE` string specifically, so it cannot be satisfied by the drift failure alone).

**AC3 (vacuous run is loud) — reproduced independently of the self-test.** Covered by the
rename case above; the vacuity check iterates `surfaceRecords` (the same list the counts come
from), so no surface can be missed by it.

**AC2 (scan-root set documented in the script).** `SURFACES` (lines ~166-181) plus the header
table; `assertSurfacesValid` runs before any filesystem access; `classifyTopLevelDirs` is the
drift guard. Verified the doc matches behavior rather than trusting the comment.

**Every check named in `KNOWN_CHECKS` actually dispatches** (the round-1 CR1 class). All five
names appear at real dispatch sites (`check-no-credential-in-agent-surface.mjs:532,543-546,556,560,563`),
so there is no "known but inert" name. I additionally proved the two checks the self-test does
NOT cover are live, by hand-probe in this worktree (both probes removed afterwards):
- `frontend/src/features/assistant/.hel956probe.tsx` with `credential?: string` -> FAIL,
  `declares a property literally named "credential"`.
- `.hel956probe2.tsx` importing `../connectors/ui/ConnectorCredentialField` -> FAIL,
  `transitively imports banned module ...`.

**The mutated-copy harness cannot pass while the shipped script is broken** (the specific
drift risk raised for this round). I commented out the `assertSurfacesValid();` call in the
SHIPPED script and re-ran the self-test: it went red —
`FAIL - unrecognized check name crashes the mutated copy (status=0)`, plus the empty-checks and
duplicate-id cases, `selftest: FAIL (6 failure(s))`, exit 1. The mutation is derived from
`readFileSync(scriptPath)` at run time with an exactly-once occurrence assertion, so it is a
live derivative of the shipped file, not a snapshot that can drift. The no-op-replacement
control case additionally proves the harness can produce a genuine green. Mutation reverted;
`git status --porcelain` empty.

**Entry guard.** `pathToFileURL(realpathSync(process.argv[1])).href` verified under three
invocations: via a symlink in /tmp (OK, 82 files), via `./scripts/../scripts/...` (OK, 82
files), and imported as a module — the import printed nothing and did not exit, while
`classifyTopLevelDirs` was callable, confirming import-safety.

**Drift-guard stability across checkouts** (spec scenario). Imported `classifyTopLevelDirs` and
classified both the main checkout's and the worktree's top-level dirs: identical result in both,
`{covered:[helio-mcp], partial:[backend,frontend], unscanned:[docs,e2e,infra,notes,openspec,schemas,scripts], unclassified:[]}`.
Also checked the .gitignore additions are ANCHORED (`/hel956-selftest-drift-probe/` etc.), so
they correctly do NOT belong in `IGNORED_TOP_LEVEL` — had they been added there, the drift
self-test case would have gone vacuous.

**AC5 (false-positive policy by convention).** Reserved email domains + the
`SYNTHETIC_SECRET_MARKERS` convention, stated in the script and in the spec delta; the one
in-repo false positive was fixed by convention, not allowlist
(`helio-mcp/e2e/connector-authoring.ts:109`, password value prefixed `not-a-real-`), so
`ALLOWED_CREDENTIAL_PROPS` / bcrypt allowlists gained no new per-value entries.

**Adjacent gates for the changed paths** (no `concertino.config.json` gate's `when` matches a
scripts/helio-mcp/.gitignore/openspec change, so I ran the pre-commit checks that do):
`check:repo-integrity`, `check:helio-mcp-types`, `format:check` ("All matched files use
Prettier code style!"), `check:openspec` ("openspec/ is clean"), `check:spec-structure`
("349 canonical specs, 0 issues") — all exit 0. `tasks.md`: 30 checked, 0 unchecked.

**Third-sibling hunt.** I attacked the remaining "prints OK over code it never examined"
avenues: a typo'd/unknown/empty `checks` (now throws), a duplicate `id` (throws, and the
`{surface, files}` positional pairing removes the mechanism independently), a typo'd `include`
(throws on the first file; a root with no files fails vacuity first), a missing/typo'd `root`
(fails vacuity), and a `KNOWN_CHECKS` name with no dispatch site (none exists). I found no
third reachable sibling. The two residual shapes I did find are recorded as notes below —
neither is reachable through committed code.

### Verdict: CONFIRM

### Non-blocking notes

1. **A file that fails `readFileSync` is counted but never examined.** Measured: I planted a
   real-shaped `helio_pat_` + 64 chars literal at `helio-mcp/.hel956probe.ts`, `chmod 000`, and
   the gate printed `OK (83 files scanned: ... 67 mcp, 0 violations)` exit 0; `chmod 644` and
   the same file FAILs the gate. The `catch { continue }` in `runChecksForSurface` (and in
   `findBannedImport`) silently drops the file while it still contributes to the count. Not
   reachable via the path this gate guards — git only stores 644/755, so a fresh clone or CI
   checkout always has readable files — so this is a hardening follow-up, not a shipping
   defect. A cheap fix: count a read failure as an error rather than a skip. The same shape
   applies to a symlink-to-directory entry inside an `allNonBinary` surface (Dirent doesn't
   follow, so it is pushed as a file, `readFileSync` throws `EISDIR`, and it is counted but
   unscanned); no such symlink exists in the tree today.
2. **The entry guard is fail-open in shape.** If the URL comparison were ever false, the
   process would exit 0 having printed nothing — the same "silence reads as green" class the
   ticket targets. The realpath/`pathToFileURL` form is correct under every invocation I could
   construct (above), so this is a shape observation only; a follow-up could set a flag in
   `main()` and error if the module was the process entry but never ran.
3. **The spec delta slightly overreaches** at `specs/agent-surface-credential-gate/spec.md`
   ("Each behavior this gate enforces SHALL have a corresponding self-test case"): the
   `importGraph` and `credentialProp` checks on the assistant surface have no self-test case
   (they predate this change). I proved both live by hand-probe, so nothing is inert — but the
   requirement's prose is broader than the delivered self-test, and the requirement's own title
   ("New coverage is proven by the self-test") is the accurate scope. Either narrow the sentence
   or add the two cases in a follow-up.

### Worktree state

Every mutation I made (three planted probe files, one commented-out call in the shipped script,
one chmod, one /tmp symlink) was reverted; `git status --porcelain` is empty apart from this
report.
