## Skeptic Report — final gate (round 1, skeptic-final-1-contracts.md)

**Dimension: contract + schema consistency.** (Dimension-split fan-out; route/ACL correctness,
deletion-sweep completeness, and wire-contract diff are owned by sibling skeptics.)

### What I verified (with evidence)

**1. The hardest requirement — schema-ownership split frozen files: PASSES (definitively).**

```
git diff origin/main...HEAD -- backend/.../services/proposals/DashboardProposalService.scala \
                               helio-mcp/src/tools/proposal.ts
```
Empty (`wc -l` = 0; `--numstat` = 0 lines). Re-run at the end of the review: still 0 (reproduced).
I also iterated **all 8 commits** individually (`git log --format=%H origin/main..HEAD | while read c;
do git show --stat $c -- <both files>; done`) — every commit's stat section for those two paths is
empty. Not just the tip commit. The P1.3/P1.4 ownership split is intact; P1.4 does not inherit a
broken premise on this axis.

**2. `check-schema-drift.mjs` green — and I confirmed what it actually scans.**
Exit 0, twice. Output: `72 checked across 48 protocol files`, `7 panel-type surfaces`.
Reading the script (not the report): it walks `schemas/**.schema.json`, matches each `title` to a
`case class` name across `JsonProtocols.scala` + recursive `api/protocols/**`, and diffs **field-name
sets only**. Load-bearing limitation: it does **not** check types, required-ness, or enum values, and
it is **schema-first** — a response shape with no schema file is invisible to it. So its green is
real but narrow; I hand-checked the below rather than resting on it.

**3. Schema-vs-Scala spot checks (5, not 3) — all exact, including Option↔required alignment:**

| schema | case class | result |
|---|---|---|
| `outputs/create-output-request` | `OutputProtocol.scala:31` `CreateOutputRequest(nodeStepId: Option, kind, name, config: Option[JsObject])` | match; `required:[kind,name]` correctly excludes both `Option`s |
| `outputs/output` | `OutputProtocol.scala:16` `OutputResponse` (10 fields, `jsonFormat10`) | match; all 10 required, `nodeStepId` nullable ↔ `Option` |
| `pipelines/create-pipeline-request` | `PipelineProtocol.scala:33` `CreatePipelineRequest` | match; `steps`/`outputs` default `Vector.empty` ↔ non-required, additive as described |
| `pipelines/create-pipeline-transactional-step-request` | `PipelineProtocol.scala:20` | match; backticked `` `type` `` unwrapped correctly |
| `pipelines/create-pipeline-transactional-output-request` | `PipelineProtocol.scala:27` | match |

`kind` enum (6 values, duplicated across 4 schema files) checked by hand against
`OutputKind.fromString` (`model.scala:775-784`): `table|metric|chart|collection|timeline|markdown` —
exact, no drift.

**4. `openspec validate output-routes-api-contracts --strict`: passes, twice.** But this validates
**structure** (requirement/scenario formatting), not correspondence to shipped code. Its green is not
evidence for finding 1/2 below — which is how those survived to this gate.

**5. Decision 17 / HEL-934 assessment: the expand envelope break is CORRECTLY handled.**
Decision 17 is real and genuinely covers this class — governing spec
`docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` line 46 (table row 17) and
line 213: *"the running web app is knowingly non-functional on `main` between P1.3 and P1.6, which is
safe because deploys fire only on `v*` tags"*, with *"Concertino's UI gate is N/A for P1.1–P1.4"*.
Stale frontend/e2e/helio-mcp consumers of the bare-array shape fall squarely inside that.
HEL-934 is **real, not a placeholder**: fetched from Linear — full Context/Scope/AC/Dependencies
body, parented to HEL-903, correctly cites decision 17, and flags likely subsumption by HEL-907/908.
`tasks.md:45` additionally enumerates all 9 stale consumer files by name. This is model handling; I
am not refuting it.

### Verdict: REFUTE

The mechanical gates all pass and the schema-vs-Scala layer is clean. The defects are confined to
the **capability spec deltas** — which is the durable artifact: they archive into `openspec/specs/`
as the canonical contract and are what P1.4/P1.5 read. Three of them describe behavior that did not
ship, and two are not tracked by any deferral marker.

### Change Requests

1. **`specs/pipeline-shape-registry/spec.md` — the delta specifies a request field that was
   deliberately NOT shipped.** The requirement text says the endpoint accepts
   `{ "params": <object>, "parentStepId"?: string }`. Shipped
   `ExpandPipelineShapeRequest` (`PipelineShapeProtocol.scala:53`) is `(params: JsObject)` — no
   `parentStepId`. This was a *deliberate, well-reasoned* interpretation decision, documented at
   length in `tasks.md:43` ("`pipeline-shapes` is a pipeline-AGNOSTIC template catalog … there is no
   real, already-persisted step for a caller-supplied `parentStepId` to anchor into"). The decision
   is right; the spec delta was simply never updated to match it. Remove `parentStepId` from the
   request body in the requirement text.

2. **Same file — two scenarios describe an `outputs` block that is unsatisfiable as specified, with
   no deferral marker.** The requirement says *"the optional top-level `outputs` array carries any
   Outputs the shape's `OutputContract` declares"*, and the scenario **"A shape declaring an
   OutputContract returns an outputs block"** asserts a populated `outputs` array for *"a shape whose
   `OutputContract` declares a default Output (e.g. a metric over the shape's aggregate result)"*.
   Ground truth: `OutputContract` (`backend/src/main/scala/com/helio/domain/shapes/OutputContract.scala`)
   is `case class OutputContract(rowCount: RowCountContract, description: String)` — it has **no
   ability to declare an Output at all**; its `fields: Vector[OutputFieldContract]` member was
   removed as YAGNI in HEL-623. `ExpandPipelineShapeResponse.fromDomain`
   (`PipelineShapeProtocol.scala:91-92`) hardcodes `outputs = None`, unconditionally, for all five
   shapes. So that scenario can never pass without a domain-model change nobody has planned.
   Note the *code* comment (`PipelineShapeProtocol.scala:83-87`) is **accurate and candid** —
   "`outputs` is `None` for EVERY shape today … forward-compatible wire shape, not a currently-populated
   field." Only the spec delta overclaims. Either delete both `OutputContract`-sourced `outputs`
   scenarios and restate the field as reserved/always-absent, or mark them `-> HEL-933` with the
   `OutputContract` extension named as a prerequisite.
   **This one has already propagated**: HEL-934's Linear description repeats the false premise
   ("so the endpoint can carry an optional `outputs[]` block declared by a shape's `OutputContract`"),
   citing this delta as its source. Fix the delta and correct HEL-934's Context paragraph.

3. **`specs/pipeline-preview-api/spec.md` — the requirement's all-Outputs behavior did not ship, and
   task 3.7 carries no deferral marker.** The delta states the endpoint returns *"for every Output on
   the pipeline (**or** only the one named by `?outputId=` when present)"*. Shipped
   (`PipelineRunStatusRoutes.scala:51-56`) is `parameters("outputId")` — a **mandatory** query
   parameter; there is no all-Outputs branch, so a request without `outputId` is rejected outright.
   Correspondingly `tasks.md:20` leaves **3.7 unchecked** — and unlike tasks 1.3 / 2.3b / 2.7 / 3.10,
   which each carry an explicit inline `-> HEL-933`, **3.7 has no marker at all**, so this gap is
   currently tracked nowhere. Narrow the requirement to the shipped mandatory-`outputId` form (and
   drop or requalify the unshipped clause), and add a `-> HEL-933` marker to task 3.7 for the
   all-Outputs variant. The delta's second scenario ("Preview does not mutate run state") *is*
   sound — `PipelineRunService.scala:282` documents `updateLastRun`/`insertRun` as unreachable from
   `previewOutput`.

4. **Same file as #1 — the `steps[]` element shape is under-described.** The delta says
   `steps: [{ kind: String, config: <object> }]`; shipped `ShapeStepExpansionResponse`
   (`PipelineShapeProtocol.scala:66`) is `(clientId, kind, config, parentStepId)`. The
   `clientId`/`parentStepId` chaining metadata is the *entire substance* of the 3.8 interpretation
   decision (it is what lets a caller feed `steps` straight into `POST /api/pipelines`'s `steps[]`),
   yet the canonical contract omits it. Add both fields, including the `"step-0"`/`"step-1"`
   ordering convention and `parentStepId = None` for the first entry.

### Non-blocking notes

- Same delta, final scenario: "preserving the prior response shape for existing callers that only
  read `steps`" is inaccurate — the prior shape was a **bare array** with no `steps` key, so no prior
  caller read `.steps`. Reword when fixing #2/#4.
- **No schema file covers the expand response** (`ExpandPipelineShapeResponse`), before or after this
  change — `schemas/pipelines/` has no entry for it on `origin/main` either. So this is a
  pre-existing gap, **not** a regression this ticket introduces (`tasks.md:43` states exactly this,
  correctly). But it does mean `check-schema-drift.mjs` structurally cannot catch drift on the one
  contract this ticket deliberately broke. Worth a schema in P1.4/HEL-933.
- The 6-value Output `kind` enum is hand-duplicated across 4 schema files with **no** parity guard,
  while panel types get a dedicated 7-surface guard in `check-schema-drift.mjs` precisely because
  they drifted across HEL-247/305/315. `OutputKind` is now the same shape of risk. Consider adding an
  8th surface to that guard.
