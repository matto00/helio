## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: `8e18ed5459814fdc43143f8411c04494ba36a8c2`. There are no code edits yet. The change dir is the only untracked content.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/compute-numeric-warning-gaps/HEL-1455`.
- **Owner rulings:** line 5 of the main checkout's `.concertino/runs/HEL-1455/events.jsonl` is `escalation.answered`, with `sub_answers ["warn","per-column","warn","warning"]` and `answer_source: human`. 4b stays a non-blocking warning (C1, D5, spec). I raise no objection to that.

#### Round-2 CR1 claims (tree-depth headroom)

| Claim | Where | Result |
|---|---|---|
| `MaxTreeDepth = 200` | design D6(c); proposal "What Changes" | present |
| Depth is the number of nodes on the longest root-to-leaf path, and a lone literal is 1 | D6(c); spec "Expression nesting depth is bounded" ("`1` + 200×`+1` has depth 201") | present and consistent |
| Production assumption: 1 MB stack | D6(c) "Stack budget" | present. I re-checked it: `backend/.sbtopts` holds only `-Dsbt.ivy.home`. `build.sbt` javaOptions, `infra/deploy-backend.sh` and the workflows set no `-Xss`/`ThreadStackSize`. The only `-Xss` hits are archived ps captures of the sbt launcher, which is not the server JVM. |
| Headroom test on a 512 KB thread, four depth-200 shapes, "lower the limit, never raise the stack" | D6(c); task 3.1 | present |
| Spec passes at depth 200 and fails at 201 | spec "nesting at the limits still works" (199×`+1` evaluates to `200`) and "one level past the tree limit is rejected" (200×`+1`) | present. These are the N / N+1 test pair, which also pins the leaf-counting convention. |
| Tree limit is in the proposal | proposal lines "reject … any parsed tree deeper than 200 levels" | present |

**Measured independently.**
- Setup:
  - the worktree classes at `backend/target/out/jvm/scala-2.13.15/helio-backend/classes` (HEAD 8e18ed545);
  - scala-library 2.13.15 and spray-json 1.3.6;
  - JDK 21.0.12 under `nice -n 19`, one cold JVM per row;
  - a scratch Java driver (`$SCRATCH/probe/Probe.java`) that calls `parseProblem`, `validate`, `inferType`, `numericContextTextFields` and `evaluate`, each on `new Thread(null, r, "p", stack)`.
- I ran the design's four shapes plus eight further shapes, which test whether the four are the real worst case. Each shape is depth 200 (100 nesting wrappers around a chain where applicable).

| Shape (depth 200) | 512 KB | Lowest passing stack I observed |
|---|---|---|
| flat `+` chain (design) | all OK | 288 KB (256 KB: `evaluate` SOE) |
| alternating `-`/`*` chain (design) | all OK | 192 KB |
| `abs(`×100 around a 99-op chain (design) | all OK, `evaluate` = 100.0 | 352 KB (320 KB: `evaluate` SOE) |
| `(`×100 around a 199-op chain (design) | all OK | 288 KB |
| `coalesce(`×100 | all OK | 256 KB |
| `if(true, `…`, 0)`×100 | all OK | 320 KB (288 KB: parse SOE) |
| `if(false, 0, `…`)`×100 | all OK | 320 KB |
| `-`×100 around `(chain)` | all OK | 256 KB |
| `concat(`×100 | all OK | 512 KB (256 KB: SOE). I did not sample between 256 and 512 KB for this shape. |
| `round(`…`, 1)`×100 | all OK | 352 KB |
| `not`×100 around a comparison | all OK | 288 KB (256 KB: `inferType` SOE) |
| `1+(`×99 right-nested chain | all OK | 288 KB |

- Every probed shape passed every consumer at 512 KB. The thresholds I sampled were 352 KB or lower: `abs` and `round` were the heaviest, failing at 320 KB and passing at 352 KB. That gives roughly 1.45x margin at the test's 512 KB and roughly 2.9x at the 1 MB production default.
- `concat` is the exception. I sampled it only at 128, 192, 256 and 512 KB, so its threshold lies somewhere between 256 and 512 KB, and its margin at 512 KB is not measured.
- The `abs` shape, which the design names, sits in the heaviest tier I measured. So the four named shapes are a reasonable stand-in for the worst case.
- Some readings were noisy. For example, `ifthen` overflowed in parse at 288 KB but passed at 256 KB in a different run. That is cold-interpreter variance. Every 512 KB reading in two sweeps was OK.
- The 4a/4b scans do not exist yet, so the test (which says "both scans") must cover them. That is the executor's job, and the "lower the limit, never raise the stack" instruction gives a defined path if they turn out heavier.

#### Round-2 non-blocking note claims

- **Inversion of NumericOpOnTextFieldWarningSpec:128: adopted.** Line 128 of `backend/src/test/scala/com/helio/domain/engine/NumericOpOnTextFieldWarningSpec.scala` is `"not warn for an unrelated column after a compute (trust is per step, design D5)"`. Task 3.2 names it as a deliberate inversion under owner ruling 2, with a comment.
- **4a mixed-trust suppression: adopted in design only, and spliced in badly.** See the non-blocking notes below.
- **Leaf counting pinned: adopted.** It is in D6(c), the spec requirement text and the 200/201 scenario pair.

#### Other checks

- The parser entry points are unchanged since round 2: `parse` is at `ExpressionParser.scala:274` and `parseLegacy` at `:278`. The recursion sites D6(a) names exist: `parseNot` at 113, `parseUnary` at 163, `parseArgs` at 168 and `parseFactor` at 180.
- There are no new placeholders, TBDs or scope drift, and every AC still maps to a task:
  - AC1: 1.1;
  - AC2/2b: 1.6;
  - AC3: 3.3;
  - AC4a: 1.3/1.4;
  - AC4b: 1.5;
  - AC5: 1.2/3.1;
  - AC6: 1.8/2.1/2.2;
  - AC7: 3.6;
  - AC8: Risks/C2.

### Verdict: CONFIRM

The round-2 blocker is closed. I measured the limit and the headroom proof myself, and they are achievable on the current consumers with a stated margin. Each change claimed for this round is present in the artifacts. The issues below are small, and the executor can resolve them in-flight without a design decision.

### Non-blocking notes

1. **The 4a mixed-trust rule contradicts the spec delta.**
   - D5's paragraph adds: "when a text-function argument also references any untrusted field, emit no `text-function-on-numeric-field` warning for that argument".
   - The spec requirement "Text function over a numeric field warns" says it SHALL emit for every trusted integer/float field in a numeric-inferring argument, so it requires a warning for `$n` in `length($n + $u)`.
   - No task or scenario tests the suppression.
   - Fix in-flight: add one sentence and one scenario to the spec delta, for example "`length($n + $u)` with `u` written by an earlier compute does not warn", and add the test to 3.2. The design's rule is the safer one, so follow it.
2. **The D5 text is spliced.** The 4a sentence was inserted in the middle of the 4b paragraph. As a result, "It is emitted for every valid compute step regardless of trust, because the literal's type is known" now follows the 4a sentence. It refers to `literal-type-mismatch`, not 4a, because 4a stays trust-gated per D4. Move the 4a sentence into D4.
3. **"Both scans" in the headroom test is ambiguous.** There are three scans: the numeric-context scan, 4a and 4b. Run the headroom test over all three.
4. **Optional extra test cases.** `concat(`×100 is the only shape whose threshold falls between 256 and 512 KB without a finer measurement. `round(`×100 matched `abs` as the heaviest shape at 352 KB. Adding a `concat(`×100 shape and an `if(`×100 shape to the headroom test costs nothing and covers the call-heavy evaluation paths (`foldLeft`, and the lazy `if`/`coalesce` iterator paths).
5. **Carried over:** the base spec says warnings are sorted by field name, but the code sorts by message (`AnalyzeSchemaWarnings.scala:155`). This is pre-existing and out of scope.
