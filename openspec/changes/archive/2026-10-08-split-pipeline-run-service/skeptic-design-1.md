## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, checked against `PipelineRunService.scala` at
HEAD `4db9730fd0907a4d769b7a0b80082ac260d499d6`. The change dir is untracked, and no code has changed yet.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-run-service/hel-1371`.
- **File facts:** the file is 1770 lines (`wc -l`). The class spans 38-1695, the companion 1710-1744, `CachedRunStatus` 1748-1754
  and `TriggerSource` 1765-1770. All of these match design.md.
- **Member inventory is complete.** I listed every class-body `def`/`val` with a grep, read the full file, and found 45 members plus
  the `require`. Each one is assigned exactly once by D1 or D2. Every D2 line range is correct, doc comments included. One
  boundary detail: Backfill's range 664-809 starts at a blank line.
- **Pinned claims hold:**
  - `Forbidden(` producers are at :271 (`submit`) and :615 (`previewAtNode`). Both stay in the entry point under D1.
  - HEL-1374: `guardClock.now()` is read only at :1048.
  - HEL-1370: `queued`/`running` are published at :1086-1087, after admission. The write-back `recoverWith` is at :1314-1322.
  - HEL-1366: `publishTerminalAfter` is at :997-1003.
- **The dependency graph is acyclic and matches D4's order.**
  - Support depends on no other collaborator.
  - Terminal depends on Support.
  - Succeeded depends on Terminal and Support.
  - Executor depends on Support, Terminal and Succeeded.
  - Backfill depends on Support.
  - Queries depends on nothing.
  - The entry point depends on Support and Executor.
  - No pair calls each other in both directions, so constructor wiring by value works.
- **D3 compiles in Scala 2.13.15.** `build.sbt:4` pins 2.13.15, and it has no `scalacOptions`, so there is no `-Werror` or
  `-Wunused` (an unused leftover `log` or import only warns).
  - A class parameter is a stable identifier, so `import terminal.{...}` is legal.
  - `publishTerminalAfter`'s by-name `writes` is unchanged because its signature moves verbatim.
  - The only default argument on a moving private member is `executeRun`'s `triggeredByTokenId`. Its only caller,
    `runPipeline`, moves to the same class.
  - Every class keeps its own `log`, so `log` is never imported and cannot become ambiguous.
  - The only name-clash risk is delegations. If `backfillOutputNode`/`latestRun`/... were *imported* into the entry point,
    they would clash with the entry point's own defs. D1/D3 already call these one-line receiver-qualified delegations, so
    that is fine.
- **D4 initialisation order is sound.** `engine` eta-expands `urlFetchSeam`, a def, which is unchanged. `system` is still read
  lazily inside `urlFetchSeam`, which stays in the entry point. Collaborators declared after `backend` receive a non-null
  `backend`.
- **D5 logger:** the original is `getLogger(getClass)` at :118 on a `final` class, so it is identical to
  `classOf[PipelineRunService]`. Both log-capture specs assert positive counts:
  - `StepConfigInvalidRoutesSpec:208-212,277-278,292-293` (`count(WARN) shouldBe 1`, message content);
  - `UpsertTargetWritableRoutesSpec:322-323`.
  - So D6c's red run is genuinely failable for the Support logger, which is where `logExecutionFailure` goes.
- **Source-scanning guards:** I searched every `Files.walk`/`readAllLines`/`fromFile` test and every `scripts/*.mjs` checker.
  - `ExistenceNotLeakedRoutesSpec.forbiddenProducerCounts` (:488-492) pins `"PipelineRunService.scala" -> 2` (:528). D2
    satisfies this.
  - `filesCallingAccessHelpers` (:480) is not affected: the file calls no `requireOwnerOnly`/`requireAccess`/`authorizeResource*`.
  - `RestSourceConstructionSiteSpec` matches `RestSource\(`. The only hit is the comment at :368, and its text
    `RestSource (` has a space, so it does not match.
  - `SqlEgressSocketFactoriesSpec`, `SchemaFieldStructuralGuardSpec`, `RouteTestBaseGuardSpec`, `CredentialSurfaceEnumerationSpec`,
    `ShareTokenGenerationSpec` and `check-node-root-encoding.mjs` do not target this file. The `.mjs` script only mentions it
    in a comment.
  - No test uses `PrivateMethodTester`/`invokePrivate`/reflection against this class. The grep found hits only in storage and
    `ClaudeConfig` specs.
  - Design.md names the guards that matter, and I found none it missed.
- **D6b checked empirically. It fails as written; see CR1.** I ran `javap -public` on a compiled `PipelineRunService.class`
  from a sibling worktree build at d2601e258, the parent of base. Base touched only a test spec. Copy:
  `scratchpad/javap-prs-hel1283.txt`. The output has 300 lines:
  - **258** `public static final ... $anonfun$...` lambda-body methods. Scala 2.12+ emits a lambda body as a public static
    method in the class whose method contains the lambda.
  - Name-mangled public members: `com$helio$services$pipelines$PipelineRunService$$ec`, `$$log`, `$$logExecutionFailure`,
    `$$executionFailureError`, `$$onWriteBackFailure`, `$$isBinaryRefShape`.
  - Per-member `$anonfun$<name>$` counts for members that move:
    - `onUnblockedRunSuccess` 55, `persistBackfilledRows` 16, `evaluateNodeRowsForBackfill` 11
    - `executeRun` 9, `backfillOutputNode` 9, `history` 8, `onBlockedRun` 8
    - `truncatedReadsToJson` 7, `onRunSuccess` 7, `parseTruncationRecord` 5
    - `truncationFields` 4, `resolveAllRootDataSourcesInternal` 4, `runPipeline` 4, `executeRunFailure` 4, `executeRunSuccess` 4
    - `onDryRunSuccess` 3, `extractBinaryRefs` 1
    - That is at least 159 public synthetic methods that will leave `PipelineRunService.class` when the bodies move. The
      behaviour is deterministic compiler output, not a flaky reading.

### Verdict: REFUTE

### Change Requests

1. **D6b / C5 (design.md D6b and Standing Constraints C5; tasks.md C5, 1.2, 3.2): the "`javap -public` diff must be empty"
   signal cannot pass.** The split guarantees a non-empty diff: at least 159 `$anonfun$<movedMember>$N` methods and several
   `com$helio$...$PipelineRunService$$<member>` mangled accessors disappear. As written, the executor will either fail an
   impossible gate or loosen it on the spot without review. Revise C5 and D6b to define a precise comparison. Either:
   - filter both before/after dumps by removing every line containing `$anonfun$`, `$deserializeLambda$` or `$$`. Require
     the filtered diff to be empty, and list the removed `$$` members, which are expected and named. Or
   - compare only the API surface explicitly: public non-synthetic constructor and methods, `$lessinit$greater$default$N`,
     `submit$default$N`, and the companion/`CachedRunStatus`/`TriggerSource` members.

   Either way, add a red run that proves the filtered comparison is failable. For example, temporarily change one
   constructor default or drop `submit`'s `triggerSource` default, and show the filtered diff go non-empty.

2. **AC1 deviation not recorded (design.md Planner Notes, D2).** The ticket's first AC says "the terminal persist-then-publish
   paths live in `PipelineRunTerminalWrites`". D2 moves the main HEL-1366 terminal path, `onUnblockedRunSuccess` (publishes
   `succeeded` via `publishTerminalAfter`, :1642), into `PipelineRunSucceededWrites` instead. The Planner Notes claim the plan
   "keep[s] the ticket's names and seam". For this path that is not accurate. The size rationale is sound: Terminal plus the
   succeeded chain would be about 450 lines. But the deviation must be stated explicitly, so the final gate does not have to
   reinterpret the AC:
   - name the deviation and its rationale in design.md;
   - state which file now holds each terminal publish: `executeRunFailure`, `onDryRunSuccess`, `onWriteBackFailure` and
     `onBlockedRun` in Terminal, `onUnblockedRunSuccess` in Succeeded, and the `publishTerminalAfter` mechanism in Terminal;
   - commit to flagging it in the PR body as a deviation from the AC's literal wording.

3. **D6a: make the move check exhaustive in both directions.** As worded, it byte-compares each inventoried member against its
   new location. It does not require that every line of each new file is either inside a moved member's span or in the
   enumerated non-move list. So an added helper or an edited scaffolding line could go unreported, which is exactly what the
   "every non-move changed line is listed" AC forbids. The checker must also fail on any unaccounted line in the seven
   resulting files. The red run should then cover two cases: one changed token in a moved body, and one stray added line in
   a new file.

### Non-blocking notes

- **D6c/C3:** the logger red run only exercises Support's logger, the one the two specs capture. Terminal, Succeeded,
  Executor, Backfill and Queries all log. Examples: `onWriteBackFailure:1362`, `onRunSuccess:1319`, `onUnblockedRunSuccess:1578/1587/1625`,
  `backfillOutputNode:725`, `parseTruncationRecord:959`. No test captures their loggers. Add a mechanical grep to the
  evidence asserting that every new file's logger declaration is exactly `LoggerFactory.getLogger(classOf[PipelineRunService])`,
  or that the class receives the entry point's `log`.
- **Stale cross-references:** two references in moved doc comments will dangle after the move, and D3 forbids fixing them:
  - `truncatedReadsToJson`'s doc (:214) links `[[PipelineRunService.parseTruncationRecord]]`, which moves to Queries.
  - `recordUnrunnable` (:285) says "Mirrors `onBlockedRun`'s persistence pattern below", and that member moves to another file.

  D3 permits fixing positional words such as "below". Scaladoc link targets are not in D3's list, so record these as
  follow-up candidates in 3.6 instead of editing them silently.
- **Line-count expectations:** the entry point keeping lines 1-118 plus preview logic will land around 640 lines. That is
  accepted in D1, and the soft-budget warning from `check-scala-quality.mjs` is non-fatal.
- **Delegation spelling:** D1's one-line delegations must be receiver-qualified (`queries.latestRun(...)`). Importing those
  names would shadow or clash with the entry point's own public defs. design.md implies this but could say it outright.
