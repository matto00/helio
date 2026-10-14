## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, workflow-state.md, and skeptic-design-1.md (read as claims). HEAD is `5074b69377ea8ce1010739dddcf858448a3a0af5`; the change dir is untracked.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/live-draft-preview-spike/HEL-1580`.
- **Owner ruling start-now:** line 1 of `.concertino/runs/HEL-1580/events.jsonl` is `escalation.answered` with answer "start-now: owner approves starting the HEL-1580 spike before its Linear blocker HEL-1579 lands…".
- **20/7 step-kind split (R1-2):** there are 27 `domain/steps/*Step.scala` files. A grep for `ctx\.` matches exactly 7: AnalyzeWithAi, Assert, GenerateText, Lookup, Union, Join, UpsertSource. That leaves 20 pure kinds, matching the design's Context bullet. **Addressed.**
- **Parity precedent (R1-1):** `shared-test-fixtures/` has 13 files.
  - `output-summary-reducer.json` is read by `frontend/src/utils/aggregate.fixture.test.ts` and `backend/.../history/OutputSummaryReducerSeamSpec.scala`.
  - `frontend/src/utils/aggregate.ts` exists, and so does `parseChartInstant` (`chartTimeAxis.ts:130`).
  - The Context bullet, D3 and task 3.2 now cite these, and task 3.2 asks for a reuse-or-duplicate statement per area.
  - **Addressed.** One inaccuracy remains; see note 1.
- **Render timing (R1-3):** D2 and task 1.2 require a forced sync layout (`offsetHeight`) and a separate time to next frame (rAF then MessageChannel), each labelled. The filter thresholds vary deterministically across the 500 edits. Metric tiles are added to the render. **Addressed.**
- **Dependency resolution (R1-4):** the worktree has no root `node_modules` (confirmed with `ls`). The main checkout has `playwright-core` 1.55.1. `~/.cache/ms-playwright` has `chromium-1193` and `chromium_headless_shell-1193`, so it really matters which binary ran, and D2/task 1.3 require recording that. D2/1.3 also require recording an explicit module path, the resolved version and path, and `browser.version()`. **Addressed in requirement.** The example mechanism is flawed; see note 2.
- **Scala-side classification (R1-5):** D3 adds a `manifest.json` and a ScalaTest that iterates the real Registry. It fails on an unregistered or unclassified kind, and names the mutation "a new Scala kind without a manifest entry". A Jest test checks the TS kind set against the manifest and a minimum vector count. This is a concrete mechanism that can fail. **Addressed.**
- **Escalation scope (R1-6):** D5 lists four candidates: transport, evaluator approach, sample cache location, and Save & run write path. It replaces "clear-cut" with a stated self-approval test, which is promoted to standing constraint C1 (in `workflow-state.md` CONSTRAINTS and at the head of tasks.md). Task 4.1 implements it. **Addressed.**
- **HEL-1581 scope (R1-7):** I fetched HEL-1581 from Linear. It has exactly 5 ACs. AC1 is "no network request", and the What section's Output summary includes "difference vs the last run".
  - D6 and task 3.6 walk all 5 ACs and resolve the conflict between those two.
  - Task 6.1 makes the orchestrator post the comment after the final gate and record its URL, and forbids editing the description.
  - **Addressed.**
- **Round-1 non-blocking notes:** the AI-steps-in-draft-preview concern is now a Risk, and task 3.6 requires the doc to address it. Metric tiles are included.
- **Ticket AC coverage:**
  - AC1 (Q1–Q6, each with a recommendation and rejected alternatives) is covered by tasks 3.1–3.5.
  - AC2 (1,000-row, 3-step, real browser, number recorded) is covered by tasks 1.1–1.3.
  - AC3 (kind table and parity plan) is covered by tasks 3.1–3.2.
  - AC4 (HEL-1581) is covered by tasks 3.6 and 6.1.
  - The driver constraints are each covered: throwaway prototype (1.4), real browser named (1.3), tree-derived kinds (3.1), failable parity mechanism (D3), transport grounded in measurements (D4/2.x), escalation (D5/4.1), comment-not-edit (6.1), and no DESIGN.md or theme files (Non-Goals).
- **Other cited paths exist:**
  - `PatchSetUndoService.scala`, `AiPipelineQuotaGate.scala`, `docs/compute-expression-grammar.md`
  - `openspec/changes/archive/2026-10-09-panel-remount-row-refetch/{design.md,probe-premise.md}`

### Verdict: CONFIRM

All 7 round-1 revisions are substantively addressed, not just reworded, and I found no blocking gap against the ticket's ACs or the driver constraints. Notes 1–2 below are factual corrections. The executor should apply them, and the evaluator or final skeptic should check them.

### Non-blocking notes

1. **"Window rolling" is not existing TS evaluator code.** D3 and task 3.2 list "window rolling" next to `aggregate.ts` and `parseChartInstant` as existing TS a client evaluator might reuse. No TS window evaluator exists:
   - `window-rolling-seam.json` is a config-shape seam. `WindowConfig.seam.test.tsx` drives the editor and asserts the PATCH body.
   - Only the Scala side (`WindowRollingSeamSpec`) evaluates `expected`.

   The fixture's `input`/`expected` pairs can seed corpus vectors, but a client window evaluator would duplicate Scala logic. The doc must say so and must not claim reuse.
2. **`NODE_PATH` does not work for an `.mjs` driver.** Node's ESM resolver ignores `NODE_PATH`, so `NODE_PATH=… node measure.mjs` would still resolve `playwright-core` by walking up out of the nested worktree into the main checkout's `node_modules`. That is the same accident R1-4 flagged; it would just be hidden behind an env var that does nothing. Use one of these:
   - `createRequire("/abs/path/")("playwright-core")`;
   - an absolute `import` of `…/node_modules/playwright-core/index.mjs`;
   - a `.cjs` driver with `NODE_PATH`.

   Then record `import.meta.resolve`/`require.resolve` output in `measurements.md` as the resolved path.
3. **D6 has a stray fragment.** The sentence "Examples: the TS evaluator plus corpus; a draft-preview endpoint…; a server sample store; draft mode with Save & run through patch-sets." follows the history-baseline example with no lead-in. It presumably lists possible follow-up splits of HEL-1581. It is harmless, but the doc's scope section should state its intent clearly.
4. **HEL-505 limits are only implicit in the plan.** Ticket Q2 asks for "limits on the HEL-505 guards", and HEL-1581 AC2/AC5 both cite them. Task 3.3 (sample policy) does not name HEL-505 explicitly. The doc's Q2 section should state which HEL-505 limiter, if any, a sample refresh or server draft preview falls under. Today the preview routes get only the general `/api` limiter.
