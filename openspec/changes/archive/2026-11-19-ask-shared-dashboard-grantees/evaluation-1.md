## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `d3bc2f9daf3b57c7ed719492007e4224964a1d29` against live base `b2603ab7998f3e9b4bdca5089a18f89da16fdc8b` (commits debf58c72, d3bc2f9da).

### Fresh gate evidence (evaluator's own runs)

- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0.
- `npm test` (jest 3 workers): root 617/617, frontend 10176/10176 (859 suites), exit 0.
- `npm --prefix frontend run build`: exit 0.
- `sbt -J-Xmx3g testFull` on lane DB `helio_hel1781` with `ANTHROPIC_API_KEY` exported empty: 10018 succeeded, 0 failed, 5 canceled, "All tests passed", exit 0. The output includes the new `AskSeamSpec` editor case and all 4 `AskGranteeRlsSpec` cases.
- Playwright (2 workers, lane DB, servers from `start-servers.sh`, `assert-phase.sh servers` PASS): full `e2e/hel1781-ask-shared-dashboard.spec.ts` and full `e2e/hel1773-viewer-grantee-dashboard.spec.ts`, 13/13 passed. This closes executor gap (3): hel1773 has now been re-run in full on the final code.
- Lane DB recreated for these runs, then dropped (`pg_database` count 0). Servers stopped with `stop-servers.sh`.

### Phase 1: Spec Review — FAIL

The ACs are met in behaviour:

- A beta viewer can open and send an ask: e2e on desktop and phone, unit tests.
- Chips never request `/api/outputs`: the e2e network watch shows `outputRoutes == []` and provenance only through `/api/dashboards/:id/panels/:pid/provenance`.
- A viewer sees no pin: seam case under the NOSUPERUSER harness role.
- An editor without a pipeline grant sees no pin: new seam case, proven red by mutation M2 (`mutation-M2.txt`).
- `get_history_rows` is neither offered nor served to a grantee.
- A free-tier grantee gets the upsell and sends no request.

Constraint C12/C16 and the task ticks are not honoured:

- **Tasks 1.5 and 4.2 are ticked, but the e2e half was never done.** `e2e/hel1781-ask-shared-dashboard.spec.ts` was never run red. Neither e2e mutation was run: "chip reverts to authenticated -> e2e red" and "Ask re-gated on isOwner -> red". `red.txt` contains only the jest red. The scratch files `card.ok`/`cb.ok` are source backups, not mutation transcripts.
  - The unit side is acceptable. The red-first jest run at base (8 failures in `red.txt`) is the same as both frontend mutations: base has `authenticated` chips and `isOwner` gating.
  - The e2e has no recorded red. By reading, the viewer tests would go red under both mutations (`outputRoutes` would be non-empty, and the button would be missing). Under C16, a reasoned red is not a recorded red.
- **`AskGranteeRlsSpec` overclaims.** Its doc comment (`AskGranteeRlsSpec.scala:22`) says "a GUARD proven by mutation". No mutation reached it: under M1 and M2 all 4 of its cases stayed green (`mutation-M1.txt`, `mutation-M2.txt`). C16: a mutation left green is never proof.
  - Its `res.toOption.get.pin shouldBe None` (line 81) is vacuous. The scripted answer cites nothing, so the pin builder has nothing to pin, whatever the caller's access (executor gap 4).
- **Task 4.3 is ticked ("Save and persist the RLS transcript"), but the transcript was not persisted.** `.concertino/runs/HEL-1781/evidence/` holds only `premise-validation.md` and the openspec copies. `rls-ask.txt` exists only in scratch.
- Task 3.4, second half (a public or share-token viewer renders no Ask), executor gap 2: verified here.
  - Statically: `PublicDashboardViewerPage.tsx` mounts outside `AppShell` (`AppRoutes.tsx:104`) and imports nothing from Ask, `DashboardMetaRow` or `CommandBar`.
  - Live: an unauthenticated load of `/dashboards/<id>/panels` for an eval-created dashboard with a public viewer grant rendered the "This link isn't available" state with zero buttons. That state is not a populated public view, so the live check is partial. The static check is decisive. Not a change request.
- No scope creep. No migration. HEL-1784 files untouched. No API contract or schema change, as the design intends.

### Phase 2: Code Review — FAIL

- **Unmemoized selector in `frontend/src/features/ask/ui/AskAnswerCard.tsx:52-59`.** `useAppSelector((s) => { ... return new Map(...) })` returns a new `Map` on every call whenever `perPanel` is true and panels are settled.
  - Reproduced: running `AskAnswerCard.grantee.test.tsx` with `--silent=false` prints react-redux's dev warning "Selector unknown returned a different result when called with the same parameters. This can lead to unnecessary rerenders." four times, once per grantee render.
  - Effect: for every grantee, the answer card re-renders, and re-renders its chips, on every Redux dispatch anywhere in the app, and the dev console shows the warning.
  - This breaks the repo's "optimize for performance by default" rule and is a real regression on this new path.
- Everything else is clean:
  - DRY: `isOutputPanel` and `panelsSettledFor` reused, no duplication.
  - Narrow change to the D1 gating.
  - Share still owner-only, and the narrow-kebab test covers that.
  - No dead code: the `selectIsDashboardOwner` import was correctly removed from `CommandBar.tsx`.
  - No `any`.
  - Tests exercise the new paths. `DashboardMetaRow.roles.test.tsx` restores the `useMetaRowTier` mock in `finally`.
- Design [mechanical]: no new CSS or tokens. The unmatched-citation fallback is a bare `<span>` with no styling, so there is nothing mechanical to flag. The visual call is the skeptic's.
- Security: no new client-side trust. The server still decides the pin, and grantee chips use the optional-auth per-panel route.

### Phase 3: UI Review — PASS

- Happy path: the e2e viewer passed on desktop (1280) and phone (390). Ask opens from the meta-row button and from the kebab menu item, the answer renders, there is no pin, and the provenance popover loads through the per-panel route.
- No `/api` 4xx/5xx during the flow (e2e `badResponses == []`).
- Editor with no pipeline grant: no pin. Free grantee: upsell shown, zero `/ask` requests.
- Owner regression: still `/api/outputs/:id/provenance`, and the pin is offered.
- Entry points: desktop meta row, narrow kebab (unit test), phone command-bar kebab (e2e).
- The hel1773 grantee suite is green on the final code.
- I captured no screenshot evidence of my own. Everything above rests on the passing e2e assertions, which are self-authenticating network and DOM checks.

### Overall: FAIL

### Change Requests

1. **`frontend/src/features/ask/ui/AskAnswerCard.tsx:52-59`: make the panel lookup referentially stable.**
   - Select stable inputs: `s.panels.items` (stable until panels change), plus a boolean `panelsSettledFor(s.panels, scope.id)`.
   - Build the `outputId -> panelId` `Map` in a `useMemo` keyed on those inputs. A `createSelector` memoized per `scope.id` also works.
   - Add a unit assertion that no `console.warn` matching "returned a different result" fires while the grantee card renders. Prove it red against the current code first.
2. **Record the e2e red (C12/C16) for `e2e/hel1781-ask-shared-dashboard.spec.ts`.** Run the full file under each mutation below, save each transcript to `.concertino/scratch/HEL-1781/`, then restore the code. Use the lane DB, `start-servers.sh`, 2 workers.
   - (a) In `AskAnswerCard.tsx`, the `perPanel` branch passes `source={{ variant: "authenticated" }}`. Expect the viewer desktop and phone cases red on `outputRoutes`/provenance.
   - (b) Re-gate Ask on `isOwner`: `DashboardMetaRow.tsx:123` and `:236`, and `CommandBar.tsx:94`. Expect the viewer, editor and free cases red.
   - Then make tasks 1.5 and 4.2 match exactly what was run. If a case stays green under a mutation, record it as green; never as proof.
3. **`backend/src/test/scala/com/helio/services/ask/AskGranteeRlsSpec.scala`: back the "proven by mutation" claim, or remove it.**
   - Run at least one mutation that reaches this spec's tested path, and record which case goes red. Examples: offer `get_history_rows` without the pipeline-grant check, or skip the scope re-check for `get_history_rows` so a grantee is served the payload.
   - Fix the vacuous no-pin assertion at line 81. Either have the scripted final answer cite the data it read, so `AskPinBuilder` actually runs for the viewer, or delete the assertion and say in the doc comment that pin proof lives in `AskSeamSpec`.
4. **Persist the RLS transcript (task 4.3).** Run `scripts/concertino/persist-evidence.sh HEL-1781 <path-to-rls-ask.txt>` and cite the returned `ref=` in `files-modified.md`. Do the same for the new mutation transcripts from CR 2 and CR 3.

### Non-blocking Suggestions

- `e2e/hel1781-ask-shared-dashboard.spec.ts:63`: the `watchNetwork` doc says it collects "every console error", but it attaches no `console` listener. Add one and assert it is empty, or correct the comment.
- `AskGranteeRlsSpec.scala:91`: `h.compactPrint.contains("recent") shouldBe true` is a loose check. Asserting the two seeded values (100.0 / 110.0) would be stronger.
