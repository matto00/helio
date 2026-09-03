# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `e1978270`. All findings below come from my own fresh runs and
my own re-derivation from the production code, not from `audit-report.md`'s
narrative.

### Phase 1: Spec Review — PASS

Issues: none blocking.

- **AC1 (literal wording).** The report audits 33 rows across the four consuming
  files, and explicitly reconciles the ticket's "13 known" against the 12 line
  numbers AC1 actually lists (task 7.2). Exceeds the literal AC (which names only
  `PipelineRunRoutesSpec` + `PipelineStepRepositorySpec`) in the direction the
  design-gate required.
- **AC2.** 8 sites in 4 tests switched to `insertInternal(..., parentStepId =
  Some(...))`; the other 25 documented as intentional roots in the report rather
  than as inline noise. Matches D1.
- **AC3.** `insert` → `insertRootStep`
  (`backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala:74`),
  scaladoc rewritten to state root-only + point at `insertInternal` for chaining;
  **no** `parentStepId` parameter added, defaulted or otherwise (verified against
  the new signature). The HEL-922 comment at `PipelineRunRoutesSpec.scala:484-491`
  is rewritten, not deleted.
- **AC4 (literal wording, including the negative case).** Explicitly answered
  "yes" for the three bucket-1 tests, explicitly bucket-3 (not bucket 1) for
  `PipelineAnalyzeRoutesSpec` 234/235, and the negative case is stated outright
  for all 25 single-step sites. Satisfied.
- **AC5.** Full suite green (see Phase 2) with no product-behavior change: the
  only `src/main` edit is a rename + scaladoc.
- Scope: the diff touches exactly the five source files in the proposal's Impact
  section plus the change directory. No `*.png`, no `.concertino/**`, no
  migrations, no schema/spec deltas. Tasks are all marked done and each maps to
  something visible in the diff or the report.

### Phase 2: Code Review — PASS

**Gates re-run by me, in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set):**

- `sbt test` — `Total number of tests run: 3606`, `Suites: completed 240,
  aborted 0`, `Tests: succeeded 3606, failed 0`, `[success] Total time: 243 s`.
  Independently confirms the executor's 3606 figure. No Flyway validation
  failure occurred on the shared dev Postgres.
- `node scripts/check-scala-quality.mjs` — `Scala code-quality check: clean
  (146 soft warning(s))`. All warnings are pre-existing file-length soft budgets
  on untouched files. No inline fully-qualified names introduced.

**`git commit -n` bypass (review item 6) — confirmed benign, and I checked what
the husky chain actually scans rather than assuming.** `.husky/pre-commit` runs
`set -e` with `check:helio-mcp-types` fifth. I ran the chain manually in this
worktree:

| step | result |
|---|---|
| `check:repo-integrity` | exit 0 |
| `lint` | exit 0 |
| `check:e2e-types` | exit 0 |
| `check:helio-mcp-types` | **exit 2** — `TS7031 ... implicitly has an 'any' type` in `helio-mcp/src/tools/write.ts`, i.e. the missing `@modelcontextprotocol/sdk` types |

So the executor's stated bypass cause is the true and first failure. (Node
resolves `eslint`/`prettier` upward from the main checkout's `node_modules`,
which is why the earlier steps pass despite no `node_modules` in the worktree;
`helio-mcp`'s own deps are not there and cannot be resolved upward.) Because
`set -e` aborts there, **the chain did skip Scala-relevant steps**, so I ran
every skipped step myself: `format:check` (0), `check:schemas` (0),
`check:spec-structure` (0), `check:openspec` (0 — "openspec/ is clean"),
`check:no-credential-leak` (0), plus `check:scala-quality` and the backend suite
above. No coverage was lost to the bypass, and the bypass is disclosed in the
commit message.

**Highest-risk claim — the two "inert mutation" corrections. Both verified,
independently.**

*(a) Original target genuinely inert, for the stated root cause — re-derived from
the code, not from the narrative:*

1. `PipelineRunRoutesSpec` 468/469. `PipelineRunService.scala:423` reads
   `outcome.nodeOutcomes.get(Some(target.id.value)).map(_.rows).getOrElse(outcome.rows)`
   — the target step's **own** node-keyed outcome, added by HEL-905/CR1. Widening
   `slicedSteps` (line 403) changes only which *other* nodes get evaluated;
   `select`'s own recorded frame is 2 rows under either topology. The mask is
   real and the stated root cause is correct.
2. `WorkspaceContextServiceSpec` 346/347. `createSource`'s payload is
   `Vector(StaticColumnPayload("value", "string"))`
   (`WorkspaceContextServiceSpec.scala:194`), and the step is
   `SelectConfig(Vector("value"))` — a schema-identity no-op on a single-column
   `[value]` schema. So "rename's input is select's real output" and "rename's
   input is the raw source schema" are the same value, and no assertion in the
   test can distinguish them. The schema-threading mutation is genuinely inert
   for this fixture. Stated root cause correct.

*(b) Replacement targets genuinely test the property the test name claims:*

1. The replacement is the *same* prefix-walk break plus removal of the mechanism
   that masks it — the standard "unmask, then mutate" move, not a different
   property. It still isolates the prefix walk.
2. The replacement mutates `PipelineStepRepository.executionOrder`'s `walk`
   (lines 768-772, `node +: (tails ++ trunkChild.toVector.flatMap(walk))`) —
   trunk traversal order, which is literally the "**in step order**" claim in the
   test's name, and (per `WorkspaceContextService.toStepEntry`,
   `WorkspaceContextService.scala:275-281`) is the mechanism that actually
   determines the reported step sequence. Correctly targeted.

*(c) No sign of unreported intermediate candidates.* Each correction is a minimal
derivative of the design's own assigned target with a root cause I was able to
reproduce or re-derive from first principles; neither is a target reached by
wandering.

**The specific gap you asked me to probe — the third probe, run.** I mutated
`PipelineRunService.scala:423` **alone** (`val targetRows = outcome.rows`,
node-keyed lookup dropped, `slicedSteps` untouched) and ran
`testOnly ...PipelineRunRoutesSpec -- -z "only applies steps up to"`:

| configuration | result |
|---|---|
| drop node-keyed lookup ALONE, **new** (trunk) topology | **GREEN** (`succeeded 1, failed 0`) |
| drop node-keyed lookup ALONE, **old** (parallel-root) topology | **GREEN** (`succeeded 1, failed 0`) |
| widen `slicedSteps` ALONE, either topology | GREEN (executor's probe; corroborated by the code path above) |
| **both** breaks, **old** topology | **GREEN** |
| **both** breaks, **new** topology | **RED** — `1 was not equal to 2 (PipelineRunRoutesSpec.scala:473)` |

All five configurations were run by me; the last two reproduce the executor's
reported results exactly. The `git status` afterwards is clean — every probe was
reverted from a byte-for-byte backup.

**Conclusion on the classification:** your bucket-3 hypothesis is **not**
supported. Dropping the node-keyed lookup alone is green under *both* topologies,
not red under both, so the test is not "already guarded independently of
topology". The compound break satisfies D2a's precondition (it demonstrably
changes `rowCount`'s value) and satisfies bucket 1's literal definition (green
old + mutation, red new + mutation). **Bucket 1 stands.** The honest caveat,
which the report does not spell out, is that the assertion is guarded by the
*conjunction* of the prefix walk and the node-keyed lookup — defense in depth —
so it does not independently guard the prefix walk while the lookup is intact.
That is a transparency gap in the report's wording, not a misclassification;
recorded as a non-blocking suggestion below.

**Other review items:**

1. *Every changed test datum answers "why did this need to change?"* — Yes. The
   only changed expectations in the entire diff are in
   `WorkspaceContextServiceSpec.scala:355-363`: `position` `Vector(0,1)` →
   `Vector(0,0)` plus a new `outputColumns` ordering assertion, both carrying an
   8-line inline rationale with code citations, and both diagnosed in the report.
   Every other hunk is topology or rename only. No rubber-stamped expectation.
2. *`Vector(0,1)` → `Vector(0,0)` is D3 case (a), re-derived by me.*
   `insertRootStep`'s position comes from `max(position) where parentStepId is
   null` (`PipelineStepRepository.scala:86-87`); `insertInternalAction`'s comes
   from `siblingsQuery(pipelineId, parentStepId)` (lines 215-216) — per-parent, so
   a first child is always 0 and a two-step trunk is genuinely `(0,0)`.
   Independently, `WorkspaceContextService.toStepEntry` maps `analyze(...).steps`
   in the order returned; that order comes from `listByPipelineInternal` →
   `executionOrder`'s tree walk (lines 754-780), which emits `rootTrunk.flatMap(walk)
   ++ rootTails` and places a trunk child immediately after its parent —
   `position` is only used as the trunk/tail discriminator (`position == 0`), never
   as a global sort key. Case (a) confirmed. **Not** a product defect; no
   escalation warranted.
3. *The 25 single-step sites received only the mechanical rename.* Confirmed
   hunk-by-hunk in `git diff main...HEAD`: every one of those hunks changes only
   `insert(` → `insertRootStep(`, with no topology, expectation, fixture or
   argument change.
4. Code quality: no dead code, no leftover TODO/FIXME, no inline FQNs, no new
   type escape hatches, no over-engineering. The rename is behavior-preserving
   for production (zero production callers — confirmed: `grep -rn "\.insert("
   backend/src/main` yields only `insertInternal`/`insertInternalAction`/
   `insertAtInternal`), and the compiler is a genuine completeness gate for the
   33 call sites, as the clean `sbt test` compile shows.

### Phase 3: UI Review — N/A

Backend-Scala-only change (`backend/src/main/.../PipelineStepRepository.scala`
plus four spec files). No `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`,
no `openspec/specs/**`. No UI trigger matched; no dev server started.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `audit-report.md` section 1: state plainly that the corrected mutation is a
  **compound** break and that neither half alone is red under either topology
  (I measured: widen-alone green/green, drop-node-keyed-lookup-alone green/green).
  The bucket-1 classification is correct, but as written a reader could infer the
  test independently guards the prefix walk; it guards the *conjunction* of the
  prefix walk and the HEL-905 node-keyed lookup.
- The four corrected sites moved from `insert(..., dummyUser)` (RLS user-context
  write) to `insertInternal` (ACL-bypassing). This is what the design mandated and
  what HEL-922 already did, and no coverage is lost (insert-time ACL is covered by
  `PipelineStepRepositorySpec`'s untouched non-owner tests) — worth one sentence in
  the report so the privilege change is visible rather than incidental.
- `audit-report.md` D3 section: "produced exactly ONE red assertion, both
  anticipated by design.md" — "both" is a leftover from an earlier draft.
- The AC4 section is framed entirely in mutation buckets; a cross-reference to the
  one assertion that literally changed value between the two shapes (the
  `position` vector) would make the AC4 answer self-contained.
