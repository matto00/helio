## Context

Post-HEL-1384 / post-HEL-1393 (#888) tidy. HEL-1393's evidence (`.concertino/runs/HEL-1393/evidence/openspec/changes/
move-pipeline-preview-out/skeptic-final-1.md`, non-blocking notes) is the source for items 5–9.

## Goals / Non-Goals

**Goals:** every label, name and comment touched is true against the live tree; zero behaviour change.

**Non-Goals:** splitting PipelineRunService.scala; touching PipelineAnalyzeService (HEL-1385).

## Decisions

D1 — Item 3, split in half. (Revised after skeptic-design-1 REFUTE item 1.)
- PipelineRunService half: superseded. The ticket said "check overlap with HEL-1393 first and combine if they collide";
  they collided and #888 moved preview out (652 -> 386). No further split here. 386 still exceeds CONTRIBUTING.md:24's
  ~250 soft budget; acknowledged, not acted on — the ticket's stated trigger for this file (">400") no longer holds.
- PipelineSchedulerService half: IN SCOPE. The ticket names it at 314 lines and asks for the split; 314 exceeds the
  ~250 soft budget. Seam: auto-run debounce claim-and-fire (`processAutoRunDebounce`, `processAutoRunClaim`,
  `fireAutoRun`, today ~:125-192) moves to a new `private[pipelines] final class PipelineAutoRunDebounceFirer` in
  `PipelineAutoRunDebounceFirer.scala`, in the HEL-1371/#847 collaborator style (cf. `PipelineRunBackfill`). Cron
  schedule firing (`processCandidate`, `processOne`, `fire`, `gatedSubmit`, `nextFireTimeLogged`, the in-flight guard)
  and `tick()` stay in PipelineSchedulerService.
- Behaviour-preservation rules for the split:
  a. PipelineSchedulerService's PUBLIC constructor signature, defaults, `require` checks and `tick()` are unchanged, so
     Main.scala and every spec construction site are untouched. The scheduler builds the firer internally (only when
     `autoRunDebounceRepo != null`, keeping today's no-op when unwired) and `tick()` calls it in the same position.
  b. The firer's logger is `LoggerFactory.getLogger(classOf[PipelineSchedulerService])` — the same logger name —
     because FireTimeRunConfigGateSpec:212 attaches a ListAppender to that name; every log message string, level and
     argument is byte-identical (the "PipelineSchedulerService: ..." prefixes stay).
  c. Any state the moved code reads (e.g. the in-flight guard, if used) is passed in, not duplicated; a second copy
     of a guard set would be a behaviour change. The executor states which members the moved code references.
  d. Code moves verbatim except for the receiver of collaborator calls; the diff of moved bodies is shown as a pure
     move (e.g. `git diff --color-moved` or a body-by-body diff in the evidence).
  e. Neither file touches PipelineAnalyzeService (HEL-1385).

D2 — Item 1 is proven, not assumed. Check out 1bf11f55 (parent of 99d6fedd) in a throwaway detached worktree in the session
scratchpad (/tmp/claude-1000/..., as HEL-1384's evaluator did; never the delivery worktree, main checkout root or ~), copy in the CURRENT FireTimeRunConfigGateSpec, and run only that suite.
The header says the spec uses literals so it compiles on main; if it does not compile there, record the compile error
and the minimal shim needed — a compile failure is not "red". Relabel a test red-first only if it FAILS ON AN
ASSERTION there; a test that passes there stays GUARD and the ticket's claim is reported as wrong. The header
paragraph (lines ~39-42) and the group heading/section banner (~344, ~386) are updated to match. The third test in
the "fire-time evaluation error" group (2.4a) is classified by the same run, not by assumption. A test that errors with an
uncaught exception rather than an assertion failure is classified explicitly (reported, not defaulted to GUARD).
HEL-1384's prior run (.concertino/runs/HEL-1384/evidence/eval1-red-on-main-FireTimeRunConfigGateSpec.log) is
corroboration only; the fresh run is required. Remove the throwaway
worktree by its exact path afterwards.

D3 — Test renames (item 5; revised after skeptic-design-1 REFUTE item 2). Only string literals in describe/it names
change; assertions and bodies are untouched. Convention: "<entry point the test actually calls> (<current owner of the
member it exercises>)", e.g. `PipelineRunService.submit -> PipelineRunExecutor.executeRun (...)`-style wording, decided
per title by READING THE TEST BODY'S CALLS, not by grepping for the `def`. A title whose named entry point is still the
public member the tests call (e.g. `PipelineRunService.previewStep`, still a public delegator at PipelineRunService:262)
keeps that name and only gains the owner in parentheses — or stays unchanged if already accurate; the executor records
per-title what each test calls. The ~:2144 comment quotes, verbatim, the title of a describe block HEL-904 deleted: the
quote stays verbatim and gets an appended note naming the member's current owner (e.g. "`onUnblockedRunSuccess` now
lives in PipelineRunSucceededWrites"); it is never rewritten into a title that never existed.

D4 — Deletion (item 6) only if `grep -rn findPrimaryDataSourceIdInternal backend frontend helio-mcp` shows no call
site outside its definition and doc comments, and `sbt compile Test/compile` succeeds after removal. Doc comments that
reference it ([[findPrimaryDataSourceIdInternal]] in PipelineRepository, comments in PipelineService) are rewritten
to the surviving sibling or to historical phrasing, not left dangling.

D5 — Archived note (item 7): the archived forbidden-classification.md never stated a numeric per-file pin; what is
stale is line 52, attributing step-preview `authorizedForAi` to `PipelineRunService`. Append a dated post-#888 note
(do not rewrite the original line) stating that `authorizedForAi` now lives in PipelineRunPreview, and the current pins
from ExistenceNotLeakedRoutesSpec:529-530 (`PipelineRunService.scala -> 1`, `PipelineRunPreview.scala -> 1`). Do not
claim an old count was there.

D6 — "Defaulted to `None`" (item 8): for every hit (OutputProtocol:27, model.scala:860, DataSource:56,
NodeSnapshotRepository:170, OutputRepository:197, PipelineStepRepository:434), check the parameter actually has
`= None`. True ones stay; false ones get the HEL-1393 wording ("Required (no default)"). Record the per-hit verdict.

D7 — Item 9 wording: say what `None` means AND that production callers pass the Output's own root, only if both
sites read that way after checking callers.

D8 — Item 4: search git log/MISTAKES.md/test sources for prior instances of audit-assertion bleed across tests. Add a
MISTAKES.md line only with at least one concrete second instance; otherwise record the reasoned skip in the PR body.

D9 — Behaviour proof: `nice -n 19 sbt -J-Xmx3g testFull` on base (2fb8deb5) and on head, per-suite counts compared. Known flake
HEL-1439 (AutoRunGuardBurstProofSpec): re-run once; twice-failing is investigated.

## Risks / Trade-offs

- HEL-1385 may touch shared imports in PipelineRepository/PipelineService; whichever merges second reconciles.
- Editing an archived openspec doc is unusual; D5 appends only, and the live spec's withClue asks for it.

## Planner Notes

- D1 was first self-approved as a full drop; skeptic-design-1 refuted the scheduler half, now in scope. Including all six "Defaulted to `None`" hits not just the two
  named (cheap, same check).
- Linear comments were not readable with this toolset; items 5–9 come from the driver's relay, corroborated
  against HEL-1393's persisted skeptic/evaluator evidence.
