# Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed at commit `25ebfaa9`. All gates re-run fresh by the evaluator in the
worktree (root `node_modules` was absent — hardlink-copied from the main
checkout, identical `package.json`/`package-lock.json`, removed afterward).

## Gate results (evaluator's own runs, not the executor's report)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit -p frontend/tsconfig.json` | PASS (0 errors) |
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm test` (root + frontend) | PASS — 282 suites / 3009 tests |
| `cd backend && sbt test` | PASS — 235 suites / 3539 tests |
| `openspec validate output-picker-nav-onboarding --type change` | PASS |
| `npm run check:openspec` / `check:schemas` / `check:spec-structure` / `check:scala-quality` | PASS |

Servers: the backend running on 9248 had started at 22:23, **before** the
22:41 commit that carries the `PanelRepository` fix — a live stale server, the
exact hazard flagged. It was killed and restarted via
`scripts/concertino/start-servers.sh`; all UI evidence below is from the
current commit (`assert-phase.sh servers` → PASS).

## Phase 1: Spec Review — FAIL

Verified PASS:

- HEL-937 absorption is real: `features/dataTypes/**`, `features/metrics/**`,
  `PanelCreationModal`/`creationSteps/*`/`PanelCreationPreview`/`panelTemplates`,
  `BindingEditor`, `MetricPicker`, `DataTypePicker`, `CollectionEditor`,
  `TimelineEditor`, `MetricBindingFields`, `useMetricBindingState`,
  `fieldOptions.ts` are **deleted** (`find` returns nothing), not unreachable.
  The surviving `editors/*` (Chart/Table display + aggregation fields,
  `BoundOrLiteralField`) are imported only by
  `features/pipelines/ui/outputEditor/OutputKindFields.tsx` — Output-authoring,
  never the Panel sheet. Confirmed by import grep.
- `/registry` and `/metrics` render the shared **Page not found** view live —
  no stub, no redirect (decision 11 honoured).
- Nav is exactly 5 destinations (desktop sidebar and 375px bottom nav, 54px
  touch targets, no horizontal overflow).
- **AC grep**: 32 hits, and I characterized every one. They are confined to
  (a) the proposal/patch-set `dataTypeId` wire mirror
  (`dashboards/types/proposal.ts`, `ProposalReview*`, `CombinedProposalReview*`,
  `outputsService.ts`, their tests) — independently confirmed to mirror a real
  backend field (`DashboardProposalProtocol.scala:17` `dataTypeId: Option[String]`);
  (b) the negative-assertion nav tests (`sections.test.ts`,
  `navDestinations.test.ts`) where the literal strings are the proof;
  (c) historical doc comments (`panel.ts:10`, `panelPayloads.ts:6`,
  `tokenAuditSweep.css.test.ts:55`); (d) one false positive
  (`StatusChip.tsx:19`'s "pipelines/metrics/panels" comment). No hit falls
  outside the documented exception. **AC intent satisfied** — this is not a
  finding.
- Backend `PanelRepository` `output_id` omission is a real defect with a real
  fix, and `ApiRoutesSpec`'s new test is structurally red-capable: it PATCHes,
  then re-reads through `GET /api/dashboards/:id/panels`, so it cannot pass on
  an echoed response. Verified live end-to-end (see Phase 3).

**Blocking spec findings:**

1. **Decision-15 server-owned default sizes were never implemented — and they
   are this ticket's own scope.** `design.md`'s Context asserts "Backend
   Output/panel-placement routes already exist (P1.3/P1.5): `POST /api/panels`
   … server-owned decision-15 default size". That assertion is false. Verified
   live: after placing an Output, `GET /api/dashboards/:id/panels` returns a
   panel with **no `layout`**, and the dashboard's own layout is
   `{"lg":[],"md":[],"sm":[],"xs":[]}` — the grid falls back to a generic
   client size (measured 487×332 for a `metric` Output, which should be 3×2).
   The backend has no such logic: the only per-kind sizing is
   `services/panels/PanelPacker.scala:31-43`, an auto-layout helper whose own
   comment says the bounds are "a placeholder pending the real per-Output-kind
   sizing decision (design.md references a future 'decision-15 default size'
   for `POST /api/panels` **that this ticket doesn't itself define**)". The
   epic source of truth assigns it here explicitly: row P1.6 = "Output picker
   (**server-owned grid defaults, decision 15**)" (
   `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:224`,
   detail at :44 and :140). Ticket AC 1 ("panel is on the grid with the
   chart's default size") is therefore unmet, and the shipped spec delta
   `specs/output-picker/spec.md`'s scenario "the panel is rendered on the grid
   using the layout returned in the response" describes behavior that does not
   exist.
2. **A shipped ADDED spec requirement overstates what was built.**
   `specs/output-picker/spec.md` states each Output "MUST render live (its
   kind's own thumbnail/value/sparkline from the last dry or live run)".
   `tasks.md` 1.4 records the live thumbnail as "deferred as scope-conservative",
   and the live picker shows only kind label / name / placement count. Either
   build it or amend the delta — a spec delta that asserts unshipped behavior
   is worse than an open task, because it is archived as truth.
3. **Task 10.4 is openly not done** — the OpenSpec capability-spec sweep was
   not re-verified beyond `first-run-onboarding`. `openspec validate` only
   checks structure. With findings 1 and 2 showing the deltas *do* drift from
   shipped behavior, this task cannot be waved through.

## Phase 2: Code Review — FAIL

Verified PASS: no inline FQNs / lint-clean / format-clean; the
`config.format` (HEL-876) work is wired through renderers, builder, editor and
preview with round-trip tests; the Done-button computed-style guard
(`OnboardingChecklist.test.tsx:381-407`) is genuine — it loads the real CSS off
disk, injects it, asserts computed values, and its sibling red arm blanks the
governing rule *and asserts the mutation actually landed* before asserting the
failure. The `PanelDetailModal` negative assertions (`:161-164`) assert absence
of specific retired controls by role/label, not "renders without crashing".

**Blocking code findings:**

4. **`useOutputPickerData` derives pipeline names from `state.pipelines.items`,
   which is empty on the dashboard route — every group heading renders the
   literal placeholder "Pipeline" in the real app.**
   `frontend/src/features/panels/hooks/useOutputPickerData.ts:83,95`
   (`pipelineNameById.get(pipelineId) ?? "Pipeline"`). Nothing dispatches
   `fetchPipelines()` when the picker opens; probe-confirmed — the picker
   issues **zero** `/api/pipelines` requests, and live DOM shows 51 group
   headings with exactly one unique value, `"Pipeline"` (screenshot
   `.playwright-mcp/hel909-picker-375.png`). Accessible names degrade to
   `"My chart (Pipeline)"`, and the search's pipeline-name branch
   (`OutputPicker.tsx:63-64`) can never match. This breaks
   `specs/output-picker/spec.md`'s "the list is grouped under each pipeline's
   name" and ticket AC 2's grouping claim.
   **This is a blind gate**: `OutputPicker.test.tsx:48-61,109` preloads a
   `pipelines` slice into the test store, so the grouping assertion passes on
   an ambient fixture the real app never provides.
5. **Swap-mode bypasses the service layer with an inline dynamic import.**
   `frontend/src/features/panels/ui/OutputPicker.tsx:274-281` —
   `swapPanelOutputId` does `await import("../../../services/httpClient")` and
   PATCHes `/api/panels/:id` directly from a component module. CLAUDE.md's
   request flow is Component → thunk → service; `panelService.ts` is the owner
   of panel HTTP. The in-file comment acknowledges this and defers it. Put the
   PATCH in `panelService.ts` and dispatch it like every other panel write (a
   static import at minimum — the dynamic import buys nothing here).
6. **Silent failure on the primary action.**
   `OutputPicker.tsx:110-113` and `:120-123` swallow every error from
   `placeOutput`/`placeContentPanel` with a bare `catch {}` that only re-enables
   the button — a failed `POST /api/panels` or failed swap leaves the user with
   no feedback at all. `useOutputPickerData.ts:55-59` similarly swallows a
   failed placements fetch into a silently-wrong `0 placements`. Surface an
   error (the picker already has an `output-picker__status--error` slot) rather
   than failing silently.

## Phase 3: UI Review — FAIL

Ran live against the restarted servers (desktop 1440-ish, plus 375px).

Working:

- Add panel (command-bar kebab → "Add panel") opens the picker; typing a name
  and pressing **Enter** places the panel — keyboard path works, 3 interactions
  vs. the old wizard's ~5.
- Panel sheet for an output panel shows exactly title / appearance /
  Output link (`/pipelines/:id?outputId=…`) / **Swap output** / placements note
  — no field-mapping, aggregation, or Data tab anywhere.
- **Swap output re-verified end-to-end, not on faith**: swapping persisted the
  new `outputId` on an independent `GET /api/dashboards/:id/panels`, the sheet's
  Output link updated, and the grid panel's rendered content changed from
  "No data available" to real data ("Alpha"). The `PanelRepository` fix is real
  and effective.
- 0 console errors/warnings on the page under test across the whole flow.
- 375px: picker modal 337px wide, cards 295px, no horizontal overflow; bottom
  nav shows 5 destinations at 54px height.

Failing:

7. Every picker group heading reads "PIPELINE" (finding 4) — visible in the
   375px screenshot and confirmed by DOM query on desktop.
8. Placed panels do not take the kind's default size (finding 1); a `metric`
   Output lands at the same generic fallback size any other kind would.

Not exercised (noted, not blocking): the three-step onboarding checklist was
not walked live — it requires a first-run account; Jest coverage for it is
substantive and was reviewed.

## Overall: FAIL

## Change Requests

1. Implement the decision-15 server-owned default sizes on `POST /api/panels`:
   compute the per-kind size (metric 3×2 · chart 6×4 · table 6×6 · collection
   6×4 · timeline 4×6 · markdown 4×4) from the referenced Output's `kind`, write
   the `dashboards.layout` item in the same transaction as the panel insert, and
   return the placed layout. No frontend copy of the constants. Backend regression
   test proven red first (place one Output of each kind, assert the returned/
   persisted layout dims). Reference: epic spec lines 44 / 140 / 224;
   `PanelPacker.scala:31-43`'s own placeholder note. If the orchestrator rules
   this out of a frontend-only scope, that ruling must be recorded in design.md
   *and* the contradicting scenario in `specs/output-picker/spec.md` amended —
   it cannot ship asserting behavior that does not exist.
2. Fix the picker's pipeline grouping: load pipeline names before/while the
   picker renders (dispatch `fetchPipelines()` from `useOutputPickerData`, or
   carry `pipelineName` on the `GET /api/outputs` list payload). Remove the
   `?? "Pipeline"` placeholder or make it a genuinely unreachable fallback.
   `frontend/src/features/panels/hooks/useOutputPickerData.ts:95`.
3. De-blind the grouping test: add an `OutputPicker` test whose store has **no**
   preloaded `pipelines` slice and which still asserts the real pipeline names
   appear (it must fail against today's code). Today's
   `OutputPicker.test.tsx:48-61` fixture is ambient state the app never supplies.
4. Move the swap PATCH into `panelService.ts` (a `patchPanelOutputId`-style
   helper) and call it through the existing dispatch/thunk path; drop the inline
   `await import("../../../services/httpClient")`.
   `frontend/src/features/panels/ui/OutputPicker.tsx:274-281`.
5. Surface placement/swap failures to the user instead of the bare `catch {}` at
   `OutputPicker.tsx:110-113` and `:120-123`; reuse the existing
   `output-picker__status--error` element. Cover with a test that rejects the
   create/patch call and asserts a visible message.
6. Resolve the live-thumbnail requirement in `specs/output-picker/spec.md`
   ("MUST render live … thumbnail/value/sparkline") — either implement it or
   amend the delta to match what shipped (`tasks.md` 1.4 records it as deferred).
7. Complete task 10.4: walk the capability specs this change touches and confirm
   each one's prose matches shipped behavior, correcting the deltas where it
   doesn't (findings 1 and 2 are two known instances, so this is not a
   formality).

## Non-blocking Suggestions

- `PanelDetailModal.tsx` is 441 lines (was 419 on `main`), past CONTRIBUTING's
  ~400-line "propose a split" threshold — `OutputPanelSection` and the
  appearance block are natural extractions.
- The placements note says "Used on N dashboards" but N is a **panel** count
  (`listOutputPanels(...).length`), so two panels on one dashboard read as "2
  dashboards"; it also renders "Used on 1 dashboards".
  `PanelDetailModal.tsx:106-109`.
- `useOutputPickerData` does an N+1 `GET /api/outputs/:id/panels` per Output —
  self-documented and accepted, but with 51 pipelines in the dev DB it already
  produced `429` rate-limit responses in a neighbouring session. A count field
  on the list response (as the comment itself suggests) would be cheap.
- Picker arrow-key navigation moves a visual `--focused` class but never DOM
  focus and exposes no `aria-activedescendant`, so a screen-reader user hears
  nothing move. Worth a follow-up if not this cycle.
