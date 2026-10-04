## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD: `2f5ce83e97c3aa5a29c8be80d4ec613077b56432`. Base `260943222894a97e2d65447ff9b00a7e7f57df89` was resolved live. Cycle 3 is one commit on top of `c4313250` (PASSed in evaluation-2.md). It responds to skeptic-final-1.md's REFUTE.

It touches:
- the 409 protocol, routes, service and teardown reason text
- the response schema
- `sourcesSlice`
- `SourceDeleteConflictNotice`
- tests

It does not touch `specs/`, `design.md` or `tasks.md`; their last change is `c4c64ab5`.

This is the final cycle (`CYCLE: 3` equals `EXECUTION_CYCLES: 3`).

### Phase 1: Spec Review — FAIL
Issues:
1. **The UI requirement in the spec delta now contradicts the implementation.** `specs/datasource-edit-delete/spec.md` lines 62-80, Requirement "The data-source delete UI surfaces the conflict":
   - It says the frontend "SHALL show the conflict reason".
   - Its scenario "Only hidden references" says "THEN the UI shows the server's non-leaky reason text".
   - Cycle 3 deliberately stopped rendering the server `reason`. `SourceDeleteConflictNotice.tsx` now composes its own copy from the structured counts, and falls back to `conflict.message` only when the body has no structured fields (an older server).

   The new behaviour is the right one (the skeptic asked for it), but the binding spec still describes the old behaviour. On archive, a stale requirement would be synced into `openspec/specs/datasource-edit-delete`.
2. **The 409 body requirement and design omit the new additive fields.**
   - The same spec, lines 9-21, lists the body fields and does not mention `hiddenPipelineCount` / `hiddenPanelCount`.
   - `design.md` D3 still gives the body as `pipelines` plus `panels` only.
   - `design.md` D6, lines 108-110, still says the notice "always shows the server `reason` too".
   - `schemas/sources/data-source-delete-conflict-response.schema.json` was updated, so the contract and the spec now disagree.

Everything else from cycles 1-2 still holds:
- AC1 to AC5 are met.
- C1 still holds: the visibility predicates are unchanged.
- C2 still holds. The new fields are `Int` counts sourced from `SourceReferences.hidden*Count`, so no identity is carried. Live, the hidden pipeline/dashboard/panel ids and names appear nowhere in the 409, in the teardown body, or in `.concertino-backend.log`.

### Phase 2: Code Review — PASS
Gates (fresh runs in WORKTREE_PATH):
- `nice -n 19 sbt testFull`: 5590 succeeded, 0 failed, EXIT=0. `sbt --client shutdown` was run afterwards.
- `npm run lint` exited 0.
- `npm run format:check`, `npm run typecheck` and `npm run check:scala-quality` all passed.
- `npm test` passed: helio-mcp 350, frontend 4286.
- `npm --prefix frontend run build` passed.

Review of the cycle-3 diff:
- **Protocol.** `jsonFormat9` with defaulted `Int` fields. spray always writes `Int`, so the fields are always present. The schema adds them as `integer`, `minimum: 0` and not required, which keeps older bodies valid. `assertConflictMatchesSchemas` now pins the 9-key set.
- **Frontend parsing.** `count()` in `sourcesSlice.ts` accepts only non-negative integers, otherwise `undefined`, and a test covers a malformed `"x"`. The notice falls back to the server text only when no structured data is present. Jest pins:
  - no UUID text
  - each visible reference rendered exactly once
  - pluralised hidden counts
  - the hidden-only sentence
  - the older-server fallback
- **Server reason.** `referenceConflict` now tailors the remediation to the kinds present, hidden counts included. The non-superuser spec 6.2a asserts this per kind (form vs pipeline) and checks the sentence form. The teardown reasons are capitalised sentences, asserted in 6.3a.
- No code-quality, type-safety or dead-code findings. No new inline fully-qualified names.

### Phase 3: UI Review — PASS
I started fresh servers with `start-servers.sh`; none were running beforehand, so the code is current. `assert-phase.sh servers` passed. The listener processes' cwds are `.../HEL-1252/backend` (port 9591) and `.../HEL-1252/frontend` (port 6684).

Live fixtures in the dev DB, which connects as a BYPASSRLS superuser:
- a visible join pipeline
- a visible form panel on a dashboard owned by the dev user
- a HIDDEN foreign lookup pipeline
- a HIDDEN foreign form panel on a foreign dashboard

Results:
- **API 409:** `hiddenPipelineCount: 1`, `hiddenPanelCount: 1`, and the visible entries are named. A grep found 0 hits for the hidden ids/names.
- **Teardown dry run:** blocked with the sentence-form reason. Hidden resources are counted, not named.
- **Notice in the running app:** `"EVAL1252c3 Target" was not deleted: it is still referenced by the items below, and a pipeline you cannot access, and a form panel you cannot access. Remove each reference first.` It is followed by the two links (`/pipelines/...`, `/dashboards/...`).
  - The DOM contains no UUID-pattern text.
  - No overflow (scrollWidth equals clientWidth, 215).
  - It is legible in dark and light themes (light set via `data-theme`):
    - `/home/matt/Development/helio/.concertino/runs/HEL-1252/evidence/.playwright-mcp/hel1252-eval3-notice-dark.png`
    - `/home/matt/Development/helio/.concertino/runs/HEL-1252/evidence/.playwright-mcp/hel1252-eval3-notice-light.png`
- **Console:** only the browser's network log of the expected 409.
- **Dev-DB residue:** every fixture was deleted by exact id. That is panels `e1252000-...0008` and `...0010`, dashboards `...0007` and `...0009`, pipelines `...0001` and `...0004` (their roots and steps cascade), then sources `4e57a225-4a2f-458d-a9c7-7353bf0ffa1d` and `fca3e99a-2e29-4961-bfc7-a6eaad776e18` through the API (204 each). A verification count returned 0 for all of them.

### Overall: FAIL

### Change Requests
These are artifact-only edits; no code change is needed.
1. In `openspec/changes/guard-source-delete-config-refs/specs/datasource-edit-delete/spec.md`, Requirement "The data-source delete UI surfaces the conflict":
   - Replace "SHALL show the conflict reason" with wording that matches the implementation. The notice composes its own copy from `pipelines`, `panels`, `hiddenPipelineCount` and `hiddenPanelCount`, renders no raw ids, and falls back to the server `message` only when the body carries no structured fields.
   - Rewrite scenario "Only hidden references" so its THEN is "the UI states the hidden counts (e.g. 'a pipeline you cannot access') and renders no link and no id".
   - Optionally add a scenario for the mixed visible + hidden case.
2. Same file, Requirement "Backend DELETE /api/data-sources/:id returns a structured 409 ...": add the additive integer fields `hiddenPipelineCount` and `hiddenPanelCount`. State that they are counts of distinct referencing resources the caller cannot see and never carry an identity. Optionally add them to the hidden-reference scenarios' THEN clauses.
3. Update `design.md` to match:
   - D3: add the two counts to the body shape.
   - D6, lines 108-110: drop "always shows the server `reason` too"; describe the composed copy and the older-server fallback.
   - Add a planner/cycle-3 note citing skeptic-final-1.md as the reason for the change.
4. Run `openspec validate guard-source-delete-config-refs --strict`, or whatever the repo's hygiene check runs, after the edits.

### Non-blocking Suggestions
- **Notice wording.** With both hidden kinds present it reads "the items below, and a pipeline you cannot access, and a form panel you cannot access". `parts.join(", and ")` repeats "and". Joining as "A, B, and C" would read better. This is a judgment call for the skeptic.
- **Teardown remediation.** "Tag those into the batch or remove the references first" is inaccurate for a foreign or hidden referencing resource. Tagging another user's pipeline never exempts it, because the exemption requires a caller-owned resource. Consider "remove the references (or tag your own referencing items into the batch) first".
- **Carried over:** the Sources "Used by" column still counts roots only. This is a follow-up candidate.

### Critical Path
- **What blocks a PASS:** only the planning artifacts, change requests 1 to 3. The implementation, gates, RLS proof and live UI all hold at `2f5ce83e`, and every C1/C2 check passed again this cycle.
- **What remains:** about a 15-minute edit to `spec.md` and `design.md`, then a re-run of the OpenSpec hygiene check. No code or test change is needed, so the gate results above stay valid as long as only those two files change.
- **Recommendation for the human:** let the orchestrator fold the artifact edits in and re-verify with a diff confined to `openspec/changes/guard-source-delete-config-refs/{specs,design.md}`, rather than reopening implementation. If the owner judges spec/design sync to be archive-time work, this FAIL reduces to a documentation gap with no behavioural risk. Either way, do not archive the change with the current spec text: it would publish a requirement ("SHALL show the conflict reason") that the shipped UI deliberately violates.
