## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Verified against ticket.md AC1–AC6 and design.md Decisions 1–5.

- AC1 PASS — `PipelineRunServiceSpec.scala:1113` asserts `stepRowCounts.keySet`, which is threaded
  from `outcome.stepCounts` and does NOT pass through the node-keyed lookup at
  `PipelineRunService.scala:527`. Fixture contains `tail`, a second child of `stepA`, outside
  target's closure.
- AC2 PASS — M1 (`closureOf(...)` -> `sortedSteps.toVector` at :507) demonstrated red with captured
  verbatim output (`m1_evidence.txt`, key set gained a third id). The transcripts are real sbt runs
  (distinct wall-clock timestamps, `compiling 1 Scala source` showing production source recompiled),
  not reconstructions. The masking lookup at :527 was left intact.
- AC3 PARTIAL — see Change Request 1. The bar ("more than one axis") is genuinely met by M1
  (superset failure) vs M2 (subset failure), which are structurally different failure shapes. But
  `mutation-evidence.md`'s accounting section overclaims by counting M3-replacement as a third
  distinct axis.
- AC4 PASS — non-degeneracy is not merely asserted, it is *demonstrated*: under M1 the observed key
  set is strictly larger than expected on both fixtures, which is only possible if the off-closure
  node is both outside the closure and enabled. The design gate CR3 disabled-node trap is handled
  (`enabled = true` explicit in every off-closure insert).
- AC5 PASS — the second site (`evaluateNodeRowsForBackfill`, :662) is guarded, and guarded by the
  right mechanism. The `SpyExecutionBackend` is real (delegates to a real `InProcessExecutionBackend`
  so the run completes), and `site2_m1_evidence.txt` shows it red at
  `PipelineRunServiceSpec.scala:2047` under the :662 widening mutation, with the two :507 guards
  staying green — proving the mutation is isolated to that site and the spy discriminates it. The
  test correctly does NOT assert on persisted rows (task 3.1).
- AC6 PASS — verified by my own fresh run (Phase 2).
- Tasks: all marked done and each maps to something actually present. Task 2.1 says the guard was
  added to `PipelineRunRoutesSpec`; it was in fact added to `PipelineRunServiceSpec`. This is a
  reasonable relocation (the spy injection at site 2 needs service-level construction anyway, and
  the two guards then live together), but tasks.md was not corrected to say so — planning artifacts
  do not reflect final implementation on this point. Non-blocking, folded into CR1's doc pass.
- Scope: no scope creep. Test-only.

### Phase 2: Code Review — PASS

Gates re-run by me, fresh, in the worktree (not trusting the executor's report):

```
cd backend && sbt test
[info] Total number of tests run: 3848
[info] Suites: completed 254, aborted 0
[info] Tests: succeeded 3848, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] Total time: 306 s, completed Sep 5, 2026, 4:03:25 PM   (exit 0)
```

Frontend gates: N/A — `git diff --name-only main...HEAD` matches no `frontend/**` path.

- Production-source / migration check (ticket Constraints, design Decision 5) — CONFIRMED CLEAN.
  `git diff --stat main...HEAD` touches exactly one `backend/` file, under
  `backend/src/test/`. No `db/migration/**` file. I additionally read `PipelineRunService.scala`
  :507 and :662 in the final tree: both still call `NodeDependencyClosure.closureOf(...)` — every
  mutation was genuinely reverted, and `git status --porcelain` is empty.
- No inline fully-qualified names; imports added to the existing grouped import
  (`NodeKey, PipelineExecutionBackend, PipelineExecutionOutcome`). CONTRIBUTING-compliant.
- Spy is a proper delegating decorator with an explicit `@volatile` on the captured field — correct
  given the `Future`-based execution path.
- Comments carry the "why", including why the obvious assertion (persisted rows / `rows.size`) is
  the wrong one. This is the right kind of comment for a guard test.
- No dead code, no TODO/FIXME, no untyped escape hatches. `registry = null` in the spy service
  construction mirrors the file's existing convention for that parameter.
- Behaviour-preserving: nothing but test code changed.

Non-blocking observations only (see below).

### Phase 3: UI Review — N/A

No trigger matched: no `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**`.
Per constraints, no dev servers started, no Playwright, no e2e specs run.

### Overall: FAIL

The guard itself is real, red-proven on a non-degenerate fixture, and covers both slicing sites —
substantively this is good work. It fails on one thing, and that thing is the deliverable the ticket
made explicit: the honesty of the axis accounting.

### Change Requests

1. `openspec/changes/guard-preview-prefix-slicing/mutation-evidence.md`, "Honest axis accounting"
   section (and the "Total:" line): correct the claim that M3-replacement is a **third distinct
   code-mutation axis at line 507**. On both shipped fixtures the target's closure is a two-node
   chain `[stepA, target]`, so:
   - M2 (`closureOf(..., sortedSteps.head)`) yields key set `{stepA}`;
   - M3-replacement (`closureOf(..., target).dropRight(1)`) also yields key set `{stepA}`.

   Both evidence transcripts confirm this: `m2_evidence.txt` and `m3_replacement_evidence.txt` each
   show *the same* failure — exactly one retained key, the ancestor, with the target's own key
   missing — on both tests. They are distinct source edits with distinct semantics, but on these
   fixtures they are **observationally identical**, so the guard does not independently discriminate
   them. Counting them as two axes is precisely the "single axis wearing multiple labels" trap
   design.md Decision 3 / gate CR4 exists to prevent, and the current wording reproduces it.

   Required replacement claim (accurate, and still sufficient): **two** demonstrated axes at :507 —
   M1 (slice too wide → key set gains an off-closure id) and M2 (wrong node targeted → key set loses
   the target's own id). These are genuinely different failure shapes (superset vs subset), so AC3
   is met without M3. Then state M3-replacement for what it is: a third source-level edit that reds
   for the right reason but produces the same observed key set as M2 on these fixtures, and would
   only separate from M2 on a closure of three or more nodes. Optionally note that lengthening one
   fixture's trunk to three nodes would make M2 and M3 discriminable (`{head}` vs `{head, mid}`) —
   an improvement, not a requirement for this ticket.

   No code change is required for this CR. Doc-only.

2. Same pass, small: `tasks.md` 2.1/2.2 say the guards were added to `PipelineRunRoutesSpec`; they
   live in `PipelineRunServiceSpec`. Correct the task text (or add a one-line note recording the
   relocation and why) so the artifacts describe what shipped.

### Non-blocking Suggestions

- `PipelineRunServiceSpec.scala:1114` and `:1143` — `tail.enabled shouldBe true` /
  `siblingOnOtherRoot.enabled shouldBe true` are tautological (the value was passed as
  `enabled = true` two lines earlier, so this can only fail if the repository silently rewrote it).
  They do serve a documentation purpose that the comment already serves better. Harmless; keep or
  drop as preferred. The real proof of non-degeneracy is the M1 red, which is present.
- The comment at `:1108–1111` explains that `tail.id.value` is referenced "only to keep the compiler
  from flagging it unused". With the `enabled` assertion present that justification is redundant;
  trim if the assertion stays.
- Consider a follow-up to lengthen one fixture's trunk to three steps, which would let a single
  fixture separate "wrong target" from "off-by-one at the terminal end" — the gap CR1 asks you to
  document rather than close.
