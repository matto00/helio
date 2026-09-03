# Execution Progress — HEL-950

## 1. RED-first probes (against UNFIXED code)

Setup (1.1/1.1b): logged in as matt@helio.dev (owner). Created two owned static data
sources (DS1 = c6d4d1be-1c0b-4758-82b0-73038c5fb93b, DS2 = 1a50fdea-b489-41f4-8f9a-2569b2ecc1fb),
a pipeline (3451bdc1-c27a-4429-82fc-0528ec78d01c) sourced from DS1, then created one owned
`join` step (id e77f4dd7-c492-452d-957b-9fdbd474ee47, rightDataSourceId=DS2) and one owned
`union` step (id bdbdc6ff-4c1a-4d8b-97a7-72166672c0ff, otherDataSourceId=DS2) so the
patch-set `pipelineStep` update edits below have a real, owned target to resolve against
(per task 1.1b's warning — without existing steps, target resolution 404s before reaching
the ACL arms).

### 1.2 — POST /api/patch-sets/apply, UnionConfig.otherDataSourceId: "" (patch-set surface, unfixed)

Request:
```
POST /api/patch-sets/apply
{"edits":[{"target":{"kind":"pipelineStep","id":"bdbdc6ff-4c1a-4d8b-97a7-72166672c0ff"},"op":"update","patch":{"config":{"otherDataSourceId":"","mode":"byPosition"}}}]}
```
Response (verbatim):
```
{"message":"edit 0: data source not found: "}
HTTP:404
```
CONFIRMED RED — this is the cell HEL-620 missed.

### 1.3 — POST /api/patch-sets/apply, JoinConfig.rightDataSourceId: "" (patch-set surface, unfixed)

Request:
```
POST /api/patch-sets/apply
{"edits":[{"target":{"kind":"pipelineStep","id":"e77f4dd7-c492-452d-957b-9fdbd474ee47"},"op":"update","patch":{"config":{"rightDataSourceId":"","joinKey":"id","joinType":"inner"}}}]}
```
Response (verbatim):
```
{"message":"edit 0: data source not found: "}
HTTP:404
```
CONFIRMED RED.

### 1.4 — POST /api/pipelines/:id/steps, defaultConfigFor("join") body (direct API/MCP surface, unfixed)

Request:
```
POST /api/pipelines/3451bdc1-c27a-4429-82fc-0528ec78d01c/steps
{"type":"join","config":{"rightDataSourceId":"","joinKey":"","joinType":"inner"}}
```
Response (verbatim):
```
{"message":"Data source not found: "}
HTTP:404
```
CONFIRMED RED. (Cheap same-code-path check per task 1.4's note — does NOT cover the
patch-set surface; 1.3 above is the patch-set evidence.)

### 1.5 — PATCH /api/pipeline-steps/:id, empty rightDataSourceId (direct API/MCP surface, unfixed)

Request:
```
PATCH /api/pipeline-steps/e77f4dd7-c492-452d-957b-9fdbd474ee47
{"config":{"rightDataSourceId":"","joinKey":"id","joinType":"inner"}}
```
Response (verbatim):
```
{"message":"Data source not found: "}
HTTP:404
```
CONFIRMED RED.

### 1.6 — all four probes (1.2-1.5) failed against unfixed code. Proceeding to the fix.

## 5. GREEN verification (after implementing the shared extractor + 3-site rewrite)

Backend restarted after `sbt compile` succeeded. Re-ran all four RED probes verbatim against
the FIXED code, using the same owned join/union steps seeded in section 1:

### 5.1 — re-run of 1.2-1.5, now GREEN

- 1.2 (patch-set union empty id): `HTTP 200`, `"status":"applied"`, `resultingState.config.otherDataSourceId == ""`.
- 1.3 (patch-set join empty id): `HTTP 200`, `"status":"applied"`, `resultingState.config.rightDataSourceId == ""`.
- 1.4 (addStep join empty-default): `HTTP 201`, `config.rightDataSourceId == ""`.
- 1.5 (updateStep join empty-default): `HTTP 200`, `config.rightDataSourceId == ""`.

### 5.2 — live probe: a non-empty FOREIGN-OWNED rightDataSourceId still 404s (ACL not weakened)

Seeded a data source owned by a different user directly via SQL (owner
00000000-0000-0000-0000-000000000099), then:

- Direct API surface, `POST /api/pipelines/:id/steps` with `rightDataSourceId` = the foreign
  id: `HTTP 404`, `{"message":"Data source not found: <foreign-id>"}`.
- Patch-set surface, `pipelineStep` update edit with the same foreign id:
  `HTTP 404`, `{"message":"edit 0: data source not found: <foreign-id>"}`.

Both error strings are byte-identical to the pre-fix strings (task 3.4).

### 5.3 — UI regression guard (evaluation-1.md CR2: performed for real, not substituted)

Cycle-1's route-test substitution (a `PipelineStepRoutesSpec` test) was correctly rejected by
the evaluator as not satisfying AC6b — it exercises the route layer, not the browser UI the AC
actually asks for. Redone here as a real, live click-through against the running dev servers
(`http://localhost:6382` / `:9289`), driven with a disposable Playwright script (Chromium,
headed-equivalent via the project's own `playwright.config.ts`) rather than by hand, since that
gave an exact, re-runnable transcript instead of a paraphrased description. The script itself
was NOT committed — it served the same evidence-gathering role as the `curl` probes in section
1/5.1-5.2 and was deleted after use, keeping this change's diff backend-only as stated in the
Gates section.

**Steps performed, against a freshly-registered user and two freshly-created static data
sources (via `page.request`, not seeded through the UI — matches this repo's existing
`e2e/hel908-full-flow.spec.ts` convention):**

1. `page.goto(/pipelines/:id)` on a pipeline sourced from "HEL-950 Union Guard Primary Source".
2. Clicked the real `"+ Add step"` button.
3. Clicked `"Union / append rows"` in the real `OpDropdown` op picker (`OP_TYPES`-driven —
   the same list `join` is deliberately absent from, confirming again that `join` cannot be
   reached this way).
4. Confirmed `POST /pipelines/:id/steps` returned `201`.
5. Clicked the step card's header to expand it, revealing the real `UnionConfig` editor
   ("OTHER DATA SOURCE" label, "— select a data source —" placeholder).
6. Clicked the `Select` combobox (`role="combobox"`, `aria-label="Other data source"`) and
   chose "HEL-950 Union Guard Other Source" from the real options list.
7. Confirmed the resulting `PATCH /pipeline-steps/:id` returned `200`.

**Observed:**

- No "data source not found" text anywhere on the page.
- No generic error banner/toast (`/error/i` text search, excluding this test's own strings,
  returned zero matches).
- Console/page errors: exactly one, `Failed to load resource: the server responded with a
  status of 404 (Not Found)`, traced (via a response-logging listener) to
  `GET /api/pipelines/:id/schedule` — the pipeline-detail page's pre-existing "Schedule" panel,
  which treats a 404 there as "no schedule set" (this repo's documented `PUT`-only-upserts
  schedule contract; unrelated to this change, not touched by this diff). No other console
  error of any kind was observed.
- The final `PipelineStepRoutesSpec`/`PatchSetApplyServiceSpec` full-suite runs (section 6)
  additionally re-confirm the same union route-layer path stays green after this cycle's edits.

Labelled, per AC6b/AC6c, as a regression guard on the ALREADY-guarded union path only — NOT
evidence for the join fix (join remains unreachable from this picker by design).

Test/DB cleanup: deleted the temporary pipeline/steps/data-sources/foreign-owner user created
for the live probes above.

## 4. Shared extractor + 3-site rewrite (tasks 2.1/2.2/3.1-3.4)

- `secondaryDataSourceId(config: Any): Option[String]` added to
  `com.helio.api.protocols.pipelines.PipelineStepConfigCodec`, alongside the codec, per
  design Decision 1. `.nonEmpty` (never `.trim.nonEmpty`) per Decision 4.
- `PipelineService.addStep`/`updateStep`'s three hand-copied `joinCheckF`/`unionCheckF`/
  `lookupCheckF` blocks replaced with one `aclCheckF` driven by the extractor at both call
  sites. Error string preserved exactly: `s"Data source not found: $id"`.
- `PatchSetApplyResolvers`'s pipelineStep-update triad (join unconditional, union
  unconditional, lookup already guarded) replaced with one extractor-driven check. Error
  string preserved exactly: `s"edit $index: data source not found: $id"`.
- **A FIFTH unguarded call site found beyond the ticket/design's enumerated four**:
  `PipelineService.validateStepCrossOwnerRefs` (used by the single-call transactional
  `POST /api/pipelines` path with an inline `steps[]`, HEL-907) had an unconditional
  `case Success(jc: JoinConfig) => checkOwnedSource(jc.rightDataSourceId, user)` arm — the
  identical unguarded-empty-id defect, in the same file, that design.md's Decision 5
  enumeration did not surface (it audited `PipelineService.addStep`/`updateStep` and
  `PatchSetApplyResolvers` only). Fixed using the same shared extractor (2-line change,
  identical mechanism) since it is unambiguously the same bug class this change exists to
  close; not treated as a scope escalation because the fix is the same 2-line pattern
  already being applied at the other five sites, with no new design decision required.
- Task 3.4: confirmed both error strings preserved byte-exactly by diff review, and by the
  5.2 live-probe evidence above showing the unchanged 404 message text.

## Mutation checks (task 4.5) — each leg broken SINGLY, both directions, then restored

For join and union (the two ops with new HEL-950 test coverage; lookup's tests are
pre-existing and unmodified per task 4.4):

**Join, empty-id leg alone** — mutated `secondaryDataSourceId`'s join arm from
`case jc: JoinConfig if jc.rightDataSourceId.nonEmpty => Some(...)` to
`case jc: JoinConfig => Some(jc.rightDataSourceId)` (drops the `.nonEmpty` filter only).
Result: `PipelineStepRoutesSpec`'s "POST with join type and the picker's exact empty-default
config succeeds" and "PATCH join step config to an empty rightDataSourceId stays allowed"
went RED (404 instead of 201/200); the cross-user join tests
("POST ... cross-user right-source returns 404", "PATCH ... cross-user ... returns 404")
STAYED GREEN. Restored.

**Join, ACL leg alone** — mutated the join arm to `case jc: JoinConfig => None` (extractor
never surfaces an id, so the ownership check is never invoked for join). Result: the
cross-user join tests (POST + PATCH) and the patch-set foreign-owned join test (7.9d) went
RED; the empty-id join tests STAYED GREEN. Restored.

**Union, empty-id leg alone** — same drop-the-`.nonEmpty`-filter mutation on the union arm.
Result: `PipelineStepRoutesSpec`'s union empty-default POST/PATCH tests AND the new
`PatchSetApplyServiceSpec` "accept a pipelineStep-update edit clearing
UnionConfig.otherDataSourceId to empty" test went RED; the union cross-user tests (POST,
PATCH, and the new patch-set foreign-owned union test) STAYED GREEN. Restored.

**Union, ACL leg alone** — mutated the union arm to always return `None`. Result: the union
cross-user POST/PATCH tests AND the new patch-set foreign-owned union test went RED; the
empty-id union tests (including the two new HEL-950 ones) STAYED GREEN. Restored.

**The fifth site (`validateStepCrossOwnerRefs`), empty-id leg alone (evaluation-1.md CR1)** —
this call site has no ACL-leg mutation of its own to prove (it never had a `.nonEmpty` filter
to remove independently of the shared extractor's own join arm, already covered above); the
gap CR1 named was that reverting THIS SITE's guard produced NO red test at all, not that a leg
was untested. Mutation: replaced the extractor-driven `secondaryDataSourceId(typedConfig)`
match at this one call site (`PipelineService.scala`, inside `validateStepCrossOwnerRefs`) with
`typedConfig match { case jc: JoinConfig => checkOwnedSource(jc.rightDataSourceId, user); case
other => PipelineStepConfigCodec.secondaryDataSourceId(other) match { ... } }` — i.e. restored
join's OWN unconditional check at this site alone, leaving every other call site (addStep,
updateStep, PatchSetApplyResolvers) on the shared, correctly-guarded extractor. Result: the new
`PipelineCreateTransactionalSpec` test "accept a join step whose rightDataSourceId is empty
... without a spurious cross-owner rejection" went RED
(`Left(NotFound("Data source not found: ")) was not an instance of scala.util.Right`); the
pre-existing "reject (with nothing persisted) a join step whose rightDataSourceId references
another owner's data source" test (:292) and "accept a join step whose rightDataSourceId
references the caller's OWN data source" test (:316) both STAYED GREEN. Restored; full
`PipelineCreateTransactionalSpec` suite re-run green (11/11) immediately after.

Every mutation was reverted immediately after its single-leg result was recorded; `git diff`
on `PipelineStepConfigCodec.scala` and `PipelineService.scala` confirms the final state matches
the intended fix exactly.

## Structural guard mutation proof (task 4.7)

**(a) DETECTION** — temporarily added a fourth field `extraDataSourceId: String = ""` to
`JoinConfig` (case class + `jsonFormat4` + tolerant decoder). `PipelineStepSecondSourceGuardSpec`
went RED on both its tests:
```
kind 'join', field 'extraDataSourceId', populated decode: None was not equal to Some("real-id")
HashMap("lookup" -> "referenceDataSourceId", "union" -> "otherDataSourceId", "join" -> "extraDataSourceId")
  was not equal to Map("join" -> "rightDataSourceId", "union" -> "otherDataSourceId", "lookup" -> "referenceDataSourceId")
```
Reverted `JoinConfig` to its original 3-field shape immediately after.

**(b) HANDLING** — deleted the `JoinConfig` arm from `secondaryDataSourceId` alone (union/
lookup arms untouched). The guard itself (not merely the unit test) went RED:
```
kind 'join', field 'rightDataSourceId', populated decode: None was not equal to Some("real-id")
```
Restored the arm immediately after.

Both mutations confirm the guard is non-vacuous on both the "a new second-source field
exists" axis and the "the extractor stops handling a known field" axis.

## 6. Gates

- `sbt test` (full backend suite) — see final report for pasted output/exit code.
- `openspec validate guard-join-picker-empty-source-id --type change`.
- Backend-only change: `npm run lint` / `npm run typecheck` / `npm test` /
  `npm --prefix frontend run build` scan NOTHING relevant to this change (no `frontend/**`
  files touched) and are NOT cited as coverage.
