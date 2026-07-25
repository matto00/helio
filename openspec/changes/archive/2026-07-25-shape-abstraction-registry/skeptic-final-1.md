## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Route reachability, live server, real composed tree.**
   Started/confirmed backend on port 8471 (process start `21:44:09` local, after commit `ccc193d1` at
   `21:40:01`; `assert-phase.sh servers` → `PASS servers`).
   - `curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8471/api/pipeline-shapes` (no cookie)
     → `HTTP 401`, body `{"message":"Unauthorized"}`.
   - Logged in as `matt@helio.dev` (200), then with the session cookie:
     `curl -s -b cookies.txt http://localhost:8471/api/pipeline-shapes` → `HTTP 200`, body
     `[{"description":"Passes source rows through, narrowed to the selected fields.","id":"passthrough","label":"Passthrough","outputContract":{"description":"...","fields":[],"rowCount":{"kind":"unbounded"}},"paramsSchema":[{"dataType":"string[]","description":"...","label":"Fields","name":"fields","required":true}]}]` —
     genuinely reachable through the real `ApiRoutes` composition, exercising `PipelineShapeService` →
     `PipelineShape.Registry` end-to-end.
   - Confirmed the routing landmine the design doc describes is real: `curl -s -b cookies.txt
     http://localhost:8471/api/pipelines/shapes` (the ticket's literal suggested path, nested under
     `pipelines`) → `HTTP 404 {"message":"Pipeline not found: shapes"}` — proves `PipelineRoutes`'s
     `path(PipelineIdSegment)` (`PipelineRoutes.scala:42`, `IdParsing.PipelineIdSegment` = unvalidated
     `Segment.map`) really would swallow a nested `shapes` segment, and that the shipped fix (distinct
     top-level `pathPrefix("pipeline-shapes")` in `PipelineShapeRoutes.scala:24`, mounted as its own
     top-level entry in `ApiRoutes.scala`) genuinely avoids it rather than merely being asserted in prose.
   - `ApiRoutesSpec.scala` (diff `6cf4c3f4..ccc193d1`) adds exactly this 401/200-through-composed-tree
     regression pair — read the added test code directly, confirmed it drives `rawRoutes()`/`routes()`
     (the full composed tree), not the isolated `PipelineShapeRoutes` object.

2. **`RowCountContract` wire shapes.** Read `PipelineShapeProtocol.scala` (custom
   `RootJsonFormat[RowCountContract]`, `:77-96`) and `PipelineShapeProtocolSpec.scala` in full. The spec
   directly asserts `ExactlyOne → {"kind":"exactly-one"}`, `AtMostParam("n") →
   {"kind":"at-most-param","paramName":"n"}`, `Unbounded → {"kind":"unbounded"}` (exact `JsObject`
   equality, not a loose field check) plus a round-trip test for all three. This is the exact gap
   round-4 design-skeptic caught (only `Unbounded` is exercised by the live `passthrough` shape) —
   confirmed it is now covered by a dedicated, non-mock test.

3. **Domain/API layering.** `grep -rn "import com.helio.api"
   backend/src/main/scala/com/helio/domain/shapes/` → zero matches (fresh run, this session).

4. **`OutputFieldContract` shape.** `OutputContract.scala:31`:
   `final case class OutputFieldContract(name: String, dataType: DataFieldType, nullable: Boolean)` —
   exactly 3 fields. `grep -rn "role"` across `domain/shapes/`, `PipelineShapeProtocol.scala`,
   `PipelineShapeService.scala`, and all shape/protocol tests → only 3 hits, all inside scaladoc prose
   explaining *why* `role` was dropped (round-2 design-gate finding) or an unrelated "descriptors only"
   phrase — no `role` field anywhere in shipped code.

5. **No Flyway migration.** `ls backend/src/main/resources/db/migration/ | sort -V | tail -5` tops out
   at `V72__add_lookup_op.sql`; no `V73` file exists.

6. **Full gate re-run, fresh, this session:**
   - `sbt test` (backend, full suite) → `Total number of tests run: 1940 ... succeeded 1940, failed 0
     ... All tests passed.` (76s)
   - `npm run lint` (frontend) → clean, zero warnings (zero-warnings policy).
   - `npm run format:check` (frontend) → `All matched files use Prettier code style!`
   - `npm test` (frontend) → `Test Suites: 131 passed, 131 total / Tests: 1361 passed, 1361 total`
   - `npx openspec validate shape-abstraction-registry --strict` → `Change 'shape-abstraction-registry'
     is valid`

7. **Fresh read of shipped files vs. design/tasks/spec.** Read `PipelineShape.scala`,
   `OutputContract.scala`, `PassthroughShape.scala`, `ShapeStepExpansion.scala`,
   `ShapeParamDescriptor.scala`, `PipelineShapeService.scala`, `PipelineShapeRoutes.scala`,
   `PipelineShapeProtocol.scala`, `ApiRoutes.scala`, `JsonProtocols.scala`, `package.scala` (api),
   `schemas/pipeline-shape-catalog.schema.json`, `specs/pipeline-shape-registry/spec.md`, and every
   test file in the diff (`PipelineShapeSpec`, `PassthroughShapeSpec`, `PipelineShapeRoutesSpec`,
   `PipelineShapeProtocolSpec`, plus the `ApiRoutesSpec` addition). Traced every AC:
   - AC1 (`PipelineShape` trait + `Registry`, `expand`, `outputContract`) — met; `PipelineShapeSpec`
     tests registry lookup both ways.
   - AC2 (`GET .../shapes` authenticated catalog) — met (path revised to `/api/pipeline-shapes`, a
     documented, well-justified design-gate-round-1 correction of the ticket's own "e.g." suggested
     path, not a silent deviation — see design.md Decision 6, tasks.md, and `proposal.md`'s
     round-3-corrected references).
   - AC3 (expansion valid against existing step CRUD/validation) — met and genuinely exercised:
     `PassthroughShapeSpec` maps the expansion through the *real* `PipelineStepConfigCodec.decode`
     (the same function `PipelineService.addStep` calls), asserting `decoded shouldBe a[Success[_]]`
     and the exact decoded value — not a mock stand-in.
   - AC4 (schemas/openspec updated) — met; schema field-for-field matches the live curl response body.
   - AC5 (tests: registry/expansion/catalog) — met, plus the extra `RowCountContract` wire-format spec
     above the ticket's literal minimum.
   - AC6 (backward-compatible, no migration) — met (item 5 above); full `sbt test` shows zero
     pre-existing test broken.
   No placeholders, no `role`-field half-measure, no shortcuts found. `check:scala-quality` run fresh
   → `Scala code-quality check: clean (64 soft warning(s))` (pre-existing soft length warnings on
   unrelated files, not new).

8. **Hook-bypass check.** `.husky/pre-commit` runs `lint && format:check && check:schemas &&
   check:openspec && check:scala-quality && test` as one sequential hook (`set -e`). Ran each
   constituent check individually, fresh: `lint`/`format:check`/`test` (frontend+backend) all green
   above; `npm run check:schemas` → `schemas in sync with JsonProtocols ...` (clean);
   `npm run check:scala-quality` → clean; `npm run check:openspec` → the *only* failing check, with
   exactly the reason the evaluator's report claims: `change "shape-abstraction-registry" is complete
   (21/21) but not archived — run \`openspec archive shape-abstraction-registry\``. This is a
   process-ordering hygiene check (archival is the orchestrator's Phase-4 step, not the executor's),
   matching the HEL-386/389 precedent cited in workflow-state.md. Confirmed: the `-n` bypass was
   necessary and sufficient only for this one check — no other quality gate was silently skipped.
   `tasks.md` shows 21/21 checked, 0 unchecked.

### Verdict: CONFIRM

### Non-blocking notes
- `RowCountContract` is intentionally not `sealed` outside `OutputContract.scala` (per design.md
  Decision 2 rationale) while `OutputFieldContract`/`OutputContract` are ordinary case classes — fine
  as documented, just flagging for the sibling-shape tickets' authors that the "closed set" is a soft
  convention, not compiler-enforced beyond the file.
- No `Registry`-parity test yet (deferred per design.md Decision 4 until a second shape exists) — this
  is an accepted, documented risk with a clear trigger for when to add it, not a gap in this ticket.
