## Context

`scripts/check-no-credential-in-agent-surface.mjs` today hardcodes two roots: `frontend/src/features/assistant`
(import-graph walk + a `credential:` property-name ban) and `FIXTURE_ROOTS = [backend/src/test/resources]`
(bcrypt-hash + non-placeholder-email scan). It prints `16 files scanned`. `helio-mcp/` — MCP client, its e2e
drivers, and a verify script, all of which authenticate to a live backend with a PAT — is matched by neither root.

Measured on the base branch, a naive widening would immediately trip on real code:

- Eight `credential`-property matches under `helio-mcp/` (`restDataSourceSchema.ts:77`, `connectorSchema.ts:78`,
  `helioApi.ts:319,336`, plus tests/e2e comments). Every one is a *rejection* declaration or a hardcoded empty
  literal — the mechanism by which HEL-886/HEL-828 keep credentials off the MCP surface.
- One email match, `helio-mcp/README.md:32`, on `example.com` — already allow-listed.

So the widening cannot be "run every check over one bigger glob"; checks must be selected per surface.

## Goals / Non-Goals

**Goals:**

- `helio-mcp/**` is genuinely scanned, proven by a self-test that plants and removes a synthetic violation.
- The gate's coverage is declared in one place, in the script, and is the thing that is documented.
- A run that examines nothing is loudly distinguishable from a run that examined files and found nothing.
- A directory added to the repo next month cannot silently fall outside coverage.
- False positives are absorbed by conventions a future author can follow without editing the gate.

**Non-Goals:**

- A repo-wide secret scanner (Decision 1).
- Extending the `credential`-property ban beyond the assistant surface (Decision 3).
- Any backend, frontend runtime, schema, or migration change. No Playwright, no e2e specs, no migration.

## Decisions

### Decision 1 — Explicit surface table plus a drift guard, not whole-repo-minus-exclusions

**Chosen:** a `SURFACES` table in the script. Each entry: `{ id, root, include, checks }`. Coverage is exactly the
union of those roots. Separately, a coverage guard classifies every top-level directory in the repo into exactly one
of three states and fails on a fourth, unclassified one.

**Rejected — whole repo minus exclusions.** It reads safer and is not. The ticket's own framing warns against a
scan that silently misses the next new directory, but the mirror failure is worse in practice: a repo-wide
bcrypt/email/token scan over `backend/`, `frontend/`, `e2e/`, `docs/`, `infra/`, and `openspec/` produces a false-
positive volume that gets resolved by broadening exclusions, and every broadening is invisible. The exclusion list
becomes the real coverage boundary and nobody reviews it. It would also collide with HEL-846's stated scope (the
generic delivery-time token scanner) rather than complement it.

**Why the drift guard closes the same hole the rejected option claimed to.** The stated fear is "a scan that
silently misses the next new directory". Under the surface table alone that fear is real. Under the drift guard it
is not: a new top-level directory turns the gate red until an author names it, either by covering it or by writing
down why it does not need covering. The decision becomes visible and reviewable in a diff, which is the property
that actually matters. The guard is deliberately top-level-only — a per-subdirectory version would fire constantly
and be neutered within a week.

#### 1a. Three coverage states, because two cannot describe the repo (skeptic-design-1 CR4)

`frontend/` and `backend/` *contain* a surface root (`frontend/src/features/assistant`,
`backend/src/test/resources`) without being one. Calling them "unscanned" would record a falsehood and would make a
future loss of the assistant surface indistinguishable from a deliberate acknowledgment. The guard therefore
classifies each top-level directory as:

- **`covered`** — a declared surface root is at, inside, **or beneath** it, and the surface covers the whole
  directory (today: `helio-mcp`).
- **`partial`** — a declared surface root is beneath it but the rest of the directory is deliberately not scanned.
  Requires an entry in `PARTIAL_COVERAGE` naming which subtree *is* scanned and why the remainder is not
  (today: `frontend`, `backend`). This is a distinct, greppable state, not an acknowledgment of being unscanned.
- **`unscanned`** — requires an entry in `ACKNOWLEDGED_UNSCANNED` with a one-line reason
  (today: `docs`, `e2e`, `infra`, `notes`, `openspec`, `schemas`, `scripts`).

Anything in none of the three fails the gate.

#### 1b. Which top-level directories the guard enumerates (skeptic-design-1 CR1)

Measured: this worktree's top level is `backend docs e2e frontend helio-mcp infra notes openspec schemas scripts`,
while the **main checkout** additionally carries `node_modules/` and `test-results/`, both gitignored. Populating
the lists from a worktree alone would make the gate red on every developer's main checkout, and `test-results/`
appears and disappears with any Playwright run — exactly the churn that neuters a guard.

The guard therefore skips two categories before classifying: dot-prefixed directories, and a hardcoded
`IGNORED_TOP_LEVEL` set of build/tooling output that is never committed. That set is derived by inspection from
the **unanchored** directory patterns in `.gitignore` — the ones with no leading path segment, which therefore match
at the repository root — and is exactly six names:

| Name | `.gitignore` line |
| --- | --- |
| `node_modules` | 6 (`node_modules/`) |
| `dist` | 8 (`dist/`) |
| `build` | 10 (`build/`) |
| `coverage` | 17 (`coverage/`) |
| `playwright-report` | 18 (`playwright-report/`) |
| `test-results` | 19 (`test-results/`) |

`target` and `out` are deliberately **excluded** from the set (skeptic-design-2 CR1): `.gitignore:11` is
`backend/target/`, which is anchored and does not ignore a root-level `target/`, and `out` does not appear in
`.gitignore` at all. Including them would have made the safety rationale below false, and a root-level `target/` or
`out/` should in fact trip the guard.

The set is hardcoded rather than derived at runtime, because deriving it means parsing `.gitignore` (fragile:
anchoring, negations, globs, nested files — the very distinction that made `target` wrong above) or shelling out to
`git check-ignore`, and the Gate-Chain checklist's "no git invocation" property is worth more here than the small
duplication. That duplication is the accepted trade-off and is stated in the script header, along with the
consequence: a *committed* directory sharing one of these six names would be skipped. Because each of the six is an
unanchored `.gitignore` entry, that cannot happen without someone first force-committing a directory the repo
already ignores — a table the script header reproduces, with line numbers, so the claim stays checkable rather than
asserted.

Verification must run the gate from the **main checkout** as well as from this worktree; green in a worktree alone
does not establish CR1 is resolved.

#### 1c. Top-level files, and dot-directories, are out of scope — stated, not implied (skeptic-design-1 notes)

The guard is directory-only, so top-level files (`.env.example`, `Dockerfile`, `package-lock.json`, `README.md`)
and dot-directories (`.github`, `.husky`, `.claude`, `.concertino`) are not covered by it. Both gaps go in the
script's "known residual limits" header block. Leaving them unstated would reproduce, in the fix, the precise
stated-versus-actual coverage mismatch this ticket exists to eliminate.

### Decision 2 — A declared surface matching zero files is a failure

This is the substantive half of the ticket. `totalFilesScanned` is currently a sum, and zero is a perfectly good
summand: if someone renames `helio-mcp/` tomorrow, the gate keeps printing OK with a smaller number nobody reads.
Per-surface counts are computed, each is asserted non-empty, and a zero count exits non-zero naming the surface and
its root. The success line prints the per-surface breakdown so the number stays checkable by eye against the table.

### Decision 3 — Checks are selected per surface; the `credential`-property ban stays assistant-only

The MCP surface gets: secret-literal scan (new), bcrypt scan, email scan. It does **not** get the
`credential`-property ban or the import-graph walk. The evidence above is decisive: `helio-mcp`'s eight
`credential` declarations exist to reject credentials. Banning the identifier there would force a rename that makes
the rejection *less* legible, i.e. the gate would degrade the security property it exists to protect. The
import-graph walk is likewise assistant-specific (it hunts for React components that cannot exist in an MCP server).

The fixture surface keeps exactly the checks it has today, so this change cannot regress HEL-927's coverage.

### Decision 4 — False positives by convention

Two conventions, both stated in the script header and in the failure messages:

1. **Placeholder domains are reserved domains.** Keep `example.com|org|net|invalid`; add any `.test` TLD (RFC 2606,
   and the direction HEL-980 already took the backend specs). A future author needs no gate edit — they need a
   reserved domain, which is what they should be using anyway.
2. **Synthetic credential literals carry a marker.** A credential-shaped literal passes when it is the empty string
   or contains one of a small documented marker set (`not-a-real`, `should-never`, `dummy`, `placeholder`, `fake`,
   `example`, `redacted`) case-insensitively, or is all zeros. This admits the existing
   `"sk-should-never-be-accepted"` fixtures unchanged, and it means "make your fake secret look fake" — a rule an
   author can satisfy without reading the gate's source.

   **Measured (skeptic-design-2 CR2 corrects an earlier undercount):** there are **seven**
   `*key|secret|token|password` literal assignments of 8+ characters on the MCP surface, not one. Six carry the
   `should-never` marker and pass untouched (`restDataSourceSchema.test.ts:41,54,69,83,97`,
   `connectorSchema.test.ts:146`). The seventh does not:
   `helio-mcp/e2e/connector-authoring.ts:109` — `password: "correct horse battery staple 1!"`, the password the
   e2e driver registers a run-unique throwaway user with. Task 3.5's first run is therefore red on exactly one
   pre-existing file, and it is resolved the way the convention says: the file follows the convention. The value is
   consumed only by the script's own `POST /api/auth/register` call, so the literal is reworded to carry a marker
   (e.g. `"not-a-real-password correct horse battery staple 1!"`) and the registration keeps working unchanged. No
   allowlist entry, no exclusion. This is the widened gate finding a real instance of the thing it is for on its
   first run, which is evidence the widening works rather than an obstacle to it.

   The marker convention is the **only** exemption path, and it is deliberately not the first line of defence: the
   literal-shape rule in Decision 4a is what keeps legitimate non-secrets from ever reaching it.

Per-value allowlists are kept only for the one pre-existing entry (`ALLOWED_BCRYPT_HASHES`) that predates this
change; no new per-value entries are added. If the widened scan flags a legitimate existing file, the fix is to make
that file follow the convention, not to add it to a list.

### Decision 4a — The secret-literal shape is entropy-gated, not prefix-gated (skeptic-design-1 CR3)

A bare-prefix rule is wrong and was measured to be wrong: it fires on `helio-mcp/src/config.ts:17`
(`const PAT_PREFIX = "helio_pat_";` — a production constant), on `queryParamsOrdering.test.ts:74`
(`pat: "helio_pat_test"`), and on six `README.md` / `e2e/sleeper-rebuild.ts` documentation placeholders
(`helio_pat_…`, `helio_pat_xxxxxxxx`). None of those carries a Decision 4.2 marker, and task 3.5 forbids resolving a
finding with an exclusion — so the bare-prefix reading would force renaming a production constant to appease the
gate. That is the gate degrading the code, which is the failure mode this whole ticket is about.

**The rule is therefore prefix plus entropy.** A vendor-prefixed literal matches only when the prefix is followed by
**at least 20 characters** of `[A-Za-z0-9_-]`. Ground truth for the bound: `ApiTokenService.scala:133` documents the
real credential as `helio_pat_` + a 64-character hex string, and Anthropic keys following `sk-ant-` are far longer
still. So a real credential always matches, while every measured legitimate value is structurally excluded rather
than exempted:

| Measured live value | Suffix length | Matches? |
| --- | --- | --- |
| `"helio_pat_"` (`config.ts:17`, production constant) | 0 | no |
| `"helio_pat_test"` | 4 | no |
| `helio_pat_xxxxxxxx` (README placeholder) | 8 | no |
| `helio_pat_…` (README, ellipsis) | 0 (`…` is not in the class) | no |
| real `helio_pat_` + 64 hex | 64 | **yes** |

The identifier-name rule (`*KEY`/`*SECRET`/`*TOKEN`/`*PASSWORD` assigned a string literal) additionally ignores
literals shorter than 8 characters, since nothing that short is a credential worth leaking.

None of the values in the table above needs to be edited, allow-listed, or marker-annotated. If the first run
(task 3.5) contradicts this table, the table is wrong and the bound gets re-derived from the measurement — it is
not patched with an exclusion.

### Decision 5 — Self-test parity

Every new behavior gets a plant/assert-red/remove/assert-green case, following the existing file's structure
(subprocess invocation, `finally`-guarded cleanup, obviously-synthetic planted values): a secret literal planted
under `helio-mcp/`, a surface forced to zero files, and an unacknowledged top-level directory. The zero-file and
drift cases are driven by planting/removing real directories rather than by mutating the script, so they exercise
the shipped code path.

**The drift case must plant a non-dot-prefixed directory (skeptic-design-1 CR2).** Decision 1b has the guard skip
dot-directories, so a dot-prefixed planted directory would be skipped and the case would be vacuously green — a
self-test that proves nothing, in a ticket about gates that prove nothing. The planted directory is therefore named
`hel956-selftest-drift-probe/` at the repo root, and its removal is `finally`-guarded *and* re-attempted
idempotently at self-test startup, because a leftover copy makes every subsequent run red for an unrelated reason.
This is the single exception to the "planted paths are dot-prefixed" convention, and it is named as such below.

**The vacuity case must not relocate tracked source.** Moving `frontend/src/features/assistant` aside in a shared
checkout is the riskiest step available, and a crash between the move and the `finally` leaves the tree broken. The
case instead drives a surface whose root is itself planted, and the injection mechanism is specified concretely
rather than left to the implementer (skeptic-design-2 CR3):

- The `mcp` surface's own root is used. The self-test plants `helio-mcp/.hel956-selftest-secret.ts` for the CR-4.1
  case; for the vacuity case it instead **temporarily renames the whole `helio-mcp/` directory aside** to
  `helio-mcp-hel956-selftest-moved/` — a rename within the repo root, restored in `finally` and re-attempted
  idempotently at startup. This exercises the shipped code path with no self-test-only branch in the gate at all.
- **No environment variable is introduced.** An env-var-driven surface-injection hook would falsify the Gate-Chain
  checklist's "reads no environment variable" answer and would add a production code path that exists only for
  tests; both are rejected. The gate keeps a single, unconditional `SURFACES` table.
- `helio-mcp/` is not tracked-source-in-the-middle-of-being-edited the way `frontend/src/features/assistant` is,
  but the rename is still the riskiest step in the self-test, so it is the *last* case to run, and startup cleanup
  restores it before anything else if a previous run died mid-rename.

**Case ordering on the shared probe directory is explicit**, since the drift case and the vacuity case both
manipulate the repo root: (1) the `helio-mcp` secret-literal case, (2) the drift case with
`hel956-selftest-drift-probe/`, (3) the vacuity case with the `helio-mcp/` rename. Each asserts a green baseline
before it plants and after it cleans up, so a case that leaked state fails immediately and locally instead of
corrupting the next one. Note the interaction the ordering exists to prevent: while `helio-mcp/` is renamed aside,
`helio-mcp-hel956-selftest-moved/` is itself an unacknowledged top-level directory, so the gate would fail the
*drift* check rather than the *vacuity* check unless the vacuity assertion matches on the vacuity message
specifically. Every red assertion in the self-test therefore matches the expected message text, not merely a
non-zero exit status.

## Gate-Chain Implications Checklist

**What does it execute?** `node scripts/check-no-credential-in-agent-surface.mjs` and its self-test, invoked by
`.husky/pre-commit` via `npm run check:no-credential-leak` / `:selftest`. Both are pure Node: filesystem reads and
regex matching. No subprocess, no network, no git invocation, no database access.

**What environment does it inherit, and from where?** Whatever the Husky hook child inherits. It reads no
environment variable and depends on none — including for the self-test, which drives it purely by planting and
renaming real files (Decision 5) rather than through any injection hook; paths are derived from `import.meta.url`, not from `cwd` or `GIT_DIR`,
so it is unaffected by the HEL-657/HEL-805 poisoned-`GIT_DIR` class.

**Does it write anything outside its own sandbox?** The gate writes nothing at all. The self-test writes and then
removes planted files strictly under the repository root — under `backend/src/test/resources/db/fixtures/` and, new
here, under `helio-mcp/` and one temporary top-level directory. Every planted path is selftest-named, and removal is
`finally`-guarded so a failed assertion cannot leave a stray file. Planted paths are dot-prefixed **except** the
top-level drift probe `hel956-selftest-drift-probe/`, which must not be dot-prefixed or the drift guard would skip
it and the case would be vacuously green (Decision 5). That directory must be removed on every exit path *and*
removed idempotently at self-test startup, since leaving it behind would make the next run red for an unrelated
reason. Both new planted paths are added to `.gitignore` so a crashed run cannot produce a committable artifact.

**Does it behave differently from a linked worktree than from a main checkout?** No. It resolves the repo root from
the script's own location and walks directories that exist identically in a worktree. The one worktree-specific
hazard is `helio-mcp/node_modules`, which HEL-812/the Concertino sync links into worktrees: it is excluded by name,
so its presence or absence changes neither the file count nor the verdict. The drift guard enumerates top-level
directories, and a worktree's top level genuinely differs from the main checkout's (measured: the main checkout also
has `node_modules/` and `test-results/`), so it skips dot-directories and the hardcoded `IGNORED_TOP_LEVEL` set per
Decision 1b. Verification runs the gate from **both** the worktree and the main checkout; a green worktree alone
does not establish this answer.

**What happens on its first run?** It must be run standalone against the unmodified tree before the self-test is
trusted, to confirm zero false positives on the widened surface — the one measured risk in this change. The
expected observable outcome is the printed count rising from `16` to the new per-surface total (the MCP surface
measures 66 files under the fixture-style include rule, so roughly `82`, to be confirmed by measurement rather than
asserted). If the first run is red, the finding is triaged as either a real leak (fix the file), a convention gap
(fix the file to follow the convention), or a mis-specified literal shape (re-derive the Decision 4a bound from the
measurement) — never by widening an exclusion.

## Risks / Trade-offs

- **False positives on first widening.** Measured pre-emptively above: one `example.com` email (already allowed),
  zero bcrypt hits, and the eight `credential` props that Decision 3 deliberately does not check. The residual
  unknown is the new secret-literal regex; Decision 4a narrows it with an entropy floor and enumerates every
  measured live value it must not fire on, and the first-run check above is the gate on it.
- **The drift guard is a new source of unrelated redness.** Adding a top-level directory will fail an unrelated
  commit. That is the intended cost and the message must say exactly what to do; the alternative is the silent
  miss this ticket exists to eliminate. The `IGNORED_TOP_LEVEL` set (Decision 1b) is what keeps this from firing on
  ordinary build output, and it is a hardcoded duplicate of part of `.gitignore` that will drift if the repo adds a
  new ignored top-level directory — the failure mode is a spurious red with a message telling the author exactly
  what to add, not a silent miss.
- **A leftover self-test probe directory poisons subsequent runs.** `hel956-selftest-drift-probe/` is
  non-dot-prefixed by necessity, so a crashed self-test leaves the gate red until it is deleted. Mitigated by
  idempotent startup cleanup plus a `.gitignore` entry; called out here because it is a real operational edge.
- **The marker convention admits a lazily-named real secret.** Someone could name a real key `dummy-...`. The
  convention targets accident, not a determined author; it is not a defence against deliberate exfiltration, and
  the header says so rather than implying otherwise.
- **Scan cost.** One extra directory walk over a few dozen files. Negligible against the existing pre-commit chain.
