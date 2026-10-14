## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `2bb5aeae41cc113159d54c0812eb467be42eeb71`. Live base: `resolve-review-base.sh` gave `5074b69377ea8ce1010739dddcf858448a3a0af5`. The diff is 26 files, all under `docs/` or `openspec/changes/live-draft-preview-spike/`. No `frontend/**` or `backend/**` file changed, so there is no UI to judge and step 4 does not apply.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/live-draft-preview-spike/HEL-1580`.
- **AC2 re-run (my own playwright-core Chromium, not the MCP browser, `nice -n 19`).**
  - Command: `PLAYWRIGHT_CORE=/home/matt/Development/helio/node_modules/playwright-core nice -n 19 node prototype/measure.cjs`, exit 0.
  - Environment: `chromium_headless_shell` 140.0.7339.186, playwright-core 1.55.1, Node v22.23.2. `verify.bad=0` and 179 distinct row counts in both throttle modes.
  - Unthrottled: recompute median 0.10 / p95 0.30 ms (mean 0.13). Recompute + render + forced layout 1.5 / 2.5 / max 5.9 ms.
  - 4x CPU throttle: recompute 0.5 / 1.1 ms. Recompute + render 4.7 / 8.0 / max 12 ms.
  - Scaling at 4x: 50k rows 39.3 / 79.4 ms.
  - My run is about 1.2-1.5x the recorded figures (1.0 / 3.8 ms render medians). The machine is shared with other lanes, so that is within machine noise. The conclusion (<50 ms by about 10x, even throttled) **reproduces**. The prototype's `index.html` really runs filter → sort → compute with a per-step cache and an untimed correctness pass. Output saved to the scratchpad as `skeptic-measure.json`.
- **27-kind table.** It matches `PipelineStep.Registry` at `PipelineStep.scala:256-284`: I counted 27 entries. 9 + 12 + 2 + 4 = 27.
- **Parity traps are real.**
  - Cast: `CastStep.scala:80` is `Try(str.toInt).orElse(Try(str.toDouble.toInt))`. That gives null for `"0x10"`, 1 for `"1.9"`, and `Int.MaxValue` for `"Infinity"`.
  - Sort: `SortStep.compareNonNullAsc` puts finite numerics (numeric strings included) first, then lexicographic order, with nulls last, using a stable `sortWith`. The stated oracle order follows from this.
  - The three agreement checks each have a concrete mutation that turns them red. **The parity plan can fail.**
- **Owner rulings.** Lines 1 and 18 of `events.jsonl` match §14 verbatim. The option text of ruling D (line 16) includes "auto-capture on first open when nothing cached", so §4 applies D faithfully. Ruling F (`never-before-save`) is applied in §3.1, §6 and §12, and no "Preview with AI" button remains.
- **§12 vs HEL-1581.** All five ACs are quoted verbatim against the scratchpad copy of HEL-1581.
- **Transport (ruling A).** I re-read `transport-lab.cjs` and `results-transport-lab.json`; the doc's numbers match the JSON. The lab is honestly labelled as loopback, a Node server (not Pekko), a self-signed TLS chain, and a simulated 7 ms evaluation. The doc labels the 40 ms RTT and HTTP/2 at the Google front end as assumptions.
  - **Judgment: NDJSON/h2 is a genuine pick, not a tie that needed re-escalating.**
    - Against plain request/response, NDJSON is a strict superset at equal cost: it reduces to request/response with one line, and is earlier on time-to-first-step when there are several server steps.
    - It dominates SSE.
    - Against WebSocket, the warm gain is about 1.2 ms on loopback. WebSocket loses that again on every cold (re)connect (+1 RTT), and it costs:
      - a held concurrency slot per editor;
      - a bypassed per-request limiter (620 messages, 0 counted);
      - no abort primitive;
      - and, per the escalation's own context, a CSRF-header gap at the handshake.
  - The doc does not over-claim loopback for production. Every prod figure is marked as an assumption, and the dev-machine DB-path state dependence is labelled "dev machine". The decision is self-approved under the delegation in ruling A, so C1 is satisfied.
- **Code citations I re-read.**
  - `ApiRoutes.scala:799` (general `/api` wrap) and `:301-317` (nested source-fetch limiter; "BOTH checks run on every matched request").
  - `PatchSetTargetFingerprint.scala:17-46`, including the upsert-rewrite exception, which the doc cites correctly.
  - `PatchSetPipelineDefinition.scala:12-40`: the prior definition includes `panelIds` and `alertRules` through the Output cascade.
  - `PatchSetUndoConflictCheck.scala:26-55`: a `pipelineStep` delete undo "recreates", and panels are recreated under a NEW id (`PatchSetUndoInverse.scala:79`).
  - `PipelineStepRepository.scala`: `updateInternal` (:487), `reorderTrunkInternal` (:866) and `rewriteUpsertTargetAction` (:124/135, which locks only its own step row) take **no lock on the pipeline row**. Grep shows no `pipelines` `FOR UPDATE` anywhere.
  - `PipelineRunService.submit` (:187-209) and `CsvLimits.scala:18` match the doc.
- **Gates.** The change is docs-only. The evaluator pasted `format:check` "All matched files use Prettier code style!" and `check:openspec` "openspec/ is clean" (evaluation-2.md:39-40). The only `live-draft-preview-spike` hits under `frontend/` are inside the gitignored `.jest-cache/` (absolute worktree paths), not imports.

### Verdict: REFUTE

The spike's evidence, the AC2 number, the kind table, the parity plan and the transport choice all hold up. Four statements in the design that HEL-1581 will build from do not. Three are guarantees the design claims and does not deliver. They are small text fixes, but §12 is about to be posted to HEL-1581 as the scope of record, so they need fixing now.

### Change Requests

1. **The draft-preview limiter does not do what §6.3 says** (`docs/live-draft-preview.md` §6.3 "Limits", §11 row "The draft-preview endpoint gets its own limiter", §12 item 2).
   - **What the doc says:** it rejects the general 120/min `/api` limiter as "too coarse ... shares the budget with every other request, which the HEL-1392 burst exhausted". It then specifies a dedicated `RateLimitDirective` "exactly like `sourceFetchRateLimitDirective`", with a default of about 120 per 60 s.
   - **The problem:** those precedents are mounted *inside* the general wrap (`ApiRoutes.scala:799`; comment at `:301-311`: "BOTH checks run on every matched request").
     - Built as written, every draft-preview request still counts against the general 120/min.
     - A dedicated limiter of 120 can never bind before it.
     - A continuous drag at the doc's own ~100/min floor leaves about 20 requests/min for everything else on the page. That reproduces the HEL-1392 exhaustion the section cites as its reason.
   - **Fix:** state where the endpoint is mounted relative to the general wrap, and make the numbers coherent. For example, exempt the draft-preview path from the general bucket and rely on its own limiter, or keep it nested and set the floor and limit so that general headroom stays meaningful. Correct §12 item 2's "within the draft-preview limiter" wording to match.

2. **The §8.3 stale-base check is not race-free as written.** The doc says the server recomputes the fingerprint "inside the transaction after taking a row lock on the pipeline row (new), so check and write cannot interleave".
   - **The problem:** a lock only serializes against writers that take the same lock. The doc itself notes that none does today, and I confirmed that no step writer locks the pipeline row:
     - `updateInternal`;
     - `reorderTrunkInternal`;
     - `spliceInsertAtInternal`;
     - `deleteInternal`;
     - patch-set apply;
     - `rewriteUpsertTargetAction`, which locks only the step row;
     - Output PATCH.
   - **Consequence:** under READ COMMITTED, a concurrent per-step PATCH, an MCP/patch-set edit or an upsert rewrite can commit between the check and the write. Two outcomes follow:
     - It is silently overwritten (a lost update), or merged into a state that never matched any fingerprint.
     - The journal's "prior definition" (§8.5) is then wrong, so undo would revert the other writer's edit too.
   - **Fix:** §8.3 must require every pipeline-definition writer to take the same pipeline-row lock (or a pipeline advisory lock), or run the save at SERIALIZABLE with retry. §12 split item (c) must carry that requirement.

3. **§8.5 undo is not coherent for a save that deleted steps.** It says undo is "the bulk endpoint again, with the prior definition as the draft ... atomic, reorder-correct".
   - **Problem 1, ids:** the bulk body (§8.1) knows only *existing* ids and new `clientId`s. A step or Output deleted by the save is neither, so the doc does not say whether a restore recreates it under its original id or a new one.
   - **Problem 2, cascade:** the cascade of that delete (Outputs, their bound panels, possibly on other users' dashboards, and targeting alert rules; `PatchSetPipelineDefinition.scala:12-15`, HEL-1522) is recorded in the prior definition (`panelIds`, `alertRules`). Nothing in `steps[]`/`outputs[]` can recreate it.
   - **Fix:** state what undo does in this case. Either:
     - it restores the cascade (and how, including ids); or
     - it refuses with 409 as structurally unrecoverable, as `PatchSetUndoConflictCheck` already does for other kinds; or
     - it restores definitions only and explicitly lists what is lost.
   - Add that case to the "Not covered by undo" sentence and to §12 item 3 ("atomic undo").

4. **§4's sample label contradicts itself for a static CSV over 1,000 rows, and this one matters.**
   - **The contradiction:** the example label "sample · first 1,000 of 12,431 rows ... (a CSV prefix up to 50,000 rows)" applies to a CSV, but the next sentence gives every static source, "an uploaded CSV with no live URL" included, the plain "Static · N rows".
   - **Why it matters:** an uploaded CSV of 12,431 rows is static and sampled. Its step counts and aggregates in the preview are computed over 1,000 rows, while a run sees 12,431. That is the one case where the live preview's numbers are materially wrong against the run, and the doc as written would hide it.
   - **Fix:** say explicitly that any source, static or not, whose row count exceeds `SAMPLE_MAX` shows the "first 1,000 of N" prefix label with the count/aggregate caveat, and that "Static · N rows" applies only when the static sample is exact. Mirror this in §12 item 5, which currently extends only non-static sources and so leaves this case outside HEL-1581's ACs.

### Non-blocking notes

- **Evaluator note 1 (rounding 24-44 / 26-46 ms to "about 25-45"):** immaterial. It is a dev-machine, state-dependent figure that the doc already labels as such, and no decision depends on its exact edges.
- **Evaluator note 2 (CSV over 1,000 rows label):** this does matter. It is change request 4.
- §8.3's 409 offers the UI an "overwrite" choice. A force-save over another writer's changes is a product call the owner has not ruled on. Either mark it as a HEL-1581 decision or drop it.
- §6.2/§6.3 dropped the CSRF-header point about WebSocket handshakes that the escalation itself raised. Restoring it would strengthen the WebSocket rejection.
- §8.7 leaves "owner context vs privileged pool" as a build-time decision. That is honest; HEL-1581 (c) should own an RLS spec under a non-BYPASSRLS role (MISTAKES/RLS parity hazard).
- Gate-defect check: no report I drilled into relies on mtime ordering, so there is nothing to record.
