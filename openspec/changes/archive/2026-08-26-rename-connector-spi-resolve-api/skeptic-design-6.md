## Skeptic Report — design gate (round 6, skeptic-design-6.md)

**This is the LAST design-gate round regardless of outcome** (deliberate, human-approved one-time
extension beyond `SKEPTIC_DESIGN_ROUNDS=5`, recorded in workflow-state.md). If REFUTE, the
orchestrator applies the fix below and proceeds straight to Execution with no round 7.

**Narrow scope, as instructed:** the single question "is the enumeration of NON-COMPILED references
complete?" I did not re-litigate the RENAMED sections, scenario-title strategy, archive rehearsal, or
the 46/9 file counts — those are treated as settled by rounds 1-5.

### What I verified (with evidence)

I deliberately did NOT re-run the change's own pattern as my primary method. I ran alternate,
structurally-different searches designed to find what that pattern cannot see:

1. **Case-insensitive bare-word `connector` prose sweep across all `*.md`** (repo-wide, excluding
   `openspec/changes/archive/**` and this change's own dir). Result: the only `.md` files naming an
   old identifier are `backend/src/main/scala/com/helio/domain/connectors/README.md` (task 1.6) and
   `openspec/specs/**` (task 4.x). `notes/**`, `infra/README.md`, `backend/README.md`,
   `backend/.../domain/README.md`, `.../domain/engine/README.md`, `.../domain/model/README.md`,
   `.../api/routes/sources/README.md`, `.../api/protocols/sources/README.md`,
   `frontend/src/features/sources/README.md` mention only the lowercase *package/concept* word
   `connectors` or unrenamed names (`ConnectorRegistry`, `ConnectorRoutes`, `ConnectorProtocol`,
   `connectorService.ts`) — none require an edit. **Clean.**

2. **`docs/`, `.claude/`, `scripts/`, `CLAUDE.md`, `notes/`, `infra/`** searched for
   `sqlconnector|restapiconnector|list_connectors|api/connectors|Connector\.scala|Connector\[`
   (case-insensitive). **Zero matches.** The instruction's "any committed prompt, skill, or script
   naming `list_connectors`" and "`CLAUDE.md`/`docs/**` mentions" categories are genuinely empty.

3. **`helio-mcp` prose beyond the tool name.** Read `src/tools/read.ts:196-209` — the
   `list_connectors` tool's `title` ("List connectors") and `description` text contain no old
   identifier, only the generic word "connector kind"; no description edit needed. `scripts/verify.ts`
   has exactly two references (`section("list_connectors")` at :64 and the `name: "list_connectors"`
   call at :71) — both already in task 3.4's scope. `types.ts:444,453` doc comments (task 3.4).
   `helioApi.ts:306-307` (task 3.4). No `helio-mcp/README.md` mentions connectors at all. **Clean.**

4. **Bare backticked `` `Connector` `` (no `[`, no `.scala`, no `.testConnection`) in
   `openspec/specs/`** — a form the pattern is structurally blind to. Found
   `openspec/specs/connector-spi/spec.md:98` (`The \`Connector\` trait SHALL document …`) and the
   requirement headers at :8, :27, :48, plus `fetch-error-envelope/spec.md:60` and
   `connector-secret-redaction/spec.md:109`. I checked each against the deltas: :98's requirement
   ("refresh has no distinct SPI method") IS carried in the delta at
   `specs/connector-spi/spec.md:104-111` with the name updated, and :8/:27/:48/:60/:109 are all
   covered by RENAMED entries in their respective deltas. **Covered — not a miss.**

5. **A tenth capability outside the 9-file set**: `openspec/specs/schema-inference/spec.md:117`
   `#### Scenario: Connector failure returns 502`. Scenario title only, and design.md decision 5a
   deliberately never renames scenario titles. **Correctly out of scope — not a miss.**

6. **Split-across-lines mentions** (`grep -nE '\bConnector$'`) — only compiler-caught imports and
   already-covered spec headers. **Clean.**

7. **Frontend prose**: `frontend/src/features/pipelines/services/pipelineService.ts:294` names
   `connectorService.listConnectors()` in a doc comment — but decision 3a deliberately KEEPS the
   `listConnectors` client method name, so this correctly needs no edit. **Not a miss.**

8. **Alternate written forms of the route path** — this is where I found the miss (below).

### Verdict: REFUTE

One real, reproduced, non-compiled reference shape that the current pattern is structurally incapable
of matching, and which tasks.md additionally describes **incorrectly**.

### Change Requests

1. **`backend/src/test/scala/com/helio/api/routes/sources/ConnectorRoutesSpec.scala` contains six
   `/connectors` route references the pattern cannot see, and tasks.md 2.1 asserts a false line
   number for this file.**

   The change's fully-widened pattern matches the route only as `/api/connectors\b` — i.e. it
   *requires* the `/api` prefix. `ConnectorRoutesSpec` is a `ScalatestRouteTest` that mounts
   `ConnectorRoutes` directly, so it addresses the route **without** the `/api` prefix:

   ```
   ConnectorRoutesSpec.scala:23:  "GET /connectors" should {
   ConnectorRoutesSpec.scala:26:      Get("/connectors") ~> routes ~> check {
   ConnectorRoutesSpec.scala:35:      Get("/connectors") ~> routes ~> check {
   ConnectorRoutesSpec.scala:47:      Get("/connectors") ~> routes ~> check {
   ConnectorRoutesSpec.scala:55:      Get("/connectors") ~> routes ~> check {
   ConnectorRoutesSpec.scala:63:      Get("/connectors") ~> routes ~> check {
   ```

   Reproduce with:
   `grep -rnE '"/connectors"|/connectors\b' --include=*.scala backend/src | grep -v 'api/connectors'`

   The only line in this file the widened pattern *does* see is :14 (a Scaladoc mention of
   `` `GET /api/connectors` ``). That is exactly why **tasks.md 2.1's parenthetical is wrong**: it
   states "`ConnectorRoutesSpec` (its matches are route-name references at line ~14…)". Its matches
   under the pattern are at line 14; its *actual* references are at 14, 23, 26, 35, 47, 55, and 63.
   An executor trusting that parenthetical, and then trusting task 5.3's `/api/connectors\b` grep as
   the falsifiable exit check, will get a false-clean on this file.

   Severity is bounded (leaving lines 23-63 unchanged makes the route 404 and `sbt test` fails, so it
   cannot ship broken) — consistent with the round's premise that residual risk here is stale/wrong
   documentation and a blind verification check, not a functional defect. But the *verification
   claim* is unfalsifiable as written, which is precisely what rounds 1-5 kept correcting.

   Required revisions:
   - **tasks.md 2.1** — replace the `ConnectorRoutesSpec` parenthetical with: matches at `:14`
     (Scaladoc, `/api/connectors` form) and `:23, :26, :35, :47, :55, :63` (bare `/connectors` route
     literals and the enclosing `"GET /connectors"` `should` block description), all of which move to
     `connector-types` under task 3.2.
   - **tasks.md 3.2** — make the `ConnectorRoutesSpec.scala` clause explicit that it is six
     bare-`/connectors` sites plus the `:14` doc comment, not a single path string.
   - **Widen the pattern one final time** in tasks 2.1, 3.2 and 5.3 from `/api/connectors\b` to
     `(/api)?/connectors\b` (or add an alternation `"/connectors"`), so the exit check can actually
     see the bare form. In task 5.3, note that `(/api)?/connectors\b` will also match the harmless
     lowercase package-path prose in the `domain/README.md` files
     (`domain/connectors/`, `model/connectors/engine/util`) and the `scripts/check-schema-drift.mjs:18`
     comment — add these as a **fourth named exclusion** with an expected count, so the check stays
     falsifiable rather than becoming noisy-and-ignored.

### Non-blocking notes

- Categories 1, 2, 3, 5, 6 and 7 above came back genuinely clean. After six rounds the only
  remaining shape I could break the pattern with was the prefix-less route path; I could not find any
  synonym-form ("the connector interface", "the SPI trait") prose reference anywhere outside
  `openspec/changes/archive/**`. I judge the non-compiled enumeration complete once CR-1 lands.
- HEL-804's pre-existing stale-FQN drift was left untouched as instructed; I saw instances
  (e.g. `openspec/specs/schema-inference-facade/spec.md:63` says `domain/Connector.scala` where the
  file actually lives at `domain/connectors/`) and deliberately did not flag them for this change.
