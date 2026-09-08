## Evaluation Report — Cycle 1 (evaluation-1.md)

Base: rebased onto `origin/main` @ `9e995f69`. Reviewed `42c7dfe3` + `9a4ddd60`.
All gates and mutations below were re-run by me in this worktree; nothing is taken from the
executor's report.

### Content self-authentication (before any visual observation)

`curl http://localhost:5935/src/features/commandPalette/model/resourceSearch.ts` returns the
transformed module containing `SEARCH_RESULTS_PER_KIND_CAP` (3 occurrences), and
`.../useResourceSearchActions.ts` is served — both files exist ONLY on this branch (added by
`42c7dfe3`, absent from `origin/main`). The dev server on 5935 is therefore serving THIS branch's
source, not a same-port neighbour. Visual observation proceeded only after this.

### Phase 1: Spec Review — FAIL

- ACs 1/2/3/4/5 (grouped ranked cross-kind results, `/`-route search with no prior navigation,
  keyboard-navigable + `.eyebrow` labels + light/dark, debounced, coverage naming which kinds are
  searched): all addressed and independently observed (see Phase 3).
- Scope held to the four ruled-in kinds; `panel`/`connector` correctly excluded and documented in
  `resourceNavigation.ts:6-11`. No scope creep in the diff. No spec/schema/wire change (frontend
  only, reusing an existing endpoint) — correct.
- Planning artifacts match the implementation.

Issue:

1. **Task 2.1 is ticked `[x]` but its prescribed verification does not exist.** The task requires
   "unit test over the reducer, plus a test that a >1-page response is fully indexed (mock `total`
   greater than one page and assert every item is present)". Grepping the whole frontend, the only
   test file referencing `fetchAllOutputs`/`listAllOutputs` is
   `frontend/src/features/commandPalette/useResourceIndexing.test.tsx`, which mocks the thunk
   creator and asserts call counts — it never exercises the reducer or pagination.
   `frontend/src/features/pipelines/state/outputsSlice.test.ts` has no `fetchAllOutputs` case, and
   `frontend/src/features/pipelines/services/outputService.ts:67-82`'s `listAllOutputs` loop has no
   test anywhere. So the ticket's own "the outputs index is complete with respect to
   `listAllOutputs()`" guarantee (design.md D3) is entirely unguarded. This is a checked box whose
   evidence does not exist — the exact class this lane hunts.
   (The reuse itself IS correct — see Phase 2 item 4 — so this is a missing guard, not a wrong
   implementation.)

### Phase 2: Code Review — FAIL

Gates I ran myself, from `frontend/` (NOT the worktree root, whose `jest --passWithNoTests` finds
zero tests):

| Gate | Command (cwd) | Result |
|---|---|---|
| lint | `npm run lint` (`frontend/`) | pass, `eslint src --max-warnings=0`, exit 0 |
| format | `npm run format:check` (`frontend/`) | pass |
| typecheck | `npx tsc --noEmit -p tsconfig.json` (`frontend/`) | clean, no output |
| tests | `npm test` (`frontend/`) | **290 suites / 2922 tests passed** — a real scan, not `passWithNoTests` silence |
| tokens (HEL-1037) | `npm run check:tokens` (root) | `OK — every var(--*) reference under frontend/src resolves` |
| motion guard (HEL-441) | included in the 290-suite run (`motionTokenGuard.css.test.ts`) | green; the only new CSS (`.command-palette__coverage`) declares no `transition`/`animation` at all |
| e2e | `DEV_PORT=5935 npx playwright test e2e/hel503-*` | **5 passed (15.0s)** against the live servers |

**The seven prescribed items — each RE-VERIFIED BY MUTATION, and each mutation confirmed landed
(patch asserted in-process before running; `git diff --quiet` clean after restore):**

1. **`Record<RecentKind, true>` exhaustiveness — CONFIRMED, and genuinely failable.** Mutation:
   added `| "widget"` to `ResourceKind` (assert-on-patch: landed, line 12 shown). `tsc` produced
   `recentHistoryStore.ts(46,7): error TS2741: Property 'widget' is missing in type
   '{ dashboard: true; source: true; pipeline: true; }' but required in type
   'Record<RecentKind, true>'` — plus 8 more errors across `useRecentPaletteActions.ts:12/65`,
   `useResourceSearchActions.ts:14/21/56/72/163`. The shipped code uses the `Record` form
   (`recentHistoryStore.ts:46-47`), with `VALID_KINDS` derived from `Object.keys`, not an array
   annotation. Restored, clean.
2. **`RecentEntry["kind"]` and `recordVisit`/`pruneMissing` retyped to `RecentKind` — CONFIRMED.**
   `recentHistoryStore.ts:11` (`type RecentKind = Exclude<ResourceKind, "output">`), `:26`, `:120`,
   `:124`. `tsc` is clean unmutated, and HEL-519's recents tests pass **unmodified** (only the
   `outputs` reducer was added to test stores, which is a store-shape requirement, not a behaviour
   edit). Recents still work end-to-end: `helio.recentVisits` is present and read in the running
   app, and the 12 commandPalette suites (102 tests) are green.
3. **Explicit `const _exhaustive: never = ref;` — CONFIRMED PRESENT AND FAILABLE.**
   `resourceNavigation.ts:90`. Mutation: removed `case "output":` from `useResourceNavigator`
   (patch asserted, switch body printed). `tsc` →
   `resourceNavigation.ts(89,15): error TS2322: Type '{ kind: "output"; id: string; pipelineId:
   string; }' is not assignable to type 'never'.` Restored, clean.
4. **`listAllOutputs()` REUSED, no new single-page thunk — CONFIRMED.** `outputsSlice.ts`'s
   `fetchAllOutputs` calls the pre-existing `listAllOutputs()`
   (`outputService.ts:67`), which loops on `offset >= total`. No `httpClient.get("/api/outputs")`
   was added. **But the ">1-page is fully indexed" test the task prescribes does not exist** — see
   Phase 1 issue 1 / CR1.
5. **The `/`-route e2e fixture creates a dashboard FIRST — CONFIRMED, and I re-ran the mutation
   myself.** `e2e/hel503-...spec.ts:22-45`'s `registerAndLoginWithDashboard` POSTs
   `/api/dashboards` (asserts 201) before the `page.reload()`, so
   `useOnboardingHost`'s zero-dashboard auto-activation never fires. Mutation: replaced all four
   `void dispatch(fetch…())` calls in `useResourceIndexing.ts` with no-ops (assert-on-patch: exactly
   4 substitutions landed, verified by grep). Result: **3 failed, 2 passed** — precisely the three
   indexing-dependent tests (source+pipeline on `/`, output on `/`, source navigation from `/`).
   Restored → 5 passed. The executor's report is accurate.
6. **Coverage derived from live status, `failed` distinct from `loading` — CONFIRMED.**
   `useResourceSearchActions.ts:67-85` computes from `IndexStatuses`; no literal kind list exists
   twice. Hardcode mutation is unnecessary to *run* because the guard's own assertion is
   structurally red under it (`useResourceSearchActions.test.ts` splits the "covers" clause and
   asserts `pipeline` is ABSENT — a constant string necessarily contains it); I confirmed the
   assertion is on the real function's output, not a fixture. Live app: with all four kinds
   `succeeded`, `.command-palette__coverage` is absent entirely (task 4.3) — observed in the browser.
7. **Per-kind cap applied AFTER ranking — CONFIRMED.** `resourceSearch.ts:60-66` sorts by rank,
   *then* `.slice(0, SEARCH_RESULTS_PER_KIND_CAP)`, with `overflowCount` from the pre-slice length.
   Observed live: a one-character query `a` yields exactly 5 rows per kind plus a
   "+25 more dashboards / +51 more sources / +25 more pipelines / +50 more outputs" row — 35 options
   total instead of the ~160 an uncapped `matchesQuery` merge would have produced.

**Self-reported items I scrutinised:**

- **Unbounded retry loop / ref-based open-edge fix.** The fix is correct: the effect
  (`useResourceIndexing.ts:73-89`) is keyed on `[isOpen, dispatch]` only and reads statuses through
  `latestStatuses.current`, so a `failed→loading→failed` settlement cannot re-trigger it inside one
  open palette session. **A regression guard does exist, but only incidentally.** I reintroduced the
  bug (`const current = statuses;` + `statuses` back in the deps; patch asserted): the dedicated
  `useResourceIndexing.test.tsx` stayed **4/4 GREEN**, and only a *generic* test in
  `CommandPalette.test.tsx:152` went red (an unrelated Enter-key `waitFor` timing out under the
  request storm). So the regression is caught, but by a symptom in another file, not by a named
  assertion — see suggestion S1.
- **Byte-identical hover/focus screenshots.** The executor's disclosure is honest but its diagnosis
  is incomplete, and I closed the gap in the running app rather than leaving it unverified: the
  palette **sets `data-active`/`aria-selected` on mouseenter**, so hover and keyboard-active are the
  same visual state by construction (pre-existing palette behaviour, not new). Measured computed
  styles while hovering a NON-active row: dark — hovered `rgb(22,21,20)` vs rest `rgba(0,0,0,0)`;
  light — hovered `rgb(239,236,230)` vs rest `rgba(0,0,0,0)`, text `rgb(33,29,25)` in both. HEL-866's
  modal-hosted light-theme collision does **not** reproduce: the hover surface is distinct from the
  dialog surface in light. Evidence:
  `.concertino/runs/HEL-503/evidence/eval-light-hover-nonactive.png`.
- **Prescribed mutation-guards.** Spot-checked five (1.0, 1.3, 5.1, 3.4a-by-inspection-of-the-sliced
  path, and the loop guard), each with the patch asserted before running. All landed; four behaved
  as claimed; the loop guard behaved as described in the paragraph above.

Code-quality findings:

2. `frontend/src/features/commandPalette/useResourceSearchActions.ts:49-57` — `buildRef` reintroduces
   exactly the invalid state design.md D1 exists to make unrepresentable. `SearchableItem.pipelineId`
   is `string | undefined` (`resourceSearch.ts:17`), so an output item built without a pipeline id
   compiles, and `buildRef` papers over it with `pipelineId: item.pipelineId ?? ""` — producing
   `/pipelines/?outputId=<id>`, i.e. **a row that appears to work and goes nowhere**, this batch's
   signature failure, one layer above the union that was supposed to prevent it. It is currently
   unreachable only because `Output.pipelineId` happens to be required — a fact nothing in this file
   asserts.

Everything else in Phase 2 is clean: DRY (cap and kind-list each declared once; `titleMatchRank`
exported rather than `titleTier` duplicated), naming and comments are unusually clear about what each
mechanism proves, no `any` outside one commented test-store escape hatch, no dead code, no TODOs, no
drive-by behaviour changes, errors surfaced through slice status rather than swallowed.

### Phase 3: UI Review — PASS

Judged against the running app (dev 5935 / backend 8842), logged in as the dev account, after content
self-authentication above.

- Happy path: `Ctrl+K` on `/` → typing `a` → four `.eyebrow` groups in declared order
  (`Search results`, `Navigation`, `General`, `Create`), 35 options, per-kind icons
  (dashboard/source/pipeline/output), output rows carrying their pipeline name as subtitle.
- Selecting results: e2e proves all four kinds live — output lands on
  `/pipelines/:id?outputId=:oid` **with the sheet presented** (heading assertion), source lands on
  `/sources/:id`, dashboard selects without leaving `/`.
- Unhappy/empty/loading: coverage caveat renders under a slowed `/api/data-sources` (e2e test 5);
  full coverage renders no caveat at all (observed: `coverage: null`); a non-matching query while
  indexing shows "Still searching…" rather than "No matching commands".
- No console errors during any flow.
- Accessible names + keyboard: rows are `role=option` with `aria-selected`/`data-active`,
  `aria-label="Search commands"` on the input; palette opens/navigates by keyboard throughout.
- Light and dark both verified by computed style, not by eyeballing a PNG (jsdom would prove neither).

Two **[judgment]** cohesion observations deferred to the skeptic (I am not ruling on them):
the overflow rows ("+25 more dashboards match — refine your search") have no icon and so their text
starts ~30px left of every iconed row's text column; and the first group label can render clipped
against the input when the results list is scrolled to the top.

### Overall: FAIL

Two change requests, both small and local. Nothing in the feature's behaviour is wrong on any path I
could exercise — the failures are an unbacked ticked box and a type hole, both of which this lane
treats as first-class.

### Change Requests

1. **Add the guard task 2.1 claims.** In `frontend/src/features/pipelines/state/outputsSlice.test.ts`
   (or a new `outputsSlice.allOutputs.test.ts`), mock `httpClient.get` to answer
   `/api/outputs` with two pages (e.g. `{items: 200 items, total: 250, offset: 0, limit: 200}` then
   `{items: 50 items, total: 250, offset: 200, limit: 200}`) and assert that after
   `fetchAllOutputs` resolves, `state.outputs.allItems` has **250** entries and `allStatus` is
   `"succeeded"` — plus a `rejected` case setting `allStatus: "failed"`. Then run the prescribed
   mutation (make the client read only the first page) and confirm the test goes red, verifying the
   patch landed. If you conclude the reducer half is better covered elsewhere, say so explicitly and
   un-tick that clause rather than leaving 2.1 ticked with no pagination evidence anywhere.
2. **Close the `buildRef` hole** (`useResourceSearchActions.ts:49-57`,
   `resourceSearch.ts:12-20`). Make `SearchableItem` a discriminated union mirroring `ResourceRef`
   — `{ kind: "dashboard"|"source"|"pipeline"; id; title; subtitle? } | { kind: "output"; id; title;
   pipelineId: string; subtitle? }` — and delete the `?? ""` fallback so `buildRef` returns
   `{ kind: "output", id: item.id, pipelineId: item.pipelineId }` with no defaulting. Verify by
   mutation: removing `pipelineId` from the output item construction in
   `useResourceSearchActions.ts:123-129` must then fail `tsc`, where today it compiles and silently
   navigates to `/pipelines/?outputId=…`.

### Non-blocking Suggestions

- **S1** — The unbounded-retry-loop regression is currently caught only as a timing symptom in
  `CommandPalette.test.tsx`. Add a named assertion in `useResourceIndexing.test.tsx`: with one kind
  `failed`, open once and assert the thunk creator was called **exactly once** after flushing the
  rejection (`await act(...)`), so a future re-add of `statuses` to the dep array fails a test that
  *says* what it is protecting. I verified the current dedicated suite stays green under that
  mutation.
- **S2** — The overflow row is a real `role=option` whose `run` is a no-op: pressing Enter on it
  closes the palette and discards the query. Consider rendering it as a non-selectable group footer,
  or having `run` keep the palette open.
- **S3** — Dashboard results carry no subtitle, so same-named dashboards render as indistinguishable
  rows (four identical "Evaluation Dashboard" rows in the live dev DB). A disambiguating subtitle
  would help; not a defect introduced by this ticket.
- **S4** — Task 6.4's second axis is answered honestly, and I confirm its gap #1 is real: the
  `failed`-kind retry path has no real-browser coverage (`page.route` fulfilling a 500 on
  `/api/outputs`, then re-opening the palette, would close it cheaply).

### Answering the two-axes question

**What does no source text carry?** Whether the index is *populated*. Every static artefact —
types, lint, `tsc`, `check:tokens`, the motion guard, and every jsdom test that supplies a
`preloadedState` — is satisfied identically by an app that indexed four kinds and by one that
indexed none: an unindexed search and an empty workspace are the same source text and the same DOM.
The only thing that distinguishes them is a live fetch on the `/` route, which is why the mutation I
re-ran (neutering the four dispatches → 3 e2e red, 2 still green) is the only evidence in this
delivery that actually discriminates. Note precisely which two tests stayed green under it: the
dashboard test (dashboards load at boot regardless) and the coverage test (a caveat renders whether
or not anything was indexed). Those two are the shape of the vacuous test this ticket was written to
avoid, and they are green for honest reasons only because the other three exist.

**What path did the gates not exercise?** Three: (a) the multi-page outputs read — no gate anywhere
touches `listAllOutputs`'s loop, so a truncated index would pass every gate in this repo (CR1);
(b) the failed-kind retry in a real browser (unit-only, S4/6.4); and (c) an output item built
without a `pipelineId` — no gate rejects it, and the `?? ""` fallback converts it into a plausible
but dead navigation instead of an error (CR2). All three share one shape: a wrong answer that is
byte-identical to a right one at every layer a gate can see.
