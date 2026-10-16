## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit `db8ade2f2da521f36004ec65bdcb8eaefc3a69b0`. It sits on `d179fe039` and `d2081b3c7`; the diff base is `83cbfc022`. This cycle re-evaluates the change requests from evaluation-2.md.

### Fresh gate runs (my own, in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| lint / format:check / typecheck / frontend build / check:scala-quality | all exit 0 |
| `npm test` (2 workers, nice 19) | 524/524 root; 8351/8351 frontend (644 suites) |
| `sbt testOnly PipelineStepParitySpec ComputeExpressionFunctionsSeamSpec` | 684 succeeded, 0 failed (hel1468 guard: failed=0) |

I did not re-run the full `testFull`. The cycle-3 diff touches no backend file, and every backend change across the ticket is test-only. The targeted oracle spec was re-run fresh.

### Verification of the cycle-2 change requests

- **CR1 (sorted fold): resolved.** `scalaMapKeyOrder` now sorts four or fewer keys with JS default `.sort()`. That compares UTF-16 code units, which is the same as Java `String.compareTo`. Five or more keys still use CHAMP hash order.
  - **The three probes from evaluation-2 now match the oracle on a fresh `tsc` build of db8ade2f2.** Each config is accepted (`clientEvaluable` → ok):

    | Config | Client output | Oracle output |
    | --- | --- | --- |
    | `{"b":"c","a":"b"}` | `[{c:1}]` | `[{c:1}]` |
    | `{"9":"x","10":"x"}` | `[{x:"n"}]` | `[{x:"n"}]` |
    | `{"z":"t","m":"t"}` | `[{t:"zv"}]` | `[{t:"zv"}]` |

  - The same three cases are now `rename.json` vectors that the Scala oracle asserts (green). The two former `clientDeclines` vectors are now `rows` vectors whose expectations are unchanged from the oracle-recorded `scalaRows`.
  - **Mutation:** restoring text order (`return [...keys]`) turns 4 rename tests red. Evidence: `.concertino/runs/HEL-1581/evidence/eval3-rename-probe-and-mutation.txt`.
- **CR2 (withdraw `integerLikeColumnName`): resolved.** The decline, the reason in `steps/types.ts`, the design.md Decision 2 bullet and the manifest note are all removed. A grep over the evaluator, the corpus, the parity specs and the change's design/tasks/proposal/specs finds no remaining "insertion order", "text order" or `integerLike` claim. The only hits are vector names and notes that state the sorted/hash behaviour correctly, or say "not text order".
- **CR3 (re-audit): holds.** The only map-valued step configs in Scala are `CastConfig(casts: Map[String, String])` and `RenameConfig(renames: Map[String, String])`.
  - `cast` entries each cast their own field. Keys are unique, so the cast is order-independent.
  - On the client, the only config objects iterated by key are `cast.ts:88` and `rowOps.ts:30`. The other `Object.keys` sites operate on row objects and are set-based (`combine.ts`), sorted (`rowOps.ts` dedupe), or affect only column order, which is not compared (`aggregate.ts:260`).
  - The design.md Risks entry and the tasks.md amendment now state this accurately.
- **The skipped fixed TimSort test (my cycle-2 non-blocking suggestion).** The executor's stated reason is inaccurate: the expected order did not have to come from the port. It could be generated once from the JVM, as my probes did. The skip is still acceptable. The 40- and 64-row window vectors and the 200-row throw vector already pin the port to oracle-derived Java behaviour, and reverting to the native sort turns them red (evaluation-2). The extra test would be redundant. No action is required.

### Phase 1: Spec Review — PASS
Issues: none.
- All acceptance criteria are met.
- CONSTRAINTS C1–C5 are honoured. C3 is met now that the window ordering and the rename order are exact rather than approximated.
- The planning artifacts reflect the final behaviour.

### Phase 2: Code Review — PASS
Issues: none. The cycle-3 diff is minimal: one sort, the removal of the decline, and doc and vector updates. No dead code or unused imports remain (lint is clean).

### Phase 3: UI Review — N/A
There is no rendered surface. Nothing outside `frontend/src/features/pipelines/evaluator/` imports the evaluator (C2).

### Overall: PASS

### Non-blocking Suggestions
- None new.
