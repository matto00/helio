## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: 12cb8f22403d29216726b27fbcb87a5b85588cf4. Diff base: e4289e6c88e4d8d0c174b94f1359817fe0466514, resolved live and equal to origin/main.

Cycle-2 delta since a477e9be5:
- `selectPanelFit.ts`: one-line clamp.
- `selectPanelFit.test.ts`: one new case.
- New `root-cause.md` and a `files-modified.md` line.
- `evaluation-1.md`, now committed.

### Phase 1: Spec Review — PASS

I checked each cycle-1 change request against the evidence itself, not against what `root-cause.md` says about it.

- **CR1 (AC1, task 1.2, C2): resolved, with one disclosed deviation.**
  - The unmodified main spec **passes** locally, light and dark (`hel1350-unmodified-main-spec.log`, 2 passed). CI's hang depends on where the trigger lands, and does not occur locally without forcing it.
  - The executor states this plainly rather than hiding it. It supports the forced bottom placement with CI's own trace: the Compare-trigger click logs `element is not stable` then `retrying click action`, and the "7 days" click then logs `outside of the viewport` 273 times. I verified this myself in cycle 1.
  - The new spec is red against main's Select: both legs fail with the listbox bottom at 981px against a 900px limit (`hel1350-red-main-2.log`). That 981px is itself proof no fit was applied, since the fixed code would have flipped the listbox. The red traces now exist.
  - Bisection (HEL-1331 / HEL-1285 / HEL-1366) was **explicitly not done**. The stated reason holds: the defect is "`position: fixed` listbox with no viewport awareness", and the fix and proof work for any trigger position. HEL-1366 is excluded on trace evidence (every setup call succeeded; the failure is a pure layout retry loop).
  - **Judgement: acceptable.** The design's risk line says "if local does not reproduce, escalate". That does not trigger here: the failure *mechanism* was reproduced deterministically and the red goes green with the fix. The remaining uncertainty is whether CI's trigger really sat at the bottom, and AC5 (all 4 CI legs green on the PR) covers it.
  - Naming nit: the folder `red-unmodified-main/` holds the trace of a run that **passed**; its `.last-run.json` says `"status": "passed"`. `root-cause.md` describes it correctly.
- **CR2 (AC2, task 2.1): verified.**
  - `hel1351-old-America_Los_Angeles.log` runs the OLD assertion, which **passes**. `HOVERED_FULL` ends with `Updated 10/7/2026` and `MATCH=["7","7"]`.
  - `hel1351-old-UTC.log` runs the same assertion, which **fails**. The text ends with `Updated 10/8/2026`, and the failure shows `Expected pattern: /\b(15|7)\b/` against the full string.
  - The date dependence (server `lastUpdated` formatted in the browser zone, so CI in UTC flipped at 00:00Z) is now proven, not inferred.
  - The claim "Los_Angeles is green with match [\"7\",\"7\"], UTC is red" is **confirmed**.
- **CR3 (C1 record): resolved.** `root-cause.md` records that the value-7 mutation stayed red while the card contained `Updated 10/7/2026`. It honestly notes that the `^east` anchor is a second defence.
- **CR4 (Decision 2 grep): resolved.** The grep and its result (zero hits) are recorded.
- **CR5 (residue): the claim is partly confirmed.**
  - All **20** user ids that appear in any run log (executor scratch logs, `e2e-evidence/HEL-1373/logs/`, my cycle-1 logs) are gone. Read-only check: `select count(*) from users where id in (<20 ids>)` returns 0, and so does the same count on `pipeline_run_rate_window`. You said 22; `root-cause.md` and my log-derived set both say 20.
  - **28 users matching `hel135%@example.test` remain**, created between 19:28:29 and 19:36:09 -07:00. This run started at 19:21:55 and this worktree's backend at 19:28:18. They are mostly single `hel1350-light` registrations a few seconds apart, the shape of iterative debugging.
  - They appear in no log, and the backend log carries no user ids, so I **cannot attribute them** to this run rather than another lane (HEL-1370 and HEL-1372 are active).
  - Not blocking, and they must not be deleted by email pattern. The executor should confirm whether those were its unlogged repro runs and, if so, delete them by the exact ids below.
- **CR6 (AC4, task 3.1): verified.**
  - HEL-1215 (Linear, Backlog) is exactly this observation: `PanelCard.test.tsx` "PanelCardBody does not re-render when only unrelated PanelCard state changes", `Expected: 2 Received: 3`, CI-only and timing-sensitive.
  - PanelCard does not import `Select` or `chartAppearance` (grep). The cited test comment (lines 58-77) describes the timing hazard.
  - My two full Jest runs (cycles 1 and 2, 463 suites each) passed this test.
  - The classification as HEL-1215's flake, unrelated to this change, holds.
- C1 and C2 are honoured. There is no scope creep. Tasks now match their records.

### Phase 2: Code Review — PASS

Gates, run fresh by me at `nice -n 19` with 3 workers (`scratchpad/eval2/gates.log`):
- lint: 0
- format:check: 0
- typecheck: 0
- Jest: 463/463 suites, 4892/4892 tests (+1, the new clamp case), plus 39/39 suites
- frontend build: 0

There is no backend change.

The clamp at `selectPanelFit.ts:28` (`Math.max(Math.min(height, above), 0)`) is correct and mirrors the below branch. The new test (`top: -100, bottom: -68`, viewport 100) reaches the flip branch: below = 100-(-64)-8 = 156, height = 180 > 156, above = -112 < 156, so it actually returns from the third branch. The new case therefore asserts the non-negative result through the **below** branch, not the flip branch it is named for. It is a weak guard of the new line, but the line itself is trivially correct. Non-blocking (see Suggestions).

The served module contains the clamp (`curl` of `/src/shared/ui/selectPanelFit.ts`). No other code changed.

### Phase 3: UI Review — PASS

- `assert-phase.sh servers` passes. The vite cwd is this worktree.
- Both specs, fresh, browser zone PDT: **4/4 passed** (`scratchpad/eval2/e2e-pdt.log`).
- Both specs, fresh, `TZ=UTC`: **4/4 passed** (`scratchpad/eval2/e2e-utc.log`).
- The cycle-1 live probe (Region select at 768x260 flips and fits; at 1440x900 it opens below at natural height; no console errors) still applies. The only code change since is the clamp, which affects only an off-screen trigger.

Persisted evidence (load-bearing for the claims above):
- `/home/matt/Development/helio/.concertino/runs/HEL-1373/evidence/e2e-evidence/HEL-1373/logs/hel1351-old-America_Los_Angeles.log`
- `/home/matt/Development/helio/.concertino/runs/HEL-1373/evidence/e2e-evidence/HEL-1373/logs/hel1351-old-UTC.log`
- `/home/matt/Development/helio/.concertino/runs/HEL-1373/evidence/e2e-evidence/HEL-1373/logs/hel1350-unmodified-main-spec.log`
- `/home/matt/Development/helio/.concertino/runs/HEL-1373/evidence/e2e-evidence/HEL-1373/logs/hel1350-red-main-2.log`
- `/home/matt/Development/helio/.concertino/runs/HEL-1373/evidence/e2e-evidence/HEL-1373/red-new-spec-main-select/hel1350-chart-compare-pick-2a925-ws-the-vs-7d-overlay-light-/trace.zip`
- `/home/matt/Development/helio/.concertino/runs/HEL-1373/evidence/e2e-evidence/HEL-1373/red-new-spec-main-select/hel1350-chart-compare-pick-0acd3-aws-the-vs-7d-overlay-dark-/trace.zip`
- Cycle 1: `compare-listbox-open-{light,dark}.png` and `zz-mut-dateleak .../error-context.md` under the same evidence root.

### Overall: PASS

### Non-blocking Suggestions
- `frontend/src/shared/ui/selectPanelFit.test.ts:40-43`: the "off-screen above" case exits through the below branch (computed above). To exercise the new clamp line, use inputs where `above > below` and `above < 0`. For example `fitSelectPanel({ top: 5, bottom: 37 }, 180, 30)` gives below = -19, above = -7, and pre-fix maxHeight -7. Assert `{ maxHeight: 0 }`.
- Rename `e2e-evidence/HEL-1373/red-unmodified-main/`. It holds a **passing** run (e.g. `unmodified-main-passes/`).
- Residue hygiene (orchestrator to route): there are 28 unattributed `hel135%@example.test` users created 19:28:29 to 19:36:09 -07:00 on 2026-10-07. If they are the executor's unlogged repro runs, delete by exact id:
  `bbca33b8-06be-4f9a-bcd9-2c9e40309c66 c0ec3763-fd78-45d5-91f5-711c76205a7e 91cd6305-9655-40d2-8d50-8e9425e1211b 7fdaa6b5-fa03-44f4-98ea-94437a8260cb f8ce4020-cdba-47a3-8577-ad5270619059 cf7e6c1e-211f-400c-9178-2caf88211fc1 22e8c82b-d3eb-4e6b-a0e7-4b25fbc4a6c7 1abc412d-cb47-4b93-906e-e7081491425a 1f56d323-3083-4168-8b17-b2c39c074926 a75a3cd2-b765-4ec1-a07d-9e959e2fe295 25a6b77c-2c40-456f-a4b5-bd6ab1ac2506 e7d2ea29-c869-47fa-bebe-52a8a329f273 e9330d99-ebab-4058-9e75-d9448ee7372f 7302aa8a-a134-4b0e-98fd-26df8b76f331 48358ea5-be06-4171-9d2e-fc5463b4c04d 5c1f5e48-e99f-47dd-a61b-8b50f409b6c5 0ef009e8-c6ba-4fdd-896b-e5bfd32b8cf8 fd39a299-3ce6-48c6-b214-386fc17b1239 043db85b-69fb-4399-a278-78da64096a08 383d4cfc-bf50-4dbd-8774-2a3ef0e9adca 99ec47ca-cebb-4330-8fcd-7df257f7d6e9 febfd1b3-9912-4b1d-8e68-7e74187a1631 203332a4-bf65-4118-a834-ff10bfd9fa63 05e9cf8c-a974-42a8-b6d3-46f55f2eed78 63f9f922-8a4a-4ee3-a697-89d5104befff d018efb1-26cc-4df4-a6dd-dd381a44abc0 07c4179a-f5f7-4071-873a-69eee1910398 4a9d301c-2b49-463a-9d5f-3963a15f9b4c`
- This cycle's evaluator runs created 8 more users: `32744dbd-2bf5-43da-bfc2-4330c2151c7a 7c52d374-9c9b-4313-8078-b76d0aa3d371 8b55b65a-23c8-4e81-bfb6-9b4771f74029 5fa16021-cd39-4dbd-a760-de37e3a8784f a4c95571-5f2c-4ef4-a8cb-0e70074ff8e6 63eae30b-2d94-406d-b795-f15b1ec92444 01d4f944-f68a-48e0-ab4b-b779c0cc56da 22a474e0-432d-4446-ac39-4b9daa26bf4a`. Delete by exact id along with their `pipeline_run_rate_window` rows.
- A follow-up ticket for the specs' missing user cleanup (it predates this change) is still worth filing, as `root-cause.md` notes.
