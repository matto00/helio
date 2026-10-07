## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `d44dbac1e49e2b63590e0c57aa305156fc7becd2`. The base was resolved live with `resolve-review-base.sh` (exit 0), giving `54c2f222e09adcaa49fcf0b86bf643a3fc3f3426`. The spawn-cwd guard returned `READY ambient=/home/matt/Development/helio branch=feature/output-history-payloads-toggle/HEL-1331`.

### What I verified (with evidence)

**Owner rulings provenance.** `.concertino/runs/HEL-1331/events.jsonl` line 5 is `escalation.answered` with `answer_source: human` and `sub_answers` = `disabled-with-note`, `plain-with-limits`, `pipeline-owner-tier` and `expire-normally`. These match Option A for Q1–Q4, as recorded in `ticket.md`.

**AC1 / Q1 / Q2 / Q4: the editor toggle and its copy.**
- `HistoryPayloadsField.tsx` uses the shared `Toggle` with the label "Keep each run's rows". The help text matches the Q2 ruling character for character, and the Q4 opt-out sentence is appended.
- When the toggle is not available, it is disabled and shows the note "Free stores run summaries only" with a `Link` to `/settings#beta-access`. It is still visible, as Q1 requires.
- The History section renders only in edit mode (`!isCreate`), which makes sense because there is no Output to read availability from yet.

**Q3 / C1: gating on the pipeline owner's tier.**
- `available={output?.historyPayloadsAvailable === true}`. Nothing in the diff reads `User.tier`.
- Backend: `NodePayloadHistoryRepository.payloadsAvailableFor` joins `pipelines.owner_id → users.tier` and applies the same `PayloadTierLimit.allowsPayloads` (`maxRuns > 0 && maxAge > 0`, `PayloadHistoryConfig.scala:11`) that the writer uses.
- The query is parameterized (`sql"$i"`) and only receives pipeline ids the service has already authorized.
- I traced every way an Output enters the frontend store (`outputsSlice`: fetchOutputs, fetchAllOutputs, createOutput, updateOutput). Each one goes through one of the 5 REST routes that `withAvailability` now stamps, so the editor never sees an Output without the flag.

**Save semantics.**
- `OutputService.update` does a shallow `mergeConfig`, so `withHistoryPayloads` omitting the key preserves the stored value. That was the risk I checked first.
- Live, I took a beta-owned table Output, turned the toggle on and saved. The PATCH body was `{"name":"SK beta table","config":{"fieldMapping":{},"columnFormats":{},"historyPayloads":true}}`.
- Re-reading the Output afterwards returned `config.historyPayloads: true` and `historyPayloadsAvailable: true`. I did this in both themes.

**Additional AC: the flag on all REST sites, the schema, and tests.**
- I re-ran `sbt "testOnly com.helio.api.OutputHistoryPayloadsAvailableSpec"` myself: 7 run, 7 succeeded, 0 failed.
- The spec covers free, beta and owner pipeline owners, an unknown id, an unknown tier mapping to false, all 5 sites, and a free editor grantee on a beta-owned pipeline (GET, POST and PATCH all return `true`).
- The spec builds the real `ApiRoutes(... dbContext = ctx)`, so it also proves the wiring at `ApiRoutes.scala:940`.
- `schemas/outputs/output.schema.json` documents the field as `readOnly`.

**AC2: MCP.**
- `HISTORY_PAYLOADS_CONFIG_DOC` is appended to the `update_output` description. It covers the caps, the tier rule, `historyPayloadsAvailable` and the fact that turning the setting off does not purge stored rows.
- The `config` input is `z.record(z.string(), z.unknown())`, so the key passes through to the API unchanged.
- `get_output` and `list_outputs`, which the doc names, call `GET /api/outputs/:id` and `GET /api/pipelines/:id/outputs`, so both carry the flag.
- I ran the jest tests for `outputsHandlers` and `server` myself: 2 suites, 37 tests, all pass.

**AC3: frontend tests.** I re-ran the `OutputEditorSheet*` and `useScrollToHashSection` tests: 4 suites, 48 tests, all pass.

**AC3: the running app in both themes (my own Node and Playwright script).**
- The script used its own `chromium.launch()` context, not the shared MCP browser or cookie jar. It ran with 1 worker under `nice -n 19` against DEV_PORT 6763 and BACKEND_PORT 9670.
- `start-servers.sh` reused healthy servers, and `assert-phase.sh servers` printed `PASS servers`.
- I created fresh `*@example.test` users and every source and pipeline I seeded was deleted by exact id (all `204`). `matt@helio.dev` was never touched; the tier update SQL excludes it.
- The live API returned `historyPayloadsAvailable` as `true` for beta owners and `false` for free owners. That shows the running backend serves this field correctly, so I did not rely on comparing the process start time with file modification times.
- Screenshots were taken after a 600 ms settle; durable refs below:
  - beta, off, light: `/home/matt/Development/helio/.concertino/runs/HEL-1331/evidence/e2e-evidence/HEL-1331-skeptic/section-beta-light-initial.png`
  - beta, on, light: `/home/matt/Development/helio/.concertino/runs/HEL-1331/evidence/e2e-evidence/HEL-1331-skeptic/section-beta-light-on.png`
  - beta, on, dark: `/home/matt/Development/helio/.concertino/runs/HEL-1331/evidence/e2e-evidence/HEL-1331-skeptic/section-beta-dark-on.png`
  - free, disabled, light: `/home/matt/Development/helio/.concertino/runs/HEL-1331/evidence/e2e-evidence/HEL-1331-skeptic/section-free-light-initial.png`
  - free, disabled, dark: `/home/matt/Development/helio/.concertino/runs/HEL-1331/evidence/e2e-evidence/HEL-1331-skeptic/section-free-dark-initial.png`
  - Settings landing page, dark: `/home/matt/Development/helio/.concertino/runs/HEL-1331/evidence/e2e-evidence/HEL-1331-skeptic/settings-dark.png`
- **Design judgment, against DESIGN.md and the sibling sections of the sheet:**
  - The section reuses the sheet's own card group, `__edit-section-heading`, `__data-section` grid and `__field-hint`/`__type-hint` classes. Its heading, card radius and padding match the Compare and Preview cards next to it.
  - The "on" state uses the solid accent track in both themes. The disabled state dims both the track and the label, and is clearly different from "off".
  - The upsell link uses `--app-accent-text` and `--weight-semibold` with an underline, the same per-feature pattern as the existing links (`PipelinesPage.css:68`, `CreatePipelineModal.css:58`). It reads legibly in both themes (computed light `rgb(157,59,8)`, dark `rgb(250,135,55)`).
  - Light and dark are at parity. The new CSS uses tokens only.
- **Settings link:** the link navigates to `/settings#beta-access`. The "Beta access" heading lands inside the viewport (y=657 in light, 429 in dark, at a viewport height of 900) because the page is scrolled to the bottom.
- **Console:** the only error was one resource 404 per flow. The evaluator attributes this to the pre-existing `GET /api/pipelines/:id/schedule` request for a pipeline with no schedule; I did not re-attribute it myself. There were no page errors.

**Evidence timing.** No claim above rests on file modification times or directory order. The executor's `editor-beta-on-*.png` screenshots were captured mid-transition (the thumb is not fully travelled). That is only how the evidence was captured, not a defect: my settled screenshots show the correct end state.

### Verdict: CONFIRM

### Non-blocking notes

- **Cross-tier copy edge case.** When a beta or owner viewer edits an Output on a free-owned pipeline, the switch correctly disables (Q3). But the note still says "Free stores run summaries only — Request Beta access", which points the viewer at an upgrade that would not help, because it is the pipeline owner's tier that matters. The rulings prescribed this exact copy, so this is not a defect. It could be refined later, for example: "This pipeline's owner is on Free".
- **Visual hierarchy.** The disabled-state note uses `__type-hint` (`--text-sm`, 14px) while the help text above it uses `__field-hint` (`--text-xs`, 12px), so the subordinate note renders larger than the help. There is also no punctuation between "Free stores run summaries only" and the link. Both are minor polish.
- **Hardcoded copy.** The help text and the MCP doc hardcode the default caps and retention. An env override (`PAYLOAD_HISTORY_*`) would make the copy stale. The code comment acknowledges this.
- **Unsaved edits on navigation.** Clicking "Request Beta access" from inside the editor navigates away and discards any unsaved edits without a prompt.
- **`e2e-evidence/` and the pre-commit hook.** My run, like the repo's e2e run, wrote into the gitignored `e2e-evidence/` directory in this worktree. As the evaluator noted, that directory trips `check-no-credential-in-agent-surface.mjs` COVERAGE DRIFT, a pre-existing gap from HEL-1363. Any further commit in this worktree has to move it aside first. It needs a follow-up ticket.
