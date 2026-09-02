## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review of `6c0974c0` against `main`. Every conclusion below is derived from a
command I ran myself in this worktree, not from evaluation-2.md or the executor's report.

### 0. Environment freshness — a FIFTH stale-server catch (found and fixed by me)

`start-servers.sh` reported "already healthy … reusing" for both ports, but:

```
HEAD:    6c0974c08a4afad091cc3d14398c3577f3e8638f  Wed Sep 2 12:12:25 2026 -0700
backend: pid 2655494  STARTED Wed Sep  2 11:42:41 2026
```

The backend predated HEAD by 30 minutes — it did **not** contain the CR1 fix. Any
live evidence gathered against it would have been worthless. I killed 2655494,
re-ran `start-servers.sh`, and confirmed the replacement:

```
pid 2720497  STARTED Wed Sep  2 12:15:12 2026
assert-phase.sh servers → PASS servers
```

All live probes below ran against pid 2720497. Note for the orchestrator: this
script has now silently reused a stale backend five times on this ticket; it has
no `--force` flag. That is a harness gap, not a defect in this diff.

### 1. CR1 — irrevocable public-share grant. VERIFIED FIXED, live.

Code read (`PermissionRoutes.scala:44-53`): `path("public")` is placed **before**
`path(UserIdSegment)`. This ordering is load-bearing — `IdParsing.scala:21` defines
`UserIdSegment = Segment.map(UserId(_))`, a *bare* `Segment`, so it would happily
match the literal `"public"` if it came first. Ordering is correct as written.
`ResourcePermissionRepository.deletePublic` filters `r.granteeId.isEmpty` (SQL
`IS NULL`), which is the right shape; `PermissionService.revokePublic` reuses the
same `requireOwnerOnly` ACL as `revoke`.

Full lifecycle exercised end-to-end against the fresh backend on a throwaway
dashboard `e8312f4c-d244-4952-8d43-ff971342aade`:

| # | probe | result |
|---|---|---|
| 1 | anon `GET /api/dashboards/:id/panels` before grant | `404` |
| 2 | owner `POST .../permissions {"role":"viewer"}` | `201` |
| 3 | anon `GET .../panels` after grant | `200` `{"items":[],...}` |
| 4 | owner `GET .../permissions` | `200` one grant, no `granteeId` |
| 5 | owner `DELETE .../permissions/public` | **`204`** (was `500` in round 1) |
| 6 | anon `GET .../panels` after revoke | `404 {"message":"Dashboard not found"}` |
| 7 | second `DELETE .../permissions/public` | `404 {"message":"Permission not found"}` — sane, not a 500 |
| 8 | owner `GET .../permissions` | `200 {"items":[]}` |
| 9 | **anonymous** `DELETE .../permissions/public` | `401 Unauthorized` — ACL holds |
| 10 | `DELETE .../permissions/<a real UUID>` (no such grant) | `404` — UUID-segment route still reachable, not shadowed by `path("public")` |

Probe dashboard deleted (`204`). Shared dev DB verified clean afterwards:
`SELECT count(*) FROM resource_permissions WHERE grantee_id IS NULL` → `0`.

This was the one genuinely production-load-bearing finding of round 1 (HEL-910 is
what first routes real row data through this grant anonymously). It is closed.

### 2. CR2 — cross-dashboard panel confinement guard. VERIFIED LOAD-BEARING.

Read `PublicDashboardRoutesSpec.scala:229-255` and the implementation
(`PublicDashboardRoutes.resolveRows`, lines 76-93, which scopes via
`panelRepo.findAllByDashboardId(...).find(_.id.value == panelId)`).

I did **not** take the executor's "confirmed red-first" claim. I derived the
guard's failability myself from the test's own structure, which is what makes it
non-vacuous: the test contains a **positive control** — `otherPanelId` is first
asserted to return `200` with exactly 1 row against *its own* dashboard URL. The
second request is byte-identical except for the `dashboardId` path segment. An
unscoped `findByIdInternal(panelId)` lookup ignores `dashboardId` entirely, so it
would necessarily take the identical code path and return the same `200` + 1 row,
failing the `StatusCodes.NotFound` assertion. The assertion also pins the message
(`should include("Panel not found")`), which is reachable only via the single
`Left` branch in `resolveRows`. This is a genuine mutation-failable guard, not a
test that passes for unrelated reasons.

(I deliberately did not mutate `resolveRows` to observe red — the skeptic role is
read-only. The positive control makes the derivation sound without mutation.)

### 3. CR3 — Output-bound export→import round trip. VERIFIED, asserts outputId identity.

Read `ApiRoutesSpec.scala:1546-1644`. It does assert on `config.outputId` identity,
in three independent places, not merely dashboard-level fields:

- export snapshot: `snapshot.panels.head.config.asJsObject.fields("outputId") shouldBe JsString(outputId)`
- import result: `result.panels.head.config.asJsObject.fields("outputId") shouldBe JsString(outputId)`
- re-export of the *imported* dashboard: `roundTripPanel.config shouldBe originalPanel.config`

Plus `type`, `title`, `appearance`, dashboard `appearance`/`name`/`version`, and all
four layout geometry fields (`x`/`y`/`w`/`h`), with `importedPanelId should not be
panelId` proving the ids legitimately differ rather than the whole thing being the
same row. The Output is created as a real `outputs` row via direct SQL, so the
importer's new `findByIdOwned` check is genuinely exercised. This covers AC2's
first half, which previously had only zero-panel / divider-panel coverage.

Green in the full suite run below.

### 4. `pipeline-run-execution` delta — well-formed AND honest.

```
$ npx openspec validate public-dashboards-export-docs-sweep --strict
Change 'public-dashboards-export-docs-sweep' is valid
```

Content check: this is **not** a token rename that misdescribes the requirement.
The delta's `### Requirement:` heading and all five `#### Scenario:` headings match
`openspec/specs/pipeline-run-execution/spec.md:160,173,179,185,190,195`
**byte-for-byte**, which is what a `MODIFIED` delta needs to merge on archive. The
delta explicitly calls out in its own body that the heading/scenario names still
read "Type Registry"/"Output DataType", explains that this is deliberate (a rename
belongs in a `RENAMED Requirements` delta, not smuggled into a same-cycle body
edit), and corrects the substance — first-row inference → shallow union inference
over the full per-node row set; no `version` counter exists to increment. That is
an honest delta that names its own residual, rather than papering over it.

### 5. `docs/agent-native.md` — genuinely unchanged AND genuinely current.

```
$ git diff main...HEAD --numstat -- docs/agent-native.md
(no output — zero bytes changed)
```

Currency spot-checked against ground truth, not asserted: the doc's rename table
(lines 182-192) enumerates exactly the 16 names in
`helio-mcp/src/server.test.ts`'s `REMOVED_TOOLS` (`create_panel`, `create_panels`,
`bind_panel`, `create_bound_panel`, `get_panel_capabilities`,
`create_pipeline_from_shape`, `list_data_types`, `get_data_type_rows`,
`update_data_type`, `delete_data_type`, and the five metric tools), and every
replacement it names (`place_outputs`, `create_content_panel`,
`add_outputs_from_shape`, `get_output_capabilities`, `get_output_rows`,
`list_outputs`) is in that spec's `EXPECTED_TOOL_NAMES`. The doc also correctly
flags `scripts/agent/*.sh` as stale rather than presenting them as current.
`tasks.md` 4.2 is now reworded from "Update" to "Verify … (Confirmed already
current … zero bytes)", which matches reality.

### 6. Full gate suite, re-run fresh by me (nothing regressed cycle 2 → cycle 3)

```
backend-test  cd backend && sbt test
              [info] Total number of tests run: 3553
              [info] Tests: succeeded 3553, failed 0, canceled 0, ignored 0, pending 0
              [info] All tests passed.
              [success] Total time: 219 s, completed Sep 2, 2026, 12:20:34 PM   → exit 0

test          npm test
              Test Suites: 252 passed, 252 total
              Tests:       2588 passed, 2588 total                              → exit 0

lint          npm run lint (eslint src --max-warnings=0)                        → exit 0
format        npm run format:check  "All matched files use Prettier code style!" → exit 0
build         npm --prefix frontend run build  (dist/sw.js emitted, PWA v1.3.0) → exit 0
typecheck     npm run typecheck (tsc --noEmit)                                  → exit 0
openspec      npm run check:openspec  "openspec/ is clean"                      → exit 0
```

3553 backend tests confirms the executor's +3 claim independently.

### 7. AC6 final sweep — independently re-run, clean.

```
$ grep -rnE "dataTypeId|DataTypeId|metricId|MetricId|type_id|MetricDefinition|/api/types|/api/metrics" \
    backend/src frontend/src helio-mcp/src schemas/ openspec/specs
```
Every surviving hit is inside design.md Decision 6's allowlist: `db/migration/**`
(V5/V17/V35/V43/V46/V53/V58/V61/V75), HEL-NNN-prefixed retirement comments, or
`README.md` files that explicitly document the retirement
(`api/routes/pipelines/README.md`, `services/panels/README.md`). No live code path
or wire field carries retired vocabulary.

### 8. UI / design judgment

The frontend diff carries **zero visual change** — I checked: 21 files, all field
renames (`dataTypeId` → `outputId`) plus dead-code deletion, with no CSS, no token,
no spacing, no copy change. Verified by diffing for style-shaped additions
(`px`/hex/`rem`/`color:`) across `frontend/`: the only matches are two comment
lines. `ProposalReview.tsx` and `CombinedProposalReview.tsx` keep their user-facing
strings verbatim ("No Output bound", "Bound Output not found in this workspace",
"This pipeline's own output"). There is therefore no new design-language surface to
judge against DESIGN.md.

I still confirmed the app is a working web app (design.md Decision 17), which this
ticket owns as an AC rather than an assumption:

- `/` (dashboards) — renders, sidebar + panel grid intact, tokenised dark palette
  consistent, `OUTPUT` panel kind badge and freshness stamp render correctly
  (screenshot `.playwright-mcp/page-2026-09-02T19-20-20-140Z.png`)
- `/pipelines` — renders the full pipeline table with source, last-run status pill,
  last-run-at, rows-written, and Share affordance; no `/api/types` breakage
  (screenshot `.playwright-mcp/page-2026-09-02T19-20-27-257Z.png`)
- Console: **0 errors, 0 warnings** across both navigations.

### Verdict: CONFIRM

All three round-1 change requests are independently verified closed, the one with
real production exposure (CR1) by live HTTP probe rather than by reading a test.
Every gate is green from a fresh run I performed and read. The sweep AC holds under
my own grep. The app runs. This is shippable for the v0.7.8 first-ever production
deploy of the remodel.

### Non-blocking notes (follow-up ticket material — NOT merge blockers)

None of the following carries production runtime risk; all are documentation/spec
prose, all fall outside this ticket's literally-enumerated sweep patterns, and
three of the five predate this branch on `main`.

1. **Three live `openspec/specs` requirements are now factually false.** These are
   normative statements about a deleted concept, so they will mislead the next
   agent that reads them as ground truth:
   - `openspec/specs/frontend-data-sources-page/spec.md:9` — a scenario requires
     `SourcesPage` to render a **"Type Registry" section heading**. It does not
     (confirmed in the live UI); Type Registry was deleted wholesale by HEL-904.
   - `openspec/specs/empty-state-cta-pattern/spec.md:12` — lists **"Type
     Registry"** as one of the primary workspace sections that SHALL render an
     `EmptyState`. That section no longer exists.
   - `openspec/specs/resource-tagging/spec.md:34` — a `SHALL` over
     **`GET /api/types`**, a route HEL-904 deleted.

   (`openspec/specs/output-routes-api/spec.md:57,81` also names `/api/types/:id/...`
   but correctly as a "replacing X" historical reference — that one is fine, and
   `csv-upload-connector/spec.md:17` is already annotated "(removed by this
   ticket)".)

2. **`helio-mcp` tool descriptions still teach the retired canonical path to
   agents.** These are live, agent-facing description strings, not retirement
   notes, and they are unchanged from `main`:
   - `helio-mcp/src/tools/read.ts:71` (`list_data_sources`) and
     `helio-mcp/src/tools/pipelineProposal.ts:110` — "DataSource → Pipeline →
     **DataType** → Panel" / "Source → Pipeline → **DataType** → Panel".
   - `helio-mcp/src/tools/read.ts:58` (`get_dashboard`) — "the config carries the
     bound **DataType id + field mapping** for data panels". This is now simply
     wrong: the config carries `outputId`, and `fieldMapping` no longer exists.
   - `helio-mcp/src/tools/refinement.ts:68` — "workspace-wide pipeline-output
     **DataTypes** and their panel-capability menus".
   - `helio-mcp/src/tools/read.ts:5` (file header) — same stale path.

3. **`helio-mcp/src/types.ts:121` `export interface DataTypeResponse` is fully dead
   code** for a wholesale-deleted entity, and it still declares the retired
   `computedFields` and `version` fields. Zero references anywhere in
   `helio-mcp/src` (verified by grep). Pre-existing on `main`; the sweep's
   enumerated patterns (`DataTypeId`, `dataTypeId`, `computed_fields`) do not
   match `DataTypeResponse`/`computedFields`, which is why it survived.

4. **`start-servers.sh` has no way to force a restart** and reuses any process
   already listening on the port regardless of the commit it was built from. This
   ticket has now hit that trap five times. Worth an upstream Concertino fix (a
   `--force` flag, or a commit-stamp health check), not a change in this repo —
   `scripts/concertino/` is a render target.

5. The shared dev database is heavily polluted with probe artefacts from prior
   rounds of this and other tickets (`SWEEP-*`, `SKEPTIC-HEL321-*`, `HEL909-EVAL*`,
   dozens of `HEL-400 verify top-n *` pipelines). Not this ticket's doing and not
   shipped anywhere, but it is now dense enough to make UI evidence-gathering
   noisy for the next run.
