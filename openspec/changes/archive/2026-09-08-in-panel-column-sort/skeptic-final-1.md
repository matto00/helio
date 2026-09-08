# Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold agent. Every conclusion below is derived from the worktree at `9a4b1998`, the running app on
DEV_PORT 5880 / BACKEND_PORT 8787, or a command I ran myself. The executor/evaluator reports were
read as claims only.

Playwright-session sanity: the shared browser HAD stale console entries from `localhost:5942`
(the known parallel-lane hijack). All findings below are from requests whose URL is
`http://localhost:5880/...` and were re-derived after a fresh navigation.

---

## What I verified (with evidence)

### Gates (re-run, not inherited)

Per evidence rule 1, `npm --prefix frontend` used throughout — never root `npm test`.

```
npm --prefix frontend run lint      -> eslint src --max-warnings=0   exit 0
npm --prefix frontend run typecheck -> tsc --noEmit                  exit 0
npm --prefix frontend run format:check -> "All matched files use Prettier code style!"
npm --prefix frontend test          -> Test Suites: 273 passed, 273 total
                                       Tests: 2803 passed, 2803 total
```

### Load-bearing claims — mutation-verified by me, not accepted

I mutated the shipped source and re-ran `TableRenderer|outputConfigTypes|DataGrid`, restoring
after each (`git diff --quiet -- frontend` clean at the end):

| Mutation | Result |
| --- | --- |
| D3 blank guard `if (trimmed === "") return null` disabled | **1 test fails** (2.5b) — proof test is red without the fix |
| D3 numeric coercion `Number.isFinite(asNumber)` removed | **1 test fails** (2.5a) — proof test is red without the fix |
| `UNSORTED_SENTINEL` changed to `"n"` (a REAL fixture column) | **7 tests fail** — the 2.4 sentinel guard is genuinely mutation-failable |
| D6 unmount flush disabled (`if (pendingSortRef.current)` → `if (false)`) | **1 test fails** (3.3b) — flush-on-unmount is guarded |
| D7 ownership pre-check `\|\| !canWrite` removed | **1 test fails** (3.5) — pre-check is guarded |
| `readColumnSort` reduced to a passthrough | **6 tests fail** — coverage is load-bearing |

Note on my own method: my first sentinel mutation used `"col_0"`, a key absent from the fixtures, and
so was a no-op mutation that proved nothing. I re-ran it against the real fixture column `"n"` before
drawing any conclusion. The claim holds; my first measurement was the bad one.

### D6a / D5 / D6 read directly in code

- ONE `useSortedRows` call, fed by one pre-branch `normalizedRows`/`sortColumns` normalization
  (`TableRenderer.tsx` ~156–186). No per-branch hook call. `defaultSort` seeded once via a
  `[]`-dep memo, and `PanelContent.tsx:105-112` really does withhold `TableRenderer` behind
  `PanelBodySkeleton` until `useOutputMeta` resolves — the seeding note's precondition is true.
- Persist fires only from `handleSort` (a user activation), never from an effect on `sortState`.
- The PATCH body is literally `{ config: { columnSort: next } }`; `output.config` is never spread.
  Confirmed end-to-end against the live backend: after sorting, `GET /api/outputs/<id>` returned
  `config` keys `["columnSort","columnWidths","fieldMapping"]` — the pre-existing `columnWidths` and
  `fieldMapping` survived untouched. `OutputService.mergeConfig`
  (`OutputService.scala:274-282`) is a shallow merge with four hardcoded deep-merge chart keys, so
  D5's promise that HEL-451/465/469 can land as flat siblings is structurally correct.

### `getSortValue` — the boundary adapter, walked once more against the shipped hook

Traced every branch against `useSortedRows.compareValues`/`compareNonNull`:

- `null`/`undefined`/`number` pass through → hook's nulls-last branch, outside the sign flip. Correct.
- `""`/whitespace → `null` BEFORE `Number()`. Both traps closed in the right order: `Number("")===0`
  never fires, and a passed-through `""` never reaches `localeCompare` (where it would sort first
  ascending). Verified live: ascending `["-5","3","10","",""]`, descending `["10","3","-5","",""]`.
- Numeric strings → numbers (so `1.25 < 1.5 < 1.9 < 2 < 10`), NON-numeric strings pass through
  unchanged — including ISO-8601, which `Number()` rejects, so the hook's `ISO_DATE_PATTERN`
  epoch-millis path is reached intact. This is the ordering that the design gate's two paper defects
  were about, and it is correct as shipped.
- Objects → `formatCell`, not `String(v)`, so `{}`s do not all collapse to one `"[object Object]"` tie.
- `NaN` cannot arrive (JSON cannot encode it; the `rawRows` branch is strings), so the
  number-minus-number comparator can never return `NaN`.

I could not construct a real intransitive ordering for a mixed numeric/non-numeric column;
`localeCompare(..., {numeric:true})` agrees with numeric ordering on digit-leading strings.

### Accessibility, end to end, in the running app

On a real table panel (`.panel-content--table`, 30 columns, 200 real rows):

- `aria-sort` on the sorted `th` is `"ascending"`/`"descending"` and every other sortable `th`
  is `"none"` — read live, e.g. `["none","ascending","none","none"]`.
- Accessible name is the column name (`getAllByRole("button", { name: "col_1" })` resolves; the
  control is a real `<button>`, `tagName === "BUTTON"`).
- **Enter** on the focused header: `aria-sort` `ascending → descending`, top cell `r0c1 → r199c1`.
  **Space**: back to `ascending`, top cell `r0c1`. Both real, both live, no bespoke key handler.
- Direction is a glyph (`faSortUp`/`faSortDown`/`faSort`) plus an opacity change, never color alone.
  `SortableTh.css` puts `--app-accent` on `:hover` ONLY.
- Resize handle: focused the `role="separator"` `tabIndex={0}` span, pressed ArrowRight — column
  width `160 → 170`, that `th`'s `aria-sort` stayed `"none"`, and the sorted sibling column's
  `"ascending"` was unchanged. The two controls are independently operable.

### D9a — judged, not assumed

- Silent when fully loaded: on a 200-row Output fetched at `limit=200`, `hasLoadMore=false` and
  `.panel-content__truncation-note` is **absent** from the DOM. Confirmed live.
- Silent on the `rawRows` branch: enforced by the `usingPagination &&` guard, plus a dedicated test.
- Present when truncated: bound the real 1,000-row `HEL-599 Sleeper WR probe rows` Output to a fresh
  panel; the note rendered as `"Sort covers only the loaded rows."` above "Load more".
- No wrap/clip/displacement: at a default dashboard-grid panel size the note sits centered above the
  button with `--space-1` between them. At a 420px mobile viewport I measured note width 186.6px in a
  306px container, `scrollWidth === clientWidth === 306` — no horizontal overflow despite
  `white-space: nowrap`. Verified in both themes.
- Provenance: grepped every mention. `design.md:295`, `tasks.md:131`, `workflow-state.md:126` and the
  in-code comment all label it NOT owner-approved / coordinator addition. Nothing describes it as
  owner-approved. Removal is genuinely trivial (one `<p>` + one CSS rule).

### UI cohesion — judged against the running app, in both themes

- The affordance is not a lookalike, it is the same code path: `DataGrid.tsx` imports
  `SortableTh.css` and reuses `.sortable-th__btn` / `.sortable-th__glyph` /
  `.sortable-th__glyph--neutral` verbatim, with the same `faSort`/`faSortUp`/`faSortDown` icons and
  the same `aria-sort` vocabulary. No new class family, no new token, no hardcoded value.
- Compared the live panel table against the live `/pipelines` list table. The glyph, its gap from the
  label, the neutral dimming and the hover accent read as one system. The panel headers are larger
  and sentence-case where the list headers are a small caps/mono label — that is the pre-existing
  `DataGrid` "full"-variant density, not a divergence introduced here. The surfaces do not disagree;
  no escalation.
- Light theme: hover turns label + glyph `--app-accent` (orange) and stays legible on the light
  header background. I did not reproduce the HEL-866 / HEL-496 light-theme hover token collision on
  this surface.
- `.panel-content__truncation-note` uses `--text-xs` and `--app-text-muted` — tokens, not literals.

### Evaluator's PR-body wording correction — **CONFIRMED**

`SortableTh.css` scopes `--app-accent` to `.sortable-th__btn:hover` and
`.sortable-th__btn:hover .sortable-th__glyph`. The ACTIVE state is the filled up/down caret plus
full opacity (vs `--neutral`'s `0.45`) plus `aria-sort` — no accent at all. Both committed
comparators capture the active column while it happens to be hovered, so they do conflate the two.
The correction is right and should go in the PR body.

### Deferral is real (evidence rule 4)

`HEL-1027` exists in Linear (Backlog, v0.7 project, created 2026-09-08), titled "Server-side sort for
Output rows", and its scope/AC actually own the deferred work — including removing this ticket's
truncation qualifier. Every in-repo reference to it is accurate.

### Test hygiene

`git diff --numstat -- "*test*"`: `196/7`, `91/0`, `96/0`. Every one of the 7 deleted lines is the
`panelId` → `outputId` prop rename plus one import. No existing test or fixture was edited to
accommodate rather than verify.

### The evaluator's one residual gap — judged

"A sort naming an unknown column renders source order" has no dedicated component test. I accept the
inherited signal, on evidence rather than on the argument: `defaultSort` is
`columnSort ?? sentinel`, and my `"n"` mutation proved the sentinel line is genuinely exercised and
failable — an unknown stored key traverses that exact `columns.find(...) → return rows` passthrough.
`outputConfigTypes.test.ts` separately pins that an unknown key still PARSES. The evaluator also
closed it manually against a real Output. Non-blocking; a one-line direct test would be nicer, and
I list it below as a note rather than a change request.

---

## Verdict: REFUTE

One reproduced, live defect in new code. Everything else above verifies.

## Change Requests

### 1. The persist call is fire-and-forget with NO error handling — an uncaught promise rejection reaches the console on a routine sort, and the sort silently fails to persist

`frontend/src/features/panels/ui/renderers/TableRenderer.tsx:220` and `:249` both do
`void updateOutput(...)` with no `.catch`. Design D7 pre-checks exactly ONE failure mode (non-owner)
and nothing handles any other.

**Reproduced live on this branch, on real data, twice** — including once from a completely fresh page
load with a clean console:

```
[ERROR] Failed to load resource: the server responded with a status of 400 (Bad Request)
        @ http://localhost:5880/api/outputs/hel904-output-e2ee1b2e-3b59-4334-8988-36e722a3b9bc:0
AxiosError: Request failed with status code 400
    at settle (.../axios.js:1932:14)
    at XMLHttpRequest.onloadend (.../axios.js:2361:4)
```

Recipe: dashboard "HEL254WideType overview" → panel "HEL254WideType table" → click any column header.
The network log shows `[PATCH] /api/outputs/hel904-output-e2ee1b2e-... => [400] Bad Request`.

Root cause of the 400 is NOT this change and I am not asking you to fix it: that Output carries a
legacy `config.fieldMapping = {"columns": "col_27,col_16,..."}`, and `OutputBindingSpec.Table` has no
slots at all (`OutputBindingSpec.scala:80-82`), so HEL-892's validate-the-MERGED-config rule
(`OutputService.scala:113-126`, `:247-252`) rejects every write to that Output. 4 of 53 table Outputs
in this dev DB carry that legacy key, so it is a real population, not a synthetic one.

What IS this change's to own: on that path the user sorts, sees it work, gets no feedback, loses the
sort on reload — the headline AC "sort persists ... across page reload" silently fails — and the app
emits an uncaught rejection. Both evaluations reported "zero console errors"; that was true only of
the Outputs they happened to exercise.

**Required:** give both `updateOutput` calls an explicit terminal handler rather than leaving the
rejection unhandled. A deliberate silent swallow is acceptable and consistent with D7's
silent-degrade philosophy — the point is that it must be *deliberate and commented*, not absent.
Something in the shape of:

```ts
void updateOutput(outputId, { config: { columnSort: next } }).catch(() => {
  // Deliberate silent degrade, extending D7 from the 403 case to every other
  // write failure: the sort is already applied on screen and a failed persist
  // costs the user nothing this session. Swallowed rather than left unhandled
  // because an uncaught rejection is observable in the console on real data --
  // an Output carrying a legacy `fieldMapping` key is rejected 400 by
  // OutputService's merged-config validation (see HEL-892), reproduced on
  // hel904-output-e2ee1b2e-... during the HEL-448 final gate.
});
```

Add a test that a rejecting `updateOutput` does not produce an unhandled rejection and does not
disturb the on-screen sort (the `outputService` mock is already in place — `mockRejectedValue`).

Please do NOT expand this into a toast/retry/error-surface redesign; D7's "no toast" ruling stands
and a visible error here would contradict it. This is a two-call-site fix plus one test.

## Non-blocking notes

1. `DataGrid`'s `<th>` does not set `scope="col"`, while `SortableTh` does. Implicit scope makes this
   harmless and it is pre-existing on `DataGrid` (not introduced here), but now that the two headers
   are explicitly the same affordance, adding `scope="col"` would close the last gap between them.
2. HEL-1027's body says a grid panel fetches `pageSize: 50` citing `PanelCard.tsx:88`. That line is
   the LOAD-MORE page size; the initial fetch is 200 for both the grid and the detail modal
   (`usePanelData.ts:66`). The design's substance (partial ranking) is unaffected, but the number is
   wrong in the follow-up ticket and worth correcting there so HEL-1027 does not inherit it.
3. The spec scenario "Equal values retain loaded order" has no test. `Array.prototype.sort` is
   spec-stable so the behavior is real; a two-line test would make the scenario non-inherited.
4. Numeric coercion means a large integer-like string ID (>2^53) or a leading-zero code ("007") can
   tie with a different literal string. Inherent to D3's ruled design, display is unaffected. Worth
   one sentence in HEL-469's (per-column formatting) context, not a change here.
5. "Load more" with an active sort inserts rows mid-list rather than appending. I judged this
   correct, not jarring — it is what the spec requires and what a partial ranking should do — but it
   is the behavior the D9a note exists to explain, which is another argument for keeping D9a until
   HEL-1027 lands.
6. Dev-DB residue from my probes (all owner-scoped, harmless, this DB is already ~94% test residue):
   `hel904-output-eb6762c8-...` now carries `columnSort {key:"col_1",direction:"asc"}`, and I created
   one panel bound to `hel904-orphan-output-ae5b18b6-...` on the "Skeptic Isolation Test" dashboard
   to exercise D9a's truncated branch.
