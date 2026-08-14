## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review — no prior report (evaluation-1/2/3.md, skeptic-design-1/2/3.md) taken on faith. All
findings below are grounded in my own fresh reads of the diff/code and my own live commands/API
calls/screenshots against the running app at commit `7de52fd6` (backend process start `14:45:41`,
after commit author time `14:42:40` — confirmed fresh, not stale).

### What I verified (with evidence)

**Diff scope.** `git diff main...HEAD` is misleading in this worktree — local `main` is stale
(missing HEL-328/627/403/406/408, already merged to `origin/main`). Used
`git diff origin/main...HEAD` throughout (58 files, +5037/-57, matches `files-modified.md`).

**Tasks / ACs traced to code:**
- Task 1.1-1.6 (D3/D3a shared conversation store): `V78__refinement_conversations.sql` adds
  `latest_patch_set JSONB` + `CHECK (latest_proposal IS NULL OR latest_patch_set IS NULL)`.
  `AuthoringConversationRepository`/`AuthoringConversationTurns`/`RefinementConversationTurns` all
  take the dual-optional pair explicitly, never inferred (read all three files in full).
  `DashboardAuthoringService.loadForContinuation` and `RefinementService.loadForContinuation` both
  gained the symmetric `record.latest{Proposal,PatchSet}.isEmpty => NotFound` guard, checked before
  the token-budget branch.
- Task 2.1-2.7 (refinement service): `RefinementProtocol`/`RefinementGrounding`/`RefinementPrompt`/
  `RefinementEditShape`/`RefinementParsing`/`RefinementService`/`RefinementRoutes` all present, wired
  into `ApiRoutes` (grepped the diff — `RefinementGrounding`/`RefinementService`/`RefinementRoutes`
  construction mirrors `dashboardAuthoringServiceOpt` exactly).
- Task 3.1-3.6 (frontend): `refinementService.ts`, `useRefinement.ts`, `RefinementChatDrawer.tsx`+
  `.css`, `App.tsx` wiring (`selectedDashboardId !== null` gate) all read in full — faithful sibling
  of `AuthoringChatDrawer`, reuses `topbar-theme-btn`/`Textarea`/`InlineError`/`useOverlay`.
- Task 4.1-4.3 (MCP): `helioApi.ts` `proposePatchSet`/`applyPatchSet`, `tools/refinement.ts` +
  `refinementHandlers.ts` (handler-split precedent from `combinedProposalHandlers.ts`), registered in
  `index.ts`, README updated.
- Task 5.x/6.x (tests): read `RefinementServiceSpec.scala` (408L), the D3a cross-flow test in both
  `RefinementServiceSpec` and `DashboardAuthoringServiceSpec` (symmetric, both assert
  `transport.sendInvocations.get() shouldBe 0` and that the OTHER flow's column is byte-for-byte
  unchanged after the rejected attempt), `AuthoringConversationRepositorySpec`'s new DB-`CHECK` test
  (raw SQL bypassing the app layer, asserts `SQLException` + zero rows written), and
  `RefinementEditShapeSpec` (each worked example decoded through the REAL
  `PatchSetProtocol.editFormat` + the real `*PanelConfig.Patch.decode`/`.decodeCreate` — confirmed
  this matches `PatchSetApplyResolvers.resolvePanelCreate`'s own `decodeCreatePatch[CreatePanelRequest]`
  call site, not an approximation).
- Task 7.1 (gates) — re-ran every one myself, fresh, this session (all from
  `.../HEL-411` worktree root except `sbt test`):
  - `npm run lint` → clean (`eslint . --max-warnings=0`, no output).
  - `npm run format:check` → "All matched files use Prettier code style!"
  - `npm run check:schemas` → "schemas in sync... (48 checked across 38 protocol files)".
  - `npm run check:scala-quality` → "clean (97 soft warning(s))" — same count evaluation-3.md
    reported; 0 hard failures.
  - `npm test` → helio-mcp 153/153, frontend 159 suites/1601 tests, all green — matches
    evaluation-3.md exactly.
  - `npm --prefix frontend run build` → succeeds (pre-existing >500kB chunk warning only).
  - `cd backend && sbt test` → **2701/2701 tests, 169 suites, 0 failures** — matches evaluation-3.md
    exactly.
  - `npm run check:openspec` → flags the change as "complete but not archived" — expected at this
    gate (archival is a post-confirm step), not a defect.

**D3a (point 1 of the brief) — genuinely symmetric, no gap.** Beyond reading the code/tests, I did a
LIVE end-to-end reproduction: started a real authoring conversation via `POST /api/authoring/dashboard`
(real `conversationId` returned, `latestProposal` populated with a real `DashboardProposal`), then
called `POST /api/refinements` with that SAME `conversationId` against a real pipeline target →
**`404 {"message":"Not found"}`**, and confirmed via `GET /api/authoring/conversations/:id` that the
authoring conversation's `displayTurns`/`latestProposal` were byte-for-byte unchanged (no "hijack"
turn appended, 2 turns exactly as before). D3a holds, live, symmetric, no gap found.

**D2a for the PANEL target kind (point 2, first half) — genuinely complete now, soundly
generalizable, not a narrow patch.** I independently verified the claim in evaluation-1/2/3.md that
`aggregation: Option[JsObject]` (metric/chart) is completely untyped and unvalidated anywhere
downstream — read `MetricPanelConfig`/`ChartPanelConfig`'s `decode`/`Patch.decode`
(`backend/src/main/scala/com/helio/domain/panels/{MetricPanel,ChartPanel}.scala`): any `JsObject`
passes, no required-key check exists anywhere in the call chain (`PatchSetPreviewService.preview`
included). I then read `TablePanelConfig`/`CollectionPanelConfig`/`TimelinePanelConfig` in full to
check whether this same "untyped nested object, no downstream validation" risk exists for the other
3 `DataBindable` panel kinds — it does not: table has no aggregation-like field at all;
collection's `baseType`/`layout` and timeline's `timelineOptions.sort` are all strictly enum-validated
at create/PATCH time (raise 400 on an invalid value, never silently pass). So the 3-cycle fix
(explicit rule in `RefinementPrompt.Instructions:28-33` + `MetricPanelCreateExample`/
`ChartPanelCreateExample`/`TablePanelCreateExample` in `RefinementEditShape.scala`) targets the ONLY
panel-kind field with this defect class — this is a sound, correctly-scoped generalization, not a
narrow patch, for the panel target kind specifically.

**D2a for the PIPELINESTEP target kind (point 2, second half) — REFUTE. Live-reproduced, severe,
silent-corruption gap, structurally identical to the two defects already fixed for panels, left
completely unaddressed.**

`RefinementEditShape.UpdateExamples` gives exactly ONE pipelineStep worked example ("rename"); none
of the other ~17 step kinds (aggregate, groupby, join, pivot, window, ...) has an example, and
`RefinementPrompt.Instructions`' cycle-3 completeness rule only covers metric/chart panel
aggregation — nothing about pipelineStep configs. I checked whether pipelineStep's config decode is
as forgiving as the pre-fix panel aggregation was: `PipelineStepConfigCodec.decode`'s own docstring
says "Tolerance lives on each step's `*Config.decode(raw)` — partial/legacy rows decode to a
default-valued typed config rather than raising." Concretely, `AggregateConfig.decode`/
`GroupByConfig.decode` (`backend/src/main/scala/com/helio/domain/steps/{AggregateStep,GroupByStep}.scala`)
build their `groupBy`/`aggregations` vectors via `items.flatMap(it => Try(it.convertTo[...]).toOption)`
— a shape-mismatched item is silently DROPPED, never surfaced as an error, and
`validateEmbeddedStepReferences` in `PatchSetApplyResolvers.scala:239-263` (which `preview` reuses
verbatim, same as the panel path) only checks `PipelineStepConfigCodec.decode(...)` for
`Success`/`Failure` — it never inspects whether the successfully-decoded config is semantically
complete.

I reproduced this live, twice, with different phrasing (both via a purpose-built, fully cleaned-up
test pipeline+aggregate step — created via the app's own API, deleted afterward):

1. Created `POST /api/data-sources` (static, `region`/`amount` columns) → `POST /api/pipelines` →
   `POST /api/pipelines/:id/steps` with `type: "aggregate"`,
   `config: {groupBy: [{name:"region",type:"string"}], aggregations: [{alias:"total_amount",fn:"sum",field:"amount"}]}`
   → ran it, confirmed real output (`East: 30`, `West: 5`).
2. `POST /api/refinements` (`target.kind: "pipeline"`, message "Change the aggregate step to compute
   the average amount per region instead of the sum") → **`200`**, returned edit:
   ```json
   { "target": {"kind":"pipelineStep","id":"12354735-..."}, "op":"update",
     "patch": {"config": {"aggregations":[{"as":"total_amount","field":"total_amount","op":"avg"}],
                            "groupBy":["region"]}} }
   ```
   Every key is wrong: `Aggregation` needs `alias`/`fn`/`field` — the model emitted `as`/`op`/`field`
   (and `field` itself is wrong too — it names the OLD alias, not the real underlying "amount"
   column). `AggregateConfig.groupBy` needs `[{name,type}]` objects — the model emitted plain
   strings.
3. Repeated with different wording ("On the aggregate step, switch it from summing amount to
   averaging amount, still grouped by region") → **`200`** again, same wrong shape (`{"field":"amount","op":"avg"}`,
   `groupBy:["region"]`) — reproduced, not a one-off phrasing fluke.
4. Independently confirmed the silent-corruption outcome by POSTing edit #2's exact patch to
   `POST /api/patch-sets/preview` directly: **`200`**, with
   `"after": {"config": {"aggregations": [], "groupBy": []}}` — the entire config silently wiped to
   empty, no error, no warning, nothing for a reviewer to catch except an easy-to-miss pair of empty
   arrays (versus the panel case's much more visually-alarming wrong-panel-type diffs). Per
   `AggregateStep.apply` (read in full): an empty `groupBy` collapses ALL rows into ONE group, and an
   empty `aggregations` list means that one output row carries ZERO columns — i.e. this patch set, if
   accepted, replaces a correctly-grouped-and-summed pipeline output with a single contentless row,
   silently, for every downstream panel/type bound to that pipeline.
5. Cleaned up: `DELETE`d the test pipeline and data source after the trials (`204`/`204`).

This is the SAME defect class (untyped nested JSON with implicit required sub-keys, invisible to
`preview`) that consumed 3 full review cycles to fix for panel metric/chart aggregation — design.md
itself calls getting this shape right "the ticket's central technical bet." It is NOT covered by
any of the 3 cycles' fixes (all three were scoped to panel create/update), and it is directly
reachable through this ticket's own shipped surface: `POST /api/refinements` for a `pipeline` target
(no ACL/scope restriction beyond ordinary editor access) and the MCP `propose_patch_set`/
`apply_patch_set` pair — which is, per design.md's own Non-Goal text, the ONLY way pipeline
refinement is reachable at all right now (no in-app trigger). AC1 ("yields a validated PatchSet") and
spec.md's "A returned PatchSet SHALL already be proven valid via the apply path's own checks" are
technically true in letter (`preview` returns `200`) but hollow in the sense that matters — the
returned patch set does not do what was asked and would corrupt the target step if accepted, with a
much weaker safety net than the panel path (no in-app diff-review habit exists yet for pipeline
targets; an external MCP-driving agent has no particular reason to notice two empty arrays before
calling `apply_patch_set`).

**Point 3 (cycle 3's "mistargeted follow-up edit" finding) — independently reproduced and concur it
is genuinely non-blocking.** I ran 2 of my own live trials against the same dashboard/scenario shape
(dashboard-create + implied chart type): both returned `422` with a loud, visible, safe failure
(`"Object is missing required member 'seriesColors'"`, `"Expected Collection as JsArray, but got {}"`)
— the system's repair-then-reject safety net working as designed, consistent with cycle 3's own
characterization of 2/3 trials. I did not chase the low-probability mistargeted-edit branch further
(cycle 3's account of it is detailed and specific enough to trust as a documented finding); its own
stated worst case (an inert `appearance.chart` field on an unrelated panel, always visible in
diff-preview) is real and meaningfully less severe than the pipelineStep finding above, whose failure
mode is a `200`+silently-corrupted PRIMARY edit, not a visible secondary one. I agree this one is
non-blocking.

**UI / design judgment (point 4).** Started servers via `scripts/concertino/start-servers.sh` (reused
already-healthy instances) and `assert-phase.sh servers` → `PASS`. Opened the "Revenue by Region"
dashboard, clicked "Refine this dashboard with AI", screenshotted in both dark and light theme
(`refine-drawer-light.png`, `refine-drawer-light2.png`, both cleaned from repo root not needed — no
stray files left). `RefinementChatDrawer.css` read in full: 100% `--app-*`/`--space-*`/`--text-*`
tokens, no hardcoded colors, structurally byte-for-byte parallel to `AuthoringChatDrawer.css`
(compared both side by side) including the same `44px`/`16px` literals for tap-target sizing (an
established precedent, not a deviation). `App.tsx`'s trigger button reuses the existing
`topbar-theme-btn` class rather than inventing a new one. No console errors/warnings during any of my
interactions (`browser_console_messages` checked at warning level: 0/0). DRY/dead-code: grepped the
whole diff for inline FQN usage (`com\.helio\.[a-zA-Z]+(\.[a-zA-Z]+)+` outside `import`/comment
lines) — zero violations, only legitimate imports and doc-comment type references. `useRefinement.ts`/
`refinementService.ts` read in full — clean, no duplication with the authoring hook beyond
intentional, documented mirroring.

### Verdict: REFUTE

The mechanical checklist (tasks, tests, gates, D3a, general code quality, panel-kind D2a coverage) is
genuinely solid — evaluation-1/2/3.md's claims for all of that held up under my own fresh
verification. But I found a real, live-reproduced, severe gap in the exact area the brief asked me to
scrutinize (D2a's generalization to pipelineStep edits) that none of the 3 execution/evaluation
cycles tested, and it is not a lower-severity, always-visible finding like the one cycle 3 already
flagged non-blocking — it is a `200`, "already proven valid" response whose accepted PRIMARY edit
silently destroys the target pipeline step's function. This is squarely the ticket's own defined
central risk (D2a), on a target kind (`pipeline`) the ticket explicitly ships end-to-end grounding,
prompting, and MCP tooling for.

### Change Requests

1. **Close the pipelineStep aggregation/groupBy silent-shape gap** (`RefinementEditShape.scala`,
   `RefinementPrompt.scala`). Reproduced live twice (see evidence above) — refining an existing
   `aggregate` step's config via `POST /api/refinements` (dashboard or pipeline target reaching a
   pipelineStep edit) reliably produces a wrong wire shape (`{"as","op"}` instead of
   `{"alias","fn"}`, plain-string `groupBy` instead of `{name,type}` objects) that
   `PatchSetPreviewService.preview` accepts as `200`-valid because `AggregateConfig.decode`/
   `GroupByConfig.decode` silently drop unparseable items instead of raising. Recommended fix
   (pick one, or combine): (a) add worked UPDATE examples for `aggregate`/`groupby` (the two step
   kinds whose configs are structured objects with implicit required keys) to
   `RefinementEditShape.UpdateExamples`, mirroring the real `Aggregation`/`AggregateField`/
   `GroupByConfig` shapes exactly, plus an explicit `RefinementPrompt.Instructions` rule the same way
   cycle 3 added one for metric/chart aggregation; (b) add a more general instruction that a
   pipelineStep UPDATE edit's `config` must be a COMPLETE config matching the step's real current
   shape (shown in the grounding block) with only the specifically-requested fields changed, never a
   guessed/abbreviated key set — this generalizes to all ~17 step kinds without one example each;
   (c) as a deeper, more invasive but more durable fix (likely its own follow-up ticket, since it
   changes pre-existing, non-refinement-specific decode behavior): make `AggregateConfig.decode`/
   `GroupByConfig.decode` (and any sibling step config with the same silently-tolerant pattern) raise
   on a shape mismatch instead of dropping/defaulting, so `preview`'s existing `resolveAll` check
   would catch this the same way it already catches a malformed panel `appearance`. Add a
   `RefinementServiceSpec`/`RefinementEditShapeSpec`-style regression test asserting a pipelineStep
   aggregate-update edit's config round-trips through the REAL `AggregateConfig.decode` with its
   `groupBy`/`aggregations` non-empty and matching the requested change — the same class of guard
   `RefinementEditShapeSpec` already applies to the panel-kind examples, extended to at least the
   `aggregate` and `groupby` step kinds.
2. Once (1) is addressed, re-run live trials against a real `aggregate`/`groupby` pipelineStep target
   (a minimal repro pipeline+step is cheap to set up via the app's own API, as I did) to confirm the
   fix holds, mirroring cycle 3's own "5 live trials" diligence for the panel case.

### Non-blocking notes

- Cycle 3's "mistargeted follow-up edit" finding (chart-create-with-implied-type) — independently
  reproduced 2/2 as the loud/safe `422` branch; concur with evaluation-3.md that this specific finding
  is non-blocking (always visible in diff-preview, inert-field blast radius).
- Consider, as a small follow-up once (1) above is fixed, whether OTHER pipelineStep kinds with
  structured multi-field configs (e.g. `join`/`pivot`/`window`/`unpivot`) share the same
  silently-tolerant decode pattern and are equally undemonstrated in `RefinementEditShape` — I did not
  exhaustively test every step kind (per the brief's own scope), but the `AggregateConfig`/
  `GroupByConfig` pattern I found is very likely not unique to those two.
