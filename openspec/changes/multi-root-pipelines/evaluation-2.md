## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewing commit `d418885a` on top of the 31 reviewed in `evaluation-1.md`. Scope of that commit
is tight and correct: 2 main files, 2 test files, 2 artifacts. **V98 and all migration files are
untouched** (verified: `git diff --name-only 27abda0e..HEAD` matches no migration path), so
cycle 1's V98 clearance stands without re-derivation.

### Gates — all re-run fresh

| gate | result |
|---|---|
| `cd backend && sbt test` | **PASS** — 3729 tests, 0 failed, exit 0 (+4 vs cycle 1, as claimed) |
| `npm run lint` / `format:check` / `typecheck` | PASS |
| `npm test` | PASS — 252 suites / 2590 tests, plus 22 suites / 223 MCP |
| `check:schemas` / `openspec` / `spec-structure` | PASS |
| `check:e2e-types` / `check:helio-mcp-types` | PASS |
| `check:node-root-encoding` (+ `:ts`) | PASS |
| **Playwright** (backend restarted onto `d418885a`) | **37 passed, 1 failed** — same expected-red only |

Playwright was re-run because backend behavior on a route the suite exercises did change. I killed
the cycle-1 backend process (PID 694408) and confirmed it was down before restarting, so this run
genuinely exercised `d418885a` and not a reused stale server. Result is byte-for-byte the same
verdict as cycle 1: the only red is `hel910-pipeline-to-dashboard-flow:90` failing at
`waitForURL "/pipelines/undefined"` — the HEL-969 frontend-repair mechanism, unrelated to this
commit. No new red.

---

### Cycle-1 change requests — all five verified closed

**CR1 (Site A write guard) — CLOSED.** `requireUnambiguousRootWhenNeither`
(`OutputService.scala:159-171`) returns
`s"This pipeline has ${roots.size} roots -- name one via rootId, or anchor via nodeStepId"`,
mirroring `PipelineService.persistNewStep`'s sibling guard including message shape. Correctly
sequenced *after* `accessChecker.requireAccess`, so it cannot leak a pipeline's root count to a
non-grantee. The false precondition comment was **deleted outright**, not edited around, as asked.

**CR2 (MultiRootIsolationSpec) — CLOSED, and the reframing is legitimate** (with one accuracy
correction, below). The test now documents the *repository primitive's* fallback contract rather
than asserting an end-to-end claim. Its assertion is unchanged, which is correct for that framing —
it still fails if the repository's fallback changes. The end-to-end coverage CR2 asked for lives in
the new `OutputRoutesSpec` tests plus task 7.3a-i's pre-existing per-root persistence test.

**CR3 (Site B read keying) — CLOSED.** `previewAtNode` takes `rootId`; `distinctNodeKeys` and
`byNodeKey` key on the full `(stepId, rootId)` pair; the source-level arm resolves `selectedRoot`
and passes `Vector(selectedRoot)` to `backend.execute`. The reasoning for passing one root rather
than the full vector is correct and I verified it independently against the sibling backfill path:
`evaluateNodeRowsForBackfill:605-617` already does exactly the same narrowing for the same stated
reason (with zero steps, `TreeWalkResult.rows` is the lowest-positioned root's frame). Passing the
full vector here would have mixed roots.

**CR4 (regression tests that would be red today) — CLOSED, and I proved it myself rather than
accepting the mutation-proof comments.** See the mutation section below.

**CR5 (record both sites in the R12 enumeration) — CLOSED.** `tasks.md` 5.8a-ii adds both, and
states plainly that Site B was *"absent from this task's own original enumeration — a genuinely
missed site, not a knowingly-deferred one."* That is the honest framing Rule B asks for.

---

### Independent mutation proof (I ran these; I did not take the comments' word)

Method: created a throwaway detached worktree at `d418885a`, mutated the shipped source there, ran
`testOnly com.helio.api.routes.pipelines.OutputRoutesSpec`, then removed the worktree
(`git worktree remove --force`, verified gone via `git worktree list`). The delivery worktree was
never modified.

**Site B mutation** — reverted `selectedRoot` to unconditional `roots.head` and restored
`.execute(pipeline, roots, ...)`:

```
- should returns the SECOND root's rows ... (single-Output arm) *** FAILED ***
    Vector("root0-row") was not equal to Vector("root1-row") (OutputRoutesSpec.scala:972)
- should returns the SECOND root's rows ... (all-Outputs arm) *** FAILED ***
    Vector("root0-row") was not equal to Vector("root1-row") (OutputRoutesSpec.scala:994)
Tests: succeeded 47, failed 2
```

**Site A mutation** — neutered `requireUnambiguousRootWhenNeither`'s condition to `if (true)`:

```
- should 400, naming the root count, when a create names NEITHER nodeStepId NOR rootId ... *** FAILED ***
    201 Created was not equal to 400 Bad Request (OutputRoutesSpec.scala:939)
Tests: succeeded 48, failed 1
```

Both go red, **exactly the named tests and no others**, and red *for the predicted reason* rather
than incidentally. The all-Outputs test is the strongest of the four: it asserts both Outputs' rows
in a single response, so a collapse-to-one-key regression is caught by content, not by count. The
executor's mutation claims are accurate as stated.

On the third question asked — whether the corrected `MultiRootIsolationSpec` was weakened into a
test that cannot fail: **no.** Its assertion (`actualRootIds shouldBe Set(root0Id.value)`) is
unchanged from before; only the title and rationale changed. It remains failable, and it is no
longer the artifact certifying the defect, because the behavior it pins is now genuinely correct at
the layer it tests.

---

### The `DemoData` question — my independent ruling

**Your grep is right and the executor's wording is wrong; but `DemoData` is not a fourteenth
instance, and for a stronger reason than "it's dev-seed-only."**

The justification as written — *"the caller, `OutputService`, is responsible for refusing
ambiguity"* — is inaccurate: there are three callers of the repository's root-bound insert, not one.
That phrasing should not stand.

But the substance survives, because **`DemoData` never takes the unguarded path at all.**
`DemoData.scala:65` passes `explicitRootId = Some(demoRootId)` — it is a *named-root* caller. The
risky path is `explicitRootId = None` (which reaches `firstRootIdAction`'s silent auto-resolve), and
`DemoData` does not use it. It resolves its root explicitly from
`pipelineSummary.roots.head` at `:55`, which task 7.3e already converted precisely so it would stop
relying on the fallback default.

It is also structurally incapable of producing the ambiguous case: it calls
`pipelineRepo.create("Demo Pipeline", Vector(source.id), SystemUser)` — a hard-coded one-element
roots vector — and runs only from `Main.scala:149`'s `DemoData.seedIfEmpty` at boot against an empty
database. Even if it *did* pass `None`, `roots.size` would be 1 and the auto-resolve would be
correct by construction. So `roots.head` at `:55` is not an R3 position-branch either; there is
exactly one root for it to be.

So the correct characterization is: **three callers, all three safe, by three different
mechanisms** —
1. `OutputService.scala:154` — the new `requireUnambiguousRootWhenNeither` guard;
2. `PipelineService.scala:625` via `insertInternalAction` — `resolveOutputRootIndex:282-287`, which
   I verified returns a named 400 (`"is root-bound with no rootClientId, and this request names N
   roots -- name one explicitly"`) when `roots.size > 1`;
3. `DemoData.scala:65` — names its root explicitly, and is single-root by construction anyway.

**Is the repository retaining a silent auto-resolve acceptable layering? Yes.** A low-level
primitive keeping a single-root-compatible fallback is fine *provided the set of callers that can
reach it with >1 root is empty and enumerated*. That set is empty here, and I verified it by reading
all three call sites rather than by grep count alone. This is the same structure as the
`firstRootIdAction` audit in task 7.3d that cycle 1 cleared: the fallback is unreachable-in-practice
and the proof is per-call-site.

**What should change is the wording, not the code.** The justification should state the enumeration
("three callers; none can reach this fallback with more than one root, for these three reasons")
rather than the singular assertion ("the caller is responsible"). That is exactly design.md Rule B's
distinction — an enumeration a future reader can check versus a claim they must trust — and the
current phrasing is the trust-me form, which is how the *original* thirteenth instance survived a
sweep in the first place. Non-blocking; recorded as suggestion #1.

---

### Re-verification of the three items you flagged

**1. R9 / preview-only — CONFIRMED, by line ranges rather than by the comment's say-so.**
`previewAtNode` spans lines 386–559. Every state-mutating call in `PipelineRunService` sits outside
it: `nodeSnapshotRepo.overwriteRows` (656, 1030), `pipelineRunRepo.insertRun` (784),
`pipelineRepo.updateLastRun` (840, 965, 1118), `onRunSuccess` (864) — all in the
`runPipeline`/`executeRun`/`backfill` paths. The only occurrence of those names inside the preview
range is the explanatory comment at 409. R9's "one run refreshes all roots and all Outputs
atomically" governs `runPipeline:256+`, which this commit does not touch (`roots` is still passed
whole there). **The change is genuinely preview-only.**

**2. Preview and persisted rows now AGREE — confirmed, and this is the real fix, not just a new
parameter.** Both paths now select by the *same field*, `output.node.rootId`:
- persisted: `OutputService.scala:65` → `backfillOutputNode(..., output.node.rootId)` →
  `evaluateNodeRowsForBackfill:611-614` filters `allRoots` to the named root →
  `persistBackfilledRows(..., explicitRootId)`; and reads via
  `OutputService.scala:339`'s `listRowsPaged(..., explicitRootId = output.node.rootId...)`.
- preview: `previewOutputs` → `previewAtNode(..., output.node.rootId...)` → `Vector(selectedRoot)`.

Cycle 1's finding was that these two contradicted each other for a root-bound Output on a two-root
pipeline. They no longer can: they read one field and apply the same narrowing. The
`OutputRoutesSpec` test *"returns ONLY the Output's own root's rows, not another root's mixed in
(task 5.8b-iv-a)"* covers the persisted side and the two new tests cover the preview side, so both
halves of the agreement are independently pinned.

**3. `MultiRootIsolationSpec` still fails on regression** — confirmed above.

---

### Phase 1: Spec Review — PASS

Unchanged from cycle 1. No AC regressed; the commit adds behavior strictly inside AC2/AC3's
territory (root-correct Output binding and reads) and touches no spec delta. `tasks.md` and
`files-modified.md` were updated to match what shipped.

**9.7 cluster:** out of scope for this cycle by your instruction, and my cycle-1 read is unchanged —
coherent at runtime (`PipelineProposalService.createPipeline:377` builds a valid one-root pipeline),
with the only real cost being the archiving of two permanently-false canonical spec assertions.
It remains a product ruling, not a defect. It does not affect this verdict.

### Phase 2: Code Review — PASS

Both cycle-1 defects are genuinely fixed at the right layer, with evidence I reproduced myself. The
new code is consistent with the surrounding conventions: the guard mirrors its sibling rather than
inventing a second idiom, the `null`-repo degrade matches `resolveExplicitRootId`'s existing
contract, and both fixes are documented with the reasoning rather than just the change.

No new violations of CONTRIBUTING.md or the R12 encoding rules. No scope creep — `frontend/**`
untouched, migrations untouched.

### Phase 3: UI Review — PASS

37/38 passed; sole failure is the documented HEL-969 expected-red, reproduced with the identical
mechanism on a freshly restarted backend. No console-level or behavioral regression introduced by
this commit.

### Overall: PASS

---

### Non-blocking Suggestions

1. **Correct the singular-caller wording** (`MultiRootIsolationSpec.scala` comment, and the matching
   sentence in `tasks.md` 5.8a-ii). Replace *"whose caller (the service layer) is now responsible"*
   with the three-caller enumeration from the ruling above. The claim is true; the *form* of the
   claim is the trust-me form that let the thirteenth instance survive a sweep. Cheap to fix, and it
   is the artifact HEL-914 will read.

2. **`previewAtNode:411` fails open where its sibling fails closed.**
   `rootId.flatMap(rid => roots.find(_._1 == rid)).getOrElse(roots.head)` silently substitutes root 0
   when a named `rootId` is not found in `roots`. `resolveAllRootDataSourcesInternal:242` drops any
   root whose DataSource `findByIdInternal` returns `None`, so `roots` can in principle be a strict
   subset of `pipeline_roots`. The sibling backfill path handles the identical situation the other
   way — `if (roots.isEmpty) Future.successful(())`, i.e. do nothing rather than use the wrong root.
   I judged this **non-blocking** rather than a fourteenth instance because the FK chain makes it
   practically unreachable: `pipeline_roots.data_source_id REFERENCES data_sources(id) ON DELETE
   CASCADE` and `outputs.root_id REFERENCES pipeline_roots(id) ON DELETE CASCADE`, so deleting a
   DataSource deletes the root *and* the Output bound to it — there is no surviving Output left to
   preview. But it is still a `getOrElse` fallback of exactly the banned shape, and matching
   backfill's fail-closed behavior would cost one line and remove the last instance of the pattern
   on this path.

3. `requireUnambiguousRootWhenNeither` skips its check entirely when `pipelineRootRepo == null`.
   That matches `resolveExplicitRootId`'s documented fixture-degrade contract and is fine as-is, but
   it does mean a wiring regression in `ApiRoutes` would silently disable a correctness guard rather
   than fail loudly. Worth a one-line assertion at construction time if this class ever grows a
   third `null`-guarded dependency.
