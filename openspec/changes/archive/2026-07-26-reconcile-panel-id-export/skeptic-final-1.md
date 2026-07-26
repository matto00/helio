## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Additive-field claim, not a shadow/replace** — read `backend/src/main/scala/com/helio/api/protocols/DashboardProtocol.scala` diff directly. `DashboardSnapshotPanelEntry` gained `id: Option[String]` as a new field alongside the unchanged `snapshotId: String`; `fromDomain` sets `snapshotId = panel.id.value` (unchanged line) and separately `id = Some(panel.id.value)` (new line). `jsonFormat5` → `jsonFormat6`. No occurrence of `id` replacing, aliasing, or shadowing `snapshotId` anywhere in the file.

2. **Backward compatibility, concretely run** — read and ran the new test in `ApiRoutesSpec.scala` ("import a snapshot whose panel entries omit the `id` field succeeds identically to one that includes it"). It performs a real export, then `snapshot.panels.map(_.copy(id = None))` — a genuine field-removal via the Scala case-class copy (not "present but null"; since `id: Option[String]`, `None` decodes/encodes with the key entirely absent from wire JSON — spray-json's default `OptionFormat` omits `None` fields). POSTs the stripped payload to `/api/dashboards/import`, asserts `201 Created`, correct dashboard name/panel count, fresh panel id. Ran `sbt -batch 'testOnly com.helio.api.ApiRoutesSpec'` fresh: **196/196 passed**, including this test and the export-side `id == snapshotId == panel.id.value` assertion. Also ran `DashboardSnapshotValidationSpec` (helper defaults `id = None`) and `AggregatorRegressionSpec` (round-trip): **17/17 passed**. Combined with the ApiRoutesSpec run, all 213 tests the evaluator claimed to run actually pass, independently reproduced.

3. **`snapshotId`'s import-remap role byte-for-byte unchanged** — `git diff main...HEAD -- '**/DashboardSnapshotRepository.scala' '**/DashboardServiceValidation.scala'` produced empty output (confirmed both files have zero changes in this branch).

4. **helio-mcp end-to-end passthrough** — read `helio-mcp/src/helioApi.ts:159-173` directly: `getDashboard` calls `this.http.get<DashboardSnapshot>('/api/dashboards/:id/export')` and returns `{ ...record, panels: snapshot.panels }` — a verbatim spread with no field filtering/transformation. `DashboardSnapshot["panels"]` is typed as `SnapshotPanelEntry[]`, which now includes `id?: string` (`helio-mcp/src/types.ts` diff). Since TS types are compile-time only and the generic `http.get<T>` just parses the JSON response, the backend-emitted `id` key flows through unmodified at runtime — confirmed by code inspection, no MCP-side code change needed (matches design.md D5). `npx tsc` build in `helio-mcp/` is clean.

5. **No scope creep** — `git diff main...HEAD --stat` (excluding openspec change-artifact files) touches exactly: `DashboardProtocol.scala`, 3 backend test files, `dashboard.ts` (FE type), `read.ts` + `types.ts` (helio-mcp). No trace of external-run-hook (HEL-369) or pie/scatter-aggregation (HEL-624) code anywhere in the diff.

6. **Spec delta accuracy** — read `openspec/changes/reconcile-panel-id-export/specs/dashboard-export-import/spec.md` in full. The "Export dashboard endpoint" requirement explicitly carves the exception: "...SHALL NOT include server-assigned IDs... **except** each panel entry's `id` field, which is an intentional, additive exception..." — not left contradictory. A new scenario "Import of a pre-existing snapshot lacking the `id` field" was added and matches the shipped test. Confirmed no drift between spec prose and implementation (field names, ignore-on-import semantics, `Option`-tolerance all match).

7. **Full backend compile** (`sbt -batch compile`) succeeded clean. Frontend ESLint on the touched file (`dashboard.ts`) and `npm run check:schemas` both pass clean (schemas correctly not touched — no existing snapshot schema file exists to drift, per design.md D4, verified: "schemas in sync... 29 checked").

8. Confirmed `CurrentVersion` still `2` (no bump) per D3 — grepped `DashboardSnapshotPayload.CurrentVersion` usage in the passing version-rejection test ("should reject a prior wire version") in `DashboardSnapshotValidationSpec`, which still passed.

### Minor observation (non-blocking)

- design.md (D6, Planner Notes), proposal.md, and evaluation-1.md all assert the `helio-news` client-simplification AC ("could be simplified to `p["id"]`") was "filed as a spinoff ticket." I checked HEL-368's Linear relations (`relatedTo`) and HEL-344's (the parent epic) — no new spinoff ticket relation exists beyond the pre-existing HEL-363 link, and I found no record in `workflow-state.md` of an actual ticket-creation tool call. This claim may be aspirational language rather than a completed action. It does not block this gate: the ticket's own AC is phrased as a soft "could be simplified" (not a hard requirement), the actual work is genuinely cross-repo/out-of-workspace, and Out of Scope correctly excludes touching `helio-news`. Flagging only so the human confirms whether a real spinoff ticket exists or should be created.

### Verdict: CONFIRM

### Non-blocking notes
- See "Minor observation" above re: unverified spinoff-ticket-filing claim — worth a quick human check, not a delivery blocker.
- No UI surface changed (type-only frontend edit); DESIGN.md review was not applicable — confirmed via grep that no frontend component logic branches on `id` vs `snapshotId`.
