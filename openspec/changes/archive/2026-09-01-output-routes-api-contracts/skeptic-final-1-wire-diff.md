## Skeptic Report — final gate (round 1, skeptic-final-1-wire-diff.md)

**Dimension: wire-contract diff only.** Route/ACL correctness, contract+schema consistency
and deletion-sweep completeness are three sibling skeptics' dimensions; I comment on them
only where the *published contract text* and the *shipped wire shape* disagree.

### What I verified (with evidence)

- Route surface: `git diff main...HEAD -- backend/.../ApiRoutes.scala` (only new wiring +
  the `OutputRoutes` mount; no unsanctioned route), plus full reads of `OutputRoutes.scala`,
  and the diffs of `PipelineRoutes.scala`, `PipelineStepRoutes.scala`,
  `PipelineShapeRoutes.scala`, `PipelineRunStatusRoutes.scala`, `PublicDashboardRoutes.scala`.
- Protocol diffs: `PipelineProtocol.scala`, `PipelineShapeProtocol.scala`,
  `PipelineStepProtocol.scala`, `NodeCapabilitiesProtocol.scala`, `OutputProtocol.scala`,
  `PaginationProtocol.scala`.
- Every spec delta in `openspec/changes/output-routes-api-contracts/specs/**` read in full and
  compared line-by-line against the shipped code.
- Baseline spec check: `grep -rn "204" openspec/specs/pipeline-steps-persistence/spec.md`
  (lines 248/253) against the shipped `DELETE` handler.
- `grep -rn "CurrentVersion" backend/src/main/scala` → `DashboardProtocol.scala:185 = 2`.
- `git diff main...HEAD --stat -- backend/.../routes/panels backend/.../services/panels schemas/panels`
  → **empty** (panels wire shape untouched).
- `grep -rn "PipelinePreviewRunStateUnchanged" . --include=*.scala --include=*.md` → one hit,
  the comment itself (re-run once to confirm; stable).
- `parameters("outputId")` at `PipelineRunStatusRoutes.scala:53` read twice.

### Confirmed clean in my dimension

- **`CurrentVersion` NOT bumped** — still `2` (`DashboardProtocol.scala:185`). Matches D11.
- **`POST /api/panels` NOT changed** — zero diff under `routes/panels`, `services/panels`,
  `schemas/panels`. No `kind` field, no top-level `outputId`; still HEL-904's
  `type: "output"` / `config.outputId`. The ticket's illustrative wording was correctly ignored.
- **No unsanctioned route** — every new/changed route traces to the ticket's Scope section:
  outputs CRUD + `/panels` + `/assertion-status` + `/rows` + `GET /api/outputs`,
  `/pipelines/:id/capabilities`, `/pipelines/:id/validate-expression`,
  `/pipelines/:id/preview`, `steps[]`/`outputs[]` on `POST /api/pipelines`, `parentStepId`
  on `POST /api/pipelines/:id/steps`, the `expand` envelope.
- **`expand`'s envelope change is disclosed** and is acceptable under governing decision 17
  with HEL-934 filed for its stale consumers — I do not object to it as such.
- `AssertionStatusResponse.dataTypeId` → `outputId` is a field rename on a route that was
  already deleted in P1.1, not a break of a live route. Sanctioned.
- `PublicDashboardRoutes`' `dataAsOf` going from always-`None` to populated is a value change,
  not a shape change. Sanctioned by the ticket's Out-of-Scope rewire clause.

### Verdict: REFUTE

`expand` is **not** the only response-shape-breaking change (CR1), the preview route's actual
wire contract contradicts the contract shipped in this same change (CR2), that contract's
one behavioral scenario cites a test that does not exist (CR3), and five spec deltas shipped
here state a wire contract the code does not implement (CR4–CR7). The failure mode is uniform:
`openspec/changes/.../specs/**` is written as the *intended* contract, but on archive it becomes
the *authoritative* record of what shipped — and today it is wrong in seven places.

### Change Requests

1. **Second undisclosed BREAKING wire change: `DELETE /api/pipeline-steps/:id` 204 → 200 + body.**
   `PipelineStepRoutes.scala:57` changed `runNoContent` to `run(...)(identity)`, returning
   `DeletePipelineStepResponse(removedTailStepCount)`. The live baseline
   `openspec/specs/pipeline-steps-persistence/spec.md:246-253` still states the route "returns
   `204 No Content` on success" and this change ships **no MODIFIED delta** for that capability,
   so the archived spec will contradict the code. The word BREAKING appears nowhere for it
   (tasks.md 3.2 describes it neutrally; design.md never mentions it), and unlike `expand` it has
   **no consumer-break disclosure and no follow-up ticket** — HEL-934 covers `expand` only.
   Required: add a `MODIFIED` delta for `pipeline-steps-persistence`'s DELETE requirement
   (200 + `{ removedTailStepCount }`), label it BREAKING alongside D14, and either fix or file
   the frontend/e2e/helio-mcp consumers that read a 204 from this route.

2. **`POST /api/pipelines/:id/preview` — `outputId` is REQUIRED in code, OPTIONAL in the contract.**
   `PipelineRunStatusRoutes.scala:53` is `parameters("outputId")` (no `.optional`), so an
   unscoped call is rejected, never served. The delta shipped in this change,
   `specs/pipeline-preview-api/spec.md`, mandates the opposite: "returning, for every Output on
   the pipeline (or only the one named by `?outputId=` when present)", and its scenario "Preview
   does not mutate run state" invokes the route **with no query param at all** — i.e. a scenario
   that cannot pass against this implementation. The ticket's "`?outputId=` scopes" reads the same
   way. Two further gaps on the same route: the response is `RunResultResponse` (the pre-existing
   single-step preview shape), not the per-Output envelope the requirement describes, and
   `preview-outputs-response.schema.json` was deferred to HEL-933 while the requirement it backs
   shipped anyway. Also `tasks.md` 3.7 is still `[ ]` although the route shipped in cycle 7 —
   the task ledger understates what is on the wire.
   Required: pick one and make code and contract agree — either make `outputId` optional and
   return all Outputs, or rewrite the requirement + scenario to state that `outputId` is
   mandatory — and reconcile the response shape with the requirement's wording.

3. **False verification citation in shipped production code.**
   `PipelineRunService.scala:283`: "Never mutates run state ... — **verified by
   `PipelinePreviewRunStateUnchangedSpec`**". A repo-wide grep finds exactly one occurrence of
   that name: this comment. The spec does not exist, and no other test asserts
   `last_run_status`/`last_run_at` are unchanged after a preview — which is precisely the
   assertion tasks.md 3.7 and the shipped preview requirement both call for. Required: write the
   test (or delete the citation and stop claiming verification that was never performed).

4. **`pipeline-shape-registry` delta contradicts the shipped `expand` shape on both sides.**
   The delta states the request body is `{ "params": <object>, "parentStepId"?: string }`.
   The shipped request is `ExpandPipelineShapeRequest(params: JsObject)` —
   `jsonFormat1`, `PipelineShapeProtocol.scala:53/129`; a `parentStepId` key is silently ignored.
   The response-side-chaining interpretation the brief asks about **is** documented in
   `tasks.md` 3.8 and referenced from `design.md` D14, but the *contract artifact shipped in the
   same change still asserts the request-side field* — a reviewer reading the spec is actively
   misled rather than merely under-informed. The same delta also describes `steps` entries as
   `{ kind, config }` while the shipped entry is `{ clientId, kind, config, parentStepId }`
   (`jsonFormat4`). Required: rewrite the delta's request/response shapes to match what shipped,
   and state the "response-side chaining, not a request field" rationale in the spec itself.

5. **Same delta ships a requirement no shape can satisfy.** Scenario "A shape declaring an
   `OutputContract` returns an outputs block (e.g. a metric over the shape's aggregate result)".
   `OutputContract.scala` is `{ rowCount, description }` only (the field-list member was removed
   as YAGNI in HEL-623), and `ExpandPipelineShapeResponse.fromDomain` hardcodes `outputs = None`
   for every shape. The scenario is untested and unimplementable today. Required: either delete
   it or restate it as explicitly forward-looking, matching the honest note already in the
   protocol's scaladoc.

6. **`pipeline-create-api` delta describes a `POST /api/pipelines` that did not ship.** Shipped:
   `sourceDataSourceId` (required), `steps[]` entries require a `clientId`, `outputs[]` uses
   `nodeStepClientId`, and the response is a bare `PipelineSummaryResponse`
   (`PipelineService.scala:138/152-154`). The delta says `sourceId` **or an inline source spec**,
   `outputs[]` = `{ nodeStepId?, kind, name, config }`, and a response carrying "the created step
   and Output ids"; its scenario "Single call builds source, trunk, tail, and an Output" opens
   "with an inline CSV source". The inline-source variant is unimplemented (tasks.md 3.1 says so)
   and — unlike the four other deferrals — is **not in design.md D13's list and not filed to
   HEL-933**. Required: file the inline-source variant as a follow-up (or implement it) and
   correct the delta's field names and documented response to the shipped shape.

7. **`output-routes-api` delta diverges from the shipped Output surface in four places.**
   (a) It specifies `GET /api/outputs/:id/rows?page=&pageSize=` and
   `GET /api/outputs?page=&pageSize=`; the code takes `offset`/`limit`
   (`OutputRoutes.scala`, both handlers) — the documented query params do not exist.
   (b) It says the list is "scoped to the authenticated user's accessible Outputs";
   `OutputService.listAll` is `outputRepo.findAllByOwner` — owner-only, as tasks.md 2.6 admits.
   (c) It says every Output route returns "404, never 403" for a non-grantee; the shipped
   CRUD returns 403 (tasks.md 2.1 states this explicitly).
   (d) The `config.format` requirement (HEL-876) shipped as an `ADDED` requirement with two
   scenarios while task 2.3b was deferred to HEL-933 — an archived requirement for absent code.
   Required: correct (a)-(c) to the shipped contract and move (d) out of this change's deltas
   into HEL-933's.

8. **Two spec deltas describe behavior wholly absent from the diff.**
   `specs/dashboard-panel-layouts/spec.md` adds a requirement that `POST /api/panels` returns a
   server-computed `layoutItem` — panels are byte-for-byte untouched in this diff (task 2.7 →
   HEL-933). `specs/data-source-persistence/spec.md` MODIFIES the list requirement to mandate
   `inferredSchema` on every item — task 3.10/1.3 → HEL-933, nothing shipped. Both must move to
   HEL-933's change directory; archiving them here records a contract the API does not honor.

9. **Stale/contradictory scaladoc on a wire type (minor but on the contract surface).**
   `PipelineProtocol.scala`, `CreatePipelineTransactionalStepRequest`: "rolls back the ENTIRE
   call, deleting the just-created pipeline ... see `PipelineService.create`'s doc for why this
   is a **compensating-delete rollback, not a single literal Slick transaction spanning multiple
   repositories**." Design D3 records the exact opposite as ratified and shipped
   (`runTransactionally`, one `.transactionally` DBIO across three repositories); the
   compensating-delete implementation was deleted in cycle 5. Required: correct the comment.

### Non-blocking notes

- The `enum` additions to `pipeline-analyze-response` / `pipeline-analyze-proposal-response`
  `type` properties are a narrowing of an existing schema, but to the seven values the code was
  already required to emit post-AC-3 — I do not read this as a break.
- `GET /api/outputs` being matched before `outputs/:id` via `pathEndOrSingleSlash` is correct as
  written; no route-shadowing issue found on this prefix.
