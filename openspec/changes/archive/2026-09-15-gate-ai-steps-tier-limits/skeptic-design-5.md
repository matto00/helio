## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Cold spawn. Spawn-cwd guard: `assert-cwd.sh "/home/matt/Development/helio" "$WORKTREE_PATH" "$BRANCH"`
→ `READY ambient=/home/matt/Development/helio branch=feature/gate-ai-steps-tier-limits/hel-1108`
(ambient is an ancestor of `WORKTREE_PATH` — the normal spawn shape).

Live-resolved base, computed immediately before diffing:
`scripts/concertino/resolve-review-base.sh "$WORKTREE_PATH" main origin` → exit 0,
`0ce987459d101c726a0082ad330b2f5f624fa6d0`. `git rev-parse HEAD` =
`1e9c093093071e409f4ce66e342c3d483ac01395` (the SHA this report reviews; working tree clean).
`git diff --stat BASE...HEAD` = 12 files, 1375 insertions, **all markdown under
`openspec/changes/gate-ai-steps-tier-limits/`** — no production code. This remains a design gate.

Gate scripts:
- `npx openspec validate gate-ai-steps-tier-limits --type change` → `Change
  'gate-ai-steps-tier-limits' is valid`, exit 0.
- `scripts/concertino/check-constraints-carryover.sh "$WORKTREE_PATH" gate-ai-steps-tier-limits`
  → `OK`, exit 0.

### What I verified (with evidence)

**Round-4 CR1 (the D6 compiler claim) is FULLY resolved. I verified against the build, not the
briefing.** All four corroborations D6 now cites are true, and I reproduced the load-bearing
*negative* claim a second way because a negative is the easiest thing to get wrong:

- `grep` for `scalacOptions|Xfatal-warnings|-Werror|Wconf|Xlint` across **every** `.sbt` and
  `project/*.scala` in the tree (only `backend/build.sbt` and `backend/project/plugins.sbt` exist)
  → **ZERO hits**. This independently reproduces round 4's `sbt "print Compile/scalacOptions"` →
  empty result without paying for an sbt boot.
- CI runs plain `sbt compile test` — `.github/workflows/ci.yml:149`, exact.
- `scripts/check-scala-quality.mjs` has no exhaustivity rule (its only `match` hits are its own
  FQN regex at `:109-110`).
- So on Scala 2.13 `match may not be exhaustive` is a **warning** here. D6 now says exactly that,
  and the stale phrase "compiler forces" appears **ZERO** times in `design.md` and `tasks.md`
  (the only two hits in the whole change dir are `skeptic-design-4.md` quoting the old text).

The stated consequence is also exact. `StepExecutionException.from` is at
`InProcessPipelineEngine.scala:48-52` with `case iae: IllegalArgumentException` at `:50` and the
generic `case other => ... "step execution failed"` at **`:51`** — precisely as D6 pins it. A
`scala.MatchError` is not an `IllegalArgumentException`, so a missed arm does degrade to the
generic message and lose the limit + UTC reset AC2 requires. Both step files' matches are
`Unavailable`/`Guardrail`/`Api`/`Transport` + `Right`, at **`AnalyzeWithAiStep.scala:68-72`** and
**`GenerateTextStep.scala:67-71`** — the exact pins task 3.1 carries. `AiStepFailure` is a sealed
trait with exactly those four case classes (`AiStepClient.scala:22-29`).

Enforcement is now genuinely by test and genuinely falsifiable: 3.1 no longer claims a compiler
guarantee, new **3.1a** requires the verbatim-quota-message assertion with the mutation "drop one
step file's `QuotaExceeded` arm" and red output recorded per step file. I checked that this
mutation really can go red: `fail()` throws inside the `.map` on `ctx.aiClient.complete`, so the
dropped-arm case throws `MatchError` in the same position and surfaces as the generic message —
the assertion flips. The Risks table no longer rests on the false guarantee ("NOT mitigated by any
compiler guarantee ... exhaustivity is only a warning in this build"), and a scoped
`-Xfatal-warnings`/`-Wconf` change is explicitly considered and rejected for a held release.

**Re-check 1 — the D8 fail-closed enumeration and the `:710` backfill arm: ACCURATE.** I
re-derived the arms from `PipelineRunService.scala` rather than reading the table:

- `:684` `case allRoots if targetStepId.isEmpty =>` … `:694 else backend` / `:695
  .execute(pipeline, roots, Vector.empty, …)` — unambiguously the **source/root-level** arm,
  `Vector.empty` steps. D2/C11 mark it **not** AI-reachable. Correct. The guard pin is now
  **`:684`** (N12 applied; it was `:676`) — exact.
- `:706` `case Some(target) =>` … `:709 NodeDependencyClosure.closureOf(allSteps.toVector,
  target)` … `:710 backend` / `:711 .execute(pipeline, roots, slicedSteps.toVector, …)` — the
  **step/node** arm with a real closure. Marked AI-reachable. Correct.
- The AI-reachability split is right at all five sites: `:566` step preview passes
  `slicedSteps.toVector`; `:945` the real run passes `steps`; `:494` passes `Vector.empty`.
- The invisibility argument holds: `backfillOutputNode` `.recoverWith`s to `Future.successful(())`
  at **`:664-667`** (exact), and both backfill arms' `.recover` blocks only `log.error`. So an
  unthreaded `:710` under fail-closed (3.5c) would break every AI-pipeline step-bound backfill —
  including for uncapped `owner`-tier users — silently. `pipeline` is in scope from
  `findByIdShared` at **`:679`** (exact), reached from `:661` (exact).
- **C11 is byte-identical in substance in BOTH** `workflow-state.md` (`CONSTRAINTS`, `agreed_at:
  design-gate`) and `tasks.md` `## Standing Constraints` (differing only in `--` vs `—`), and the
  carryover script returns `OK`.
- **Evidence is demanded only where achievable.** 2.4a requires the falsifiable mutation at
  `:710` **only**; 2.4a-i covers `:694` for uniformity and states plainly that no AI step is
  reachable, no behavioural assertion can go red, and "Do NOT fabricate red evidence"; 2.4b
  requires the grep + five-site classification. That is exactly right, and is the round-3 defect
  properly closed rather than re-described.

**Re-check 2 — C10/D10, preview authorizing like `submit`: COHERENT against the code.**
`submit` (`:209-225`) resolves the grantee path through `findGrantRole` and permits only
`Some("editor")`, else `Forbidden`. `previewAtNode` (`:450-454`) matches `case Some(pipeline) =>`
after `findByIdShared` alone — **no grant-role check at all**. The asymmetry C10 closes is real,
and the drain is real because preview executes the target's full closure and D5 charges the owner.
`previewAtNode` **is** the single preview chokepoint: its only callers are `previewStep` (`:345`)
and `previewOutputs` (`:391`, `:410`), all delegating. The three D10 spec scenarios are behaviour
contracts, not implementation (viewer denied with zero calls and unchanged count; editor permitted
and charged to the owner; viewer preview of a no-AI closure unaffected), and 3b.2 names a mutation
(allow the viewer) that genuinely goes red. D10 also states the capability removal plainly rather
than dressing it as pure hardening.

**I audited EVERY task's verify clause for achievability, not just the changed ones** — 1.1–1.5,
2.1–2.5 (incl. 2.2a, 2.4a, 2.4a-i, 2.4b), 3.1, 3.1a, 3.2, 3.2a, 3.2b, 3.3, 3.4, 3.5, 3.5a, 3.5b,
3.5c, 3.6, 3b.1–3b.4, 4.1–4.3, 5.1–5.5. **All are satisfiable as written.** Spot-checks that
mattered:
- 3.5's "the build fails if the parameter is removed from a call site" is achievable — a missing
  required argument is a type error, not a warning (this is the one clause that superficially
  resembles the round-4 defect, and unlike exhaustivity it really is a hard error).
- 1.4's pins are real: the false claim sits at `PipelineCostEstimator.scala:21-23` ("Neither op is
  implemented/registered (HEL-1106/1107) ... tasks.md C3") and at
  `PipelineCostEstimatorSpec.scala:147-149`; the dangling `tasks.md C3` reference exists at both
  `PipelineCostEstimator.scala:23` and the spec's `:149`, so the grep verification is satisfiable.
- 5.4a's target is exact: the false claim is at
  `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md:224-225` ("`ClaudeClient`,
  which already enforces ... tier gating (`HELIO_BETA_DAILY_MESSAGE_LIMIT`)"), vs task 5.4a's
  "~line 225".
- D8's four construction sites are exactly the named four: `ApiRoutes.scala:328` plus
  `AnalyzeWithAiStepSpec.scala:62`, `GenerateTextStepSpec.scala:65`,
  `PipelineRunServiceAiStepClientWiringSpec.scala:131` — all exact, and the current signature
  `class ClaudeAiStepClient(client: ClaudeClient)(implicit ec)` confirms a required second param
  forces all four.
- The N6 val-init-order trap is real and the avoidance correct: `aiStepClient` declared at
  `ApiRoutes:322`, `chatAccessServiceOpt` at `:487-488`, `userRepo` a constructor param at `:78`,
  `dbContext: DbContext = null` at `:149` — so building the gate from `userRepo`+`dbContext`
  rather than the later val is the right instruction, and `Option(dbContext)` matches the
  established idiom at `:488`.
- N13 applied (3.2 / 3.2b split). N14 applied (3.6 names both `ClaudeAiStepClient` markers).

**Scope is bounded.** C5 holds: `ls | sort -V` on the migration dir gives
`V107__add_writeback_ops.sql` as the highest present and no DDL is proposed anywhere. C6 holds: no
frontend task exists, D9's no-forced-frontend conclusion is restated, and no HEL-1109 / HEL-1136 /
HEL-1135 scope is absorbed. D10 is scope this ticket's own change creates, not creep.

**Previously-confirmed items I spot-checked rather than re-derived** (per my brief): AC1 already
satisfied and the restraint correct (C9 — no change manufactured for it, tasks 1.1–1.5 are
confirm-and-comment-fix only); the `pipeline-analyzewithai-op` asymmetry; the writeback spec's
false claim; D3/D4/D5/D7/D9; the no-migration conclusion; and the structural claim that no
AI-reachable execution path exists outside `PipelineRunService` (re-spot-checked:
`AiStepRequest.ownerUserId` is still populated nowhere — `AnalyzeWithAiStep.scala:66` and
`GenerateTextStep.scala:65` construct with `instruction`/`content` only, so the gate is indeed
unreachable today). Nothing I read contradicts any of them.

### Verdict: CONFIRM

Plainly: **CONFIRM.** Round-4 CR1 is fully and accurately resolved against the build — the
correction is not merely reworded, it is true, and the enforcement it substitutes (3.1a's
verbatim-message assertion with a named per-step-file mutation) is genuinely falsifiable, which is
what the false compiler claim never was. Both items I was asked to re-check hold up against the
code: the five-site enumeration and its three-vs-two AI-reachability split are line-for-line
correct with `:710` correctly identified as the one backfill site that carries falsifiable
evidence, and C10/D10's viewer-drain ruling is coherent with `previewAtNode` still being the single
preview chokepoint. No task verification is unsatisfiable-as-written — including 3.5, the one clause
that resembles the round-4 defect but is a real type error. Scope is bounded: no migration, no
absorbed sibling-ticket scope.

The notes below are non-blocking. None of them makes an AC untraceable, a verification
unsatisfiable, or an implementation decision ambiguous; each is a comment/pin-accuracy item the
executor can absorb while implementing the tasks that already exist. I am deliberately not
escalating any of them into a change request: the defect classes that produced rounds 1–4 (a false
premise, a wrong arm label, an unsatisfiable verification clause) are genuinely cleared, and
manufacturing a sixth round over comment scope would be the wrong call.

### Non-blocking notes

- **N15 (the one I'd most like picked up — two now-false HEL-1108 markers task 3.6 does not
  cover).** `grep -rn "HEL-1108" backend/src/main/` returns six hits in four files. Task 3.6
  covers only the two in `ClaudeAiStepClient`. Two others become FALSE the moment this ticket
  lands:
  - `GenerateTextStep.scala:19-20` — "HEL-1108's tier/quota gating is deliberately NOT implemented
    here (tasks.md C1)". This also carries a dangling cross-ticket `tasks.md C1` reference, which
    is the exact defect class task 1.4 fixes for the cost estimator.
  - `AiStepClient.scala:15-16` — "HEL-1108's tier/quota check is the first consumer of this field
    -- not implemented here, this ticket only carries it through."

  (`PipelineCostEstimator.scala:8`'s HEL-1108 mention stays true and needs nothing.) Widening
  3.6 to "every now-false HEL-1108 marker in `backend/src/main`, verified by grep" is a one-line
  change and makes 3.6's own grep verification actually mean what it says. Worth doing precisely
  because design.md's own Context argues that a confidently-false comment is *why* these steps
  shipped ungated.

- **N16 (the two step specs will need `ownerUserId`, not just the new gate param).** Once 2.3
  populates the request from the context and 3.5c denies `ownerUserId = None`,
  `AnalyzeWithAiStepSpec:62` and `GenerateTextStepSpec:65` — which construct
  `PipelineExecutionContext` directly, leaving `ownerUserId` defaulted `None` — will be DENIED and
  go red unless they also set an owner on the context. 3.5a's "all three specs pass" forces the
  executor to discover and fix this, so nothing is unsatisfiable; naming the consequence in 3.5a
  would just save a debugging cycle.

- **N17 (minor pin drift, all unambiguous by description).** Every pin I checked resolves to the
  right construct, but four are a line or two off: task 3.6 cites the scaladoc marker as `:14-19`
  and the inline comment as `:21-23`, whereas they are `:13-15` and `:19-21`; design.md's backfill
  `.recover` ranges `:693-698`/`:711-717` are actually `:697-699`/`:719-721`; D10 cites
  `previewAtNode` at `~455` (tilde-qualified) where the definition is `:450`; and 1.4 cites the
  spec comment as `:147-148` where it spans `:147-149` (the dangling ref is on `:149`, still inside
  "that same comment" as 1.4 says). Each target is identified by quoted text or by name as well, so
  none misleads — but C11-adjacent pins are what future rounds trust, so they are cheap to true up
  while N15 is being applied.
