## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `6c4a2c8a9cfe9f31ff307be5b1dc49a637ab892b` (on `854a52a9e`; base `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec`, resolved live).
This run replaces the cycle-2 evaluator that was killed at about 05:20Z. That run did leave partial evidence, in
`evidence/.eval2-tmp/` and `scratch/HEL-1630/eval-mut/`. I used it only as a pointer and re-ran everything I cite here.
The worktree was clean when I started (`git status --short`, `--ignored` included): no leftover mutation.
My evidence (persisted) is in `E = /home/matt/Development/helio/.concertino/runs/HEL-1630/evidence/.concertino/eval2-evidence/`.

C5 is verified: `events.jsonl` line 37 is `escalation.answered` with `answer: accept-2`, `answer_source: human` and id
`HEL-1630-1792295999711-528bb8` (line 38 is the dashboard copy). I did not hold the code to cycle 1's bound of 3.

### Phase 1: Spec Review — FAIL

What holds:
- **CR2 is fixed.** A mid-node abort now logs `aborted-after-N-of-4` at INFO with no WARN.
- **CR1's starvation is fixed.** The two-stage gate takes the running slot only after the bounded read
  (`DraftPreviewRoutes.scala:92`), and there is a separate reading pool of 4 x maxInFlight.
- **The owner's third-request behaviour is defined and tested.** A third request gets an immediate `429 {"message":"Draft preview busy"}`
  with `Retry-After: 1`, in under 2 s, with no queue (`DraftPreviewAdmissionSpec`). The reading-pool bound returns the same 429
  (`DraftPreviewReadingPoolSpec`).
- **Per-principal 2 is restored** (`DraftPreviewConfig.scala:31`). The spec (`spec.md:111`) and `CLAUDE.md:71` match the code.
- **The budget arithmetic is in design.md.**
- **Constraints.** C1, C2, C3 and C4 still hold (no regression in the full suite). Runs and the saved preview are unchanged:
  `retainOnly` defaults to `None`, and the only caller that sets it is `DraftPreviewService.scala:193`. The `trunkRows` fallback
  rewrite is equivalent whenever every frame is kept.

What fails:

1. **Spec divergence: the heap bound does not measure the worst shape any more.** The owner's accept-2 rested on a premise that is
   false. D7 sizes the default by "the heap one worst-shape request keeps alive". Cycle 2 kept D7's fixed shape, which is a
   50-step linear chain. Under frame release a chain is the *best* case, because it holds about one frame. Evaluation-1 asked for
   that fixed shape, so this is partly my own instruction, but the conclusion drawn from it is wrong.

   I wrote a probe with the same method (gc x2, hold on the last node, 3 runs, body at the 4 MiB cap, `-Xmx3g`) and a legal
   "comb" shape:
   - `s0` lane join gives 20,000 rows.
   - A 24-step compute spine hangs under it.
   - Each spine node has one compute leaf, for 49 steps in total.
   - The spine child sits at the higher position. `structuralRank` visits that first, so the whole spine runs before any leaf, and
     every spine frame is still needed at the last spine node.

   Result: chain **82.6 / 79.1 / 79.0 MB** (this reproduces the executor), comb **127.7 / 126.4 / 126.3 MB**.
   `floor(192 / 127.7) = 1`. Two comb requests in flight would hold about 255 MB, a third of the 768 MB prod heap, against a
   192 MB budget.
   - Evidence: `E/probe-comb-heap.log` (lines 253-254) and the probe source `E/EvalTmpCombHeapSpec.scala`. The probe file was added
     temporarily and deleted after the run; the tree was clean afterwards.
   - The killed evaluator's partial logs show other shapes at 126 / 161 / 191 MB (`evidence/.eval2-tmp/eval2-probe-*-heap.log`). I did
     not rebuild those shapes, so I cite them only as corroboration.

   This makes three claims false:
   - design.md: "the floor is one frame ... so release cannot go lower" and "measured worst-case peak 82.3 MB".
   - `DraftPreviewConfig.scala:16-21`: the same claim, in a comment.
   - `CLAUDE.md:71`: "the measured worst-case request (82.3 MB)".

   The escalation text the owner answered said the same thing ("further frame release cannot help"). The spec asserts
   `DefaultMaxInFlight == formula` on a shape that is no longer the worst one, so it stays green while the real bound fails.

### Phase 2: Code Review — FAIL

Gates, run fresh by me in `WORKTREE_PATH` at `6c4a2c8a9`:
- `sbt testFull` (flock, nice 19, `-Xmx3g`): 9285 run, 0 failed, 4 canceled (the existing `HELIO_MEASURE` specs). Log:
  `E/gate-sbt-testFull.log`.
- `npm run lint`, `format:check`, `typecheck`, `check:scala-quality`, `check:openspec`, `check:spec-structure`, `check:schemas`: exit 0.
- `npm test` (2 workers): 730 suites, 9124 tests, all pass; the root jest has 61 suites and 524 tests.
- `npm --prefix frontend run build`: exit 0.

My mutation spot-checks (C3). Each was applied by a script that refuses an ambiguous match and restores the file byte for byte
(sha256 verified after each run). All four went red:
- **M1, a new mutation: frame release over-releases parents.** I dropped `parentKey(s)` from `releaseConsumed`'s `needed` set. That
  matters because `parentFrame`'s silent `getOrElse(rootFrames.head._2)` would otherwise hide a wrong release. Four specs went red
  (`DraftPreviewStreamSpec` rows step, `DraftPreviewCapsSpec` x2, `DraftPreviewHeapSpec`), so release correctness is covered.
  `E/red-eval2-m1-parent-overreleased.log`.
- **M2: the CR2 `!cancelled.get()` guard is removed from `onFrame`.** The mid-node-abort test fails with `outcome=failed`.
  `E/red-eval2-m2-cr2-cancelled-check-removed.log`.
- **M3: the running bound is removed** (`> maxInFlight` becomes `> Int.MaxValue`). The third request gets `200 OK was not equal to
  429` (`DraftPreviewAdmissionSpec.scala:64`). The trickle test then fails too, as a cascade: the failed test never releases its
  held slots. `E/red-eval2-m3-running-bound-removed.log`.
- **M4: the running slot is taken before the read.** The trickle test fails with 429 instead of 200 (`:82`).
  `E/red-eval2-m4-running-slot-before-read.log`.

I also checked each executor red log in `evidence/README.md`'s cycle-2 table. All of them fail for the named reason. However,
`red-cr1-instance-slot-taken-before-read.log` (`:35`, `:49`) and `red-c5-third-evaluation-gate-removed.log` (`:69`) cite line numbers
that do not match the committed spec (`:30`, `:44`, `:64`), so they were captured on an earlier spec revision. M3 and M4 above
re-establish both proofs on the final text.

Issues:

2. **Mechanical, CI-breaking, and it corrupts evidence: `DraftPreviewHeapSpec.scala:86-87` writes to a hard-coded
   `/home/matt/Development/helio/.concertino/runs/HEL-1630/evidence/heap-measurement.txt`.** The spec is not gated (it is not one of the
   `HELIO_MEASURE` specs), so it runs in every `sbt testFull`.
   - On a CI runner `/home/matt` does not exist and is not creatable, so `Files.createDirectories` throws and the suite goes red.
     This was already in cycle 1, and evaluation-1 missed it.
   - The file is written **before** the assertion, so any run overwrites the evidence file, mutated runs included. This happened
     during my own review: my M1 run overwrote `heap-measurement.txt` with `13.5 MB / default 8` at 22:34. My unmutated `testFull`
     rewrote it at 22:48 (`80.1, 80.2, 80.6`, so 2).
   - Before my run the file already held 80.2 MB, not the 82.3 MB the README and design.md cite. The executor's original
     measurement had already been overwritten, most likely by the killed evaluator's 22:09-22:21 `testFull`. So the 82.3 figure
     no longer has a self-authenticating source; only the green-cycle2 log carries it.

3. **Readability: `DraftPreviewRoutes.scala:69` has `busy(ctx)` at column 0**, inside a `case` arm. There is no scalafmt gate,
   so fix it by hand.

Otherwise the code is clean:
- **Gate.** The stage CAS handles release-before-run and run-after-release. Over-limit `tryAcquire` undoes both counters, and the
  route's `startRunning` refusal returns through `inFlightSlot`, which releases the permit.
- **`onError`'s early `return`.** It sits in a plain `def`, not a lambda, so it is not a non-local return.
- **Engine.** The change is draft-gated, and `trunkRows` is unchanged for runs.
- **Standards.** No CONTRIBUTING [mechanical] violations besides #2.

Known and accepted (C5, not a finding): with instance 2 and per-principal 2, one dragging user (a superseded request plus the
next one) can hold both running slots for the length of an evaluation, so other users get the 1 s `Retry-After`.

### Phase 3: UI Review — N/A

No UI is wired by this change (HEL-1631 does that). The frontend diff is a service and its types only. The full jest suite and the
build are green.

### Overall: FAIL

### Change Requests
1. **Measure the real worst shape under frame release, then make the bound hold for it** (`DraftPreviewHeapSpec`,
   `DraftPreviewConfig.scala:16-22`, design.md D7 and the executor notes, `CLAUDE.md:71`).
   - (a) Add a worst-retention shape to the heap spec, next to the chain: at least the comb in `E/EvalTmpCombHeapSpec.scala`, and
     think adversarially about others (lane rejoins referencing early nodes, several roots). Assert the formula on the **max** over
     the shapes.
   - (b) Bring that max to 96 MB or less (floor 2), without touching C4's 20,000 or C5's 2. A draft-only ready-node order that
     prefers a node whose evaluation lets frames be freed (finish a node's leaf children before descending) would turn the comb
     back into about two frames. If the spec's step-line order depends on evaluation order, check that it stays deterministic and
     documented.
   - (c) If no change within C4/C5 gets the true worst under 96 MB, **escalate to the owner again with the corrected numbers**. Do not
     ship. accept-2 was ruled on "82 MB is the worst and release cannot help", which is false.
   - (d) Correct the three false statements listed in Phase 1 issue 1.
   - Proof: the comb shape goes red against the current release rule, and green after the fix.
2. **`DraftPreviewHeapSpec.scala:86-87`: remove the hard-coded `/home/matt/...` write.** Either write the report only when an env var
   names a target dir (for example `HELIO_EVIDENCE_DIR`, a no-op when unset, so CI is unaffected), or keep it to `info(report)` and
   capture the evidence from the test log. Also write it only **after** the assertion passes, so a mutated run can never overwrite
   the evidence. Then regenerate `heap-measurement.txt` from an unmutated run and make the README and design.md cite that file's
   own numbers.
3. **`DraftPreviewRoutes.scala:69`: indent `busy(ctx)` under `case None =>`**, or put it on the same line.

### Non-blocking Suggestions
- Re-capture `red-cr1-instance-slot-taken-before-read.log` and `red-c5-third-evaluation-gate-removed.log` against the committed spec,
  so the cited line numbers match. M3 and M4 here already prove the same thing.
- `DraftPreviewAdmissionSpec`: release the held latch in a `finally`, so one failed test cannot cascade into the next (seen under M3).
- `DraftPreviewHeapSpec`'s doc comment and report text still say "every frame alive" and "all 50 frames alive". Under release that
  is no longer true.
- `DraftPreviewReadingPoolSpec`'s poll loop proves that *some* probe is refused, not that the 5th one is. Consider asserting
  `gate.inReading == 4` before the probe.
- `parentFrame`'s `getOrElse(rootFrames.head._2)` (engine `:508`) hides a missing parent frame. In draft mode, where frames are now
  released, a missing parent should fail loudly. M1 shows that the current specs catch it, but only indirectly.
- From evaluation-1, still open: reject a stream that ends without a terminal line.
