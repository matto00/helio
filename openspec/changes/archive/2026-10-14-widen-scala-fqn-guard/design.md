## Context

`scripts/check-scala-quality.mjs` (run by `.husky/pre-commit` line 19 via `npm run check:scala-quality`, and in CI)
rejects inline FQNs by a prefix list (`FQN_PREFIXES`). From `scala.` it lists only `scala.concurrent.` and
`scala.annotation.`. Measured on main 71e058436 (design skeptic, a guard copy with `"scala."` added): 76 violations in 39 files under
`backend/src/{main,test}/scala` (Try, mutable, Success, Failure, io.Source, immutable). There are no inline
`scala.util.Random` code uses: the two textual hits are string literals in `ShareTokenGenerationSpec.scala` (see D4). Scala is
2.13.15. Ticket line numbers drifted: of the "three" PipelineAnalyzeService sites only L299 remains;
MultiInputSchemaInference is now L110; the 127-char line is L26; blank lines L10-12 still present.

## Goals / Non-Goals

**Goals:** the guard sees the whole `scala.` namespace; the repo passes it; stale `PipelineAnalyzeService.<moved>`
refs re-pointed with a zero-hit grep; cosmetic nits fixed. No runtime behaviour change.

**Non-Goals:** HEL-1386 (`${...}` splices are blanked with the string, so FQNs there stay invisible to the guard) —
separate ticket, untouched. No change to exemptions, file-size warnings, or any Scala logic.

## Decisions

**D1 — Prefix is `scala.` (whole namespace), replacing `scala.concurrent.` and `scala.annotation.`.** Alternative:
enumerate `scala.util.`/`scala.collection.`/`scala.io.` — rejected: the gap recurs with the next sub-package
(`scala.jdk.`, `scala.math.`). The regex stays `(<prefix>)\w`, so `scala.` must be followed by a word char.
False-positive surface: an identifier ending in `scala` followed by `.` (e.g. `foo.scala.x` or `xscala.y`) in code —
none exist today (the design skeptic's probe: all 76 hits are real uses) (the guard run itself proves it); `_root_.scala.X` would be flagged and should be imported anyway.
Keep `assertPrefixesEndInDot` satisfied (`scala.` ends in `.`). Update the header comment and CONTRIBUTING.md L236's list.

**D2 — Selftest is red first.** Add red cases (`scala.util.Try(x)`, `scala.util.Success`, `scala.collection.mutable.X`,
`scala.collection.immutable.Seq`, `scala.io.Source.fromFile`, plus keep `scala.annotation.` and add
`scala.concurrent.duration.` so the subsumed entries stay covered) and a green case (`import scala.collection.mutable`,
`import scala.util.{Failure, Success, Try}`). Record the selftest run against the UNCHANGED guard first (expected:
the new red cases FAIL, non-zero exit), then the run after widening (pass). Also mutation-prove: revert the prefix to the
old list → selftest red. Transcripts under `openspec/changes/widen-scala-fqn-guard/proof/`.

**D3 — Fix by import, idiomatically, collision-checked.** `scala.collection.mutable.X` → `import scala.collection.mutable`
and `mutable.X` (the 2.13 idiom; never import mutable `Map`/`Set` bare — that would shadow the immutable defaults).
`scala.collection.immutable.X` → `import scala.collection.immutable` + `immutable.X`. `scala.util.{Try, Success,
Failure, Random}` → explicit top-of-file import of exactly the names used. `scala.io.Source` → if `Source` is already
bound in the file (e.g. pekko-streams `Source`), use `import scala.io.{Source => IoSource}`; otherwise plain import.
Collision audit per touched file, before editing: grep for an existing binding of each name being imported (explicit or
wildcard import, local `def`/`val`/`object`/class named `Try`/`Success`/`Failure`/`Source`/`Random`/`mutable`/
`immutable`, and pekko `Status.Failure`/`Status.Success`). Scala 2.13 resolves an explicit import over a wildcard
silently, so a clash with a wildcard can change which symbol binds without a compile error — where any binding of the
name already exists, use a rename import instead. Record the audit result (one line per file) in
`proof/collision-audit.txt`. Merge into an existing `import scala.util.…` line where one exists. A scoped import inside an
object/function is allowed (CONTRIBUTING exception) only when stated.

**D4 — Also clear FQNs the guard cannot see.** After the guard passes, a raw sweep over the whole `scala.` namespace
— `grep -rnE '(^|[^A-Za-z0-9_.])scala\.[a-z]+\.' backend/src --include=*.scala`, filtered to non-import/package,
non-comment lines, with double-quoted string literals blanked exactly as the guard blanks them (but `${...}` splice
contents inside `s"..."` inspected by eye for any remaining hit) — must return zero. Expected and REQUIRED leftovers,
never to be "fixed": `ShareTokenGenerationSpec.scala:45` (a test-name string) and `:56`
(`src should not include "scala.util.Random"`, the security assertion keeping `ShareTokenService` off an insecure
RNG); both are string literals, already exempt by the guard spec. Any splice-hidden code hit found (HEL-1386's blind
spot) is fixed and named in the PR body; the guard's splice behaviour is not changed by this ticket.

**D5 — Stale-reference mapping** (member → current owner, all `private[engine]` in `domain/engine/`):
`validateStepConfig` → `StepConfigValidation`; `inferCompute`/`inferAggregate`/`inferGroupBy` → `ColumnSchemaInference`;
`inferJoin`/`inferLookup` → `MultiInputSchemaInference`; `inferConvertFormat`/`inferAnalyzeWithAi`/`inferSplitText`/
`inferExtractHeadings`/`inferChunkByTokenCount` → `TextSchemaInference`; `inferAssert` → `ReshapeSchemaInference`
(frontend `AssertConfig.tsx:29` comment). Refs to members still on `PipelineAnalyzeService` (`inferOutputSchema`
forwarder, `analyzeNodes`, `stepConfigProblem`, `StepConfigInvalidCode`, …) stay. Sweep scope: `backend/`, `frontend/src`,
`helio-mcp/`, `docs/`, root `*.md`, `openspec/specs/` (via this change's four MODIFIED deltas, landing at archive).
**Exempt:** `backend/src/main/resources/db/migration/V94__outputs_model.sql:449` (`PipelineAnalyzeService.SchemaField`)
— an applied Flyway migration; editing it changes its checksum and fails `validate` in every environment. Never edit.
Zero-hit grep (must print nothing; run pre-archive excluding `openspec/specs`, post-archive including it):
`grep -rnE 'PipelineAnalyzeService\.(validateStepConfig|infer(Compute|Aggregate|GroupBy|Join|Lookup|ConvertFormat|AnalyzeWithAi|SplitText|ExtractHeadings|ChunkByTokenCount|Assert))\b' backend frontend/src helio-mcp/src docs openspec/specs *.md`
Second probe, line-number citations: `grep -rnE 'PipelineAnalyzeService\.scala:[0-9]+'` over the same scope must return
zero — the one known site is `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala:525`
(`PipelineAnalyzeService.scala:126 (validateStepConfig's ...)`), re-pointed to `StepConfigValidation.validateStepConfig`
without a line number. Completeness check: every distinct `PipelineAnalyzeService.<member>` across that scope names a
member that exists on the object; ignore non-member tokens (`getClass`, `_`, the `.scala` filename) and the V94
`SchemaField` exemption.

**D6 — Cosmetic.** PipelineAnalyzeService.scala: drop blank lines 10-12 (keep one blank before `object`), wrap L26
(`stepConfigProblem`) under 120 chars. PipelineAnalyzeProtocol.scala: rewrap L234-241 (the 102/43-char ragged pair) and
L250-255 (L252 is 130 chars) to ≤ ~100 chars, wording unchanged.

## Gate-Chain Implications Checklist

**What does it execute?** `node scripts/check-scala-quality.selftest.mjs && node scripts/check-scala-quality.mjs`
(package.json `check:scala-quality`). The change edits one constant array and adds selftest cases; the selftest already
spawns the CLI once against a `mkdtemp` fixture root. No new process, binary, network call or dependency.

**What environment does it inherit, and from where?** Git's hook environment from `.husky/pre-commit` (including
`GIT_DIR`/`GIT_INDEX_FILE` in a linked worktree) and npm's env. Neither script reads git env or invokes git; paths are
resolved from `import.meta.url` (repo root) or an explicit argv root.

**Does it write anything outside its own sandbox?** Only the selftest's existing `mkdtempSync(os.tmpdir())` fixture,
removed in `finally`. The guard itself is read-only. Unchanged by this ticket.

**Does it behave differently from a linked worktree than from a main checkout?** No: it scans
`<repoRoot>/backend/src/{main,test}/scala` where repoRoot derives from the script's own location, so a worktree scans its
own tree. It reads no git metadata.

**What happens on its first run?** It fails any commit in any worktree whose tree still contains an inline `scala.*`
use — which is why this change fixes every existing site in the same commit. Other live lanes (e.g. HEL-1586, which
adds an inline `scala.util.control.NonFatal` in `VerifiedEmbeddedPostgresSpec.scala`) will see their own new inline uses
flagged after rebasing onto this; the driver is told. No state, cache or first-run setup.

## Risks / Trade-offs

- An import that silently rebinds a name (D3) is the only behaviour risk; mitigated by the collision audit and the full
  backend suite (`sbt testFull`).
- Wide, shallow diff (~41 files) increases merge-conflict odds with live lanes; HEL-1586's two testkit files are not
  touched (verified: neither has an inline `scala.*` on main).

## Planner Notes

- Self-approved: whole-namespace prefix (D1); fixing all 76 sites in this change rather than baselining (the driver's
  rule: fix or exempt with reasons, never weaken). No exemptions are anticipated.
- Spec route: four MODIFIED deltas carry the reference-only rename for canonical specs; ADDED requirement for the guard.
