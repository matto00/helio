## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `742fbe51d29e3ae39ce97600df5437ebed0ea6c7`. The diff base `6218cd479966e7c5f04a75d993216a464d726cd7` was resolved live with `resolve-review-base.sh` (exit 0). The branch has one commit on top of it.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/output-charttype-render-docs/HEL-1304`.
- **Premise drift:** this is real. On base, `resolvePanelChartType.ts` already resolves panel appearance, then Output `config.chartType`, then `line`. It is used at `ChartOutputPanel.tsx:68` and `PanelCard.tsx:463`. The restated scope in proposal.md matches the tree.
- **AC1 (the repro renders bar with no appearance call):** I ran `e2e/hel1304-output-charttype-render.spec.ts` myself against the pinned 6736/9643 servers. Both tests passed (light 5.0s, dark 6.0s). The spec creates Outputs with `POST /api/pipelines/:id/outputs` and places them with the `POST /api/panels/batch` body `{type:"output", config:{outputId}}`, which sends no appearance. It then asserts the live ECharts `series[].type`. PlacedBar rendered `bar` and PlacedPie rendered `pie`. The screenshots confirm this visually.
- **AC2 (a panel `chartType` overrides the Output):** In the same run, the Override panel was patched to `chartType:"line"` and rendered `line`.
- **AC3 (place_outputs description):** `placements.ts:44-49` states the three-level precedence. It says a placement stores no chart type, and names `update_output` and `update_panel_appearance` as the two ways to change it. `write.ts:727-729` is corrected to match. I ran `chartTypeDescriptions.test.ts` myself: 5/5 passed.
  - These assertions are red against base text, judged from the content. Base `placements.ts` contains `fieldMapping/aggregation/chartType` and has no precedence sentence. Base `write.ts` contains "renders as the line default".
- **D1 (backend merge-base fix):**
  - **The change:** `model.scala:473` now uses `existing.chart.getOrElse(ChartAppearance.Default.copy(chartType = None))`.
  - **Red-first, from the code rather than mtimes:** `ChartAppearance.applyPatch` (`model.scala:372`) sets `chartType = patch.chartType.fold(existing.chartType)(identity)`. On base the chartless fallback was `ChartAppearance.Default`, whose `chartType` is `Some("line")`. So a legend-only patch stored `Some("line")` on base. That means:
    - the new unit assertion `chartType = None` fails on base;
    - the e2e LegendOnly panel would render `line` on base, because `resolvePanelChartType` returns the stored type first.
    - Both red claims follow deterministically from the base code. I did not rebuild base to watch them fail.
  - **Green, unit:** I ran `sbt "testOnly com.helio.domain.model.PanelAppearanceMergeSpec"`: 13/13 passed, including the new HEL-1304 case and the unchanged pie-on-chartless and explicit-null cases.
  - **Green, live:** in my e2e run the LegendOnly panel rendered `bar` with its legend hidden. This also proves the running backend has the fix, without relying on process start times.
- **Blast radius of D1:** I grepped all callers of `applyPatch`/`applyPatchJson` (`PanelMutationRepository`, `PanelServiceHelpers`, patch-set apply/rollback). None depends on a chart patch inventing `"line"`. The rollback writes an explicit full chart or `null`, so it is unaffected. `ChartAppearance.Default` itself is unchanged, so proposal and first-run paths still store explicit types.
- **UI write paths:** `PanelDetailModal.buildInitialChart` still defaults `chartType` to `"line"` in local state. However, `AppearanceEditor` is mounted with `showChartSection={false}`, and `handleEditSubmit` sends only background, color and transparency (`PanelDetailModal.tsx:330-345`). No UI path writes a chart, so the defect cannot come back through the UI.
- **Servers:** `start-servers.sh` reused healthy instances and `assert-phase.sh servers` printed `PASS servers`. The listener cwds are this worktree's `frontend/` and `backend/`. Freshness is proven by the LegendOnly result above, not by mtime ordering.
- **UI/design judgment:** the frontend diff is docstring-only (`chartAppearance.ts`, `chartClickSelection.ts`), so no CSS, component or token surface changed. In the screenshots, light and dark render the same way:
  - the chart types are correct;
  - the cards are consistent with sibling panels;
  - the hidden legend on LegendOnly matches its patch;
  - there is no visual regression.
  - Screenshots, persisted at capture:
    - `/home/matt/Development/helio/.concertino/runs/HEL-1304/evidence/e2e-evidence/HEL-1304/output-charttype-light.png` (sha256 `87f51ab9c5bfee687c490931387a7e213998b262cbc267ccc47b915528a97d41`)
    - `/home/matt/Development/helio/.concertino/runs/HEL-1304/evidence/e2e-evidence/HEL-1304/output-charttype-dark.png` (sha256 `a84576f60d0c986ebeb0027a4af2b0ff5b3ebc68e1a24b36be989eaa9ef06002`)
- **Constraints:**
  - C1 holds: `ci.yml`, root `package.json`, the lockfile and `.audit-ci.jsonc` are not in the diff stat.
  - C2 holds: evidence goes through `evidencePath`, and source, pipeline and dashboard are deleted by exact id in `finally`.
  - C3 holds: I ran everything under `nice -n 19` with at most 2 workers.
- **Gate-defect check (CON-160):** evaluation-1.md uses mtime and process-start ordering to support the red-then-green sequence. It does not disclose its evidence-dir mtimes as unsound. I did not accept that ordering. Red-first is established above from code content, so there is no gate defect to record.

### Verdict: CONFIRM

### Non-blocking notes
- **Evidence overwrite:** my persist step overwrote the evaluator's durable screenshots at the same two `ref` paths. Their content is equivalent, from a fresh run of the same spec, but evaluation-1.md's cited sha256s (`2ea187fb…`, `e68ea7a6…`) no longer match those files. Treat the hashes in this report as current.
- **Dev-DB residue from my e2e run:**
  - Two users, by exact id: `0b980eb2-2b2a-4256-83ed-a7c2dc3d9921` (light) and `30ec9b37-df47-4486-b5e3-527d11a160e4` (dark). They are left because there is no user-delete endpoint.
  - The spec's `finally` deleted the following rows by exact id:
    - light run: source `b89a58aa-556e-4bcf-a589-88a71997989e`, pipeline `79d6c0ec-fac6-4d48-a7c2-40b1c976e4fe`, dashboard `f1957f1a-f498-4480-8508-edb4767acd0b`
    - dark run: source `33615521-c283-45f4-ac0b-73fc6994473d`, pipeline `d995bd1e-5676-4341-8356-c43a4c753917`, dashboard `8e59fdcc-7acb-4b36-b224-eb15783943a3`
- **Stale editor default:** `PanelDetailModal.buildInitialChart` defaults chartType to `"line"`, which is now stale. It is harmless today because the chart section is hidden. If that section is ever re-enabled, it should seed from `resolvePanelChartType`, or omit `chartType`, so it does not reintroduce this defect.
- **PR body items:** carry the evaluator's notes on the `model.scala` split and on the duplicated fiber-walk helper.
