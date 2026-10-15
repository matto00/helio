## Context

- HEL-1599 (`openspec/changes/archive/2026-10-15-settle-lazy-chart-mounts/`) added
  `frontend/src/test/settleChartMount.ts`: `await act(async () => { await Promise.all(<mock results / promises>);
  await import("../features/panels/ui/ChartPanel"); })`, then callers query with `getBy*`. Its measurements.md "Left"
  table names the non-lazy-chart waits it did not convert, and its `arm` stall table shows them red 5/5 at 1200 ms:
  - `panels/ui/PanelContent.chartTruncation.test.tsx` — `findByText(NOTE)` / disclosure / count waits
    (main 563a4c476 lines 94, 100, 135, 155, 157, 175, 184), gated on `getOutputById` and `fetchHistory`.
  - `dashboards/ui/PublicDashboardViewerPage.truncation.test.tsx:89` — note wait, gated on the chain
    `fetchPanels` → (`fetchMeta` + `fetchRows`) (two React flushes; the second test there already settles in two steps).
  - `panels/ui/PanelCard.crossFilter.test.tsx` — `findByRole("table")` (177, 187, 199, 292), `findByText` (241, 249, 293,
    302), `within(...).findByText` (392, 416).
  - `panels/ui/PanelFullscreenOverlay.test.tsx` — `findByRole("table")` (285, 292); also `findByText("hello world")`
    (118, 161), to be probed.
  - `panels/ui/PanelContent.test.tsx` — metric `findByText("--")` (106), table `findByRole("table")` (126),
    markdown `findByTestId("markdown-content")` (152, behind `MarkdownRenderer`'s own `React.lazy` of `MarkdownPanel`),
    table `findByText("Revenue")` (353), form `findByRole("form")` (426, gated on `fetchDatasetSchema`).
  - `PanelFullscreenOverlay.truncation` and `detailModal/PanelDetailModal.truncation` measured green under the `arm`
    stall (fired 5/5) — re-probe only.
- HEL-1596's method: busy-wait `STALL_MS` (Date.now loop) inside the mocked service's resolution microtask
  (`mockResolvedValue(v)` → `mockImplementation(() => Promise.resolve().then(() => { stall(); return v; }))`), i.e.
  after `findBy*` armed its 1 s timer and before React commits; >= 1000 ms fails the deadline wait.
- HEL-1600's network guard (`frontend/src/test/networkGuard.ts`) fails any unmocked request; it stays active.

## Goals / Non-Goals

**Goals:** every listed wait (and every other `findBy*` in the same files that races a mocked promise) settles its causal
promises inside `act` then queries synchronously; per-file red-before / green-after at the SAME injection point; an
inventory of every `findBy*` left in the touched files with its reason.

**Non-Goals:** timeouts, retries, product-code changes, files outside this list, the natural CI stall source.

## Decisions

**D1 — Helper: a sibling in the same module.** Export `settleMocks(...sources)` from `frontend/src/test/settleChartMount.ts`
(same `Source` type: a jest mock, whose every `mock.results[].value` is awaited, or a plain promise), body
`await act(async () => { await Promise.all(pending); })` with a why-comment. `settleChartMount` may delegate to the shared
collector, but its behavior (awaits sources, then the `ChartPanel` import, inside one `act`) must not change; HEL-1599's
15 files stay green. Rejected: a new file (two helpers sharing one `Source` type belong together); a generic
"flush all promises" (`setTimeout(0)` loops — reintroduces wall-clock/scheduling dependence and hides which promise gates
what). A lazy non-chart target (markdown) is settled by passing the lazy module promise explicitly, e.g.
`settleMocks(getOutputByIdMock, import("./MarkdownPanel"))` (path relative to the test file) — same registry module `React.lazy` loads.

**D2 — Chains settle in steps.** Where a request is issued only after a previous one resolved and React flushed
(meta → rows/history; panels → meta + rows), call the helper once per stage, as HEL-1599 did for
`PublicDashboardViewerPage.truncation` and `chartTruncation`. Never loop until something appears.

**D3 — Waits after a synchronous interaction.** A `findBy*` that follows `fireEvent`/`userEvent` on already-loaded content
(e.g. crossFilter Inspect `within(...).findByText`) is converted only if it is gated on a mocked promise; if it is gated
on nothing async (a sync state update), it becomes `getBy*` only if the probe and the clean runs show it needs no wait;
otherwise it is left and listed with its reason. `userEvent` awaits are not deadline waits and are untouched.

**D4 — Proof (systematic-debugging law; HEL-1596 method).** Per touched file, a scratch-only stall (never committed;
backup + restore, `git diff` clean afterwards; fired count recorded to a `STALL_FIRED` file):
- Injection point: the resolution microtask of the mocked service(s) the file's listed waits depend on
  (`getOutputById`, `fetchHistory`, `fetchPanels`/`fetchMeta`/`fetchRows`, `fetchDatasetSchema`), stalling on every
  resolution — the strongest form (HEL-1599 cycle 2 found once-per-process stalls hide later waits). If a mock is shared
  with chart waits already converted by HEL-1599, that is fine: they must stay green.
- BEFORE (main's file) and AFTER (converted file) use the identical scratch stall edit, `STALL_MS=1200`, N=5, whole file,
  plus `-t` for one listed test per file (N=3). Red before = a listed wait fails; green after = all tests pass with fired == N.
  A run where the stall did not fire is invalid.
- If a file is NOT red before at this point, also run HEL-1599's generic `arm` stall (scratch jest setup that stalls
  right after a `findBy*` arms its 1 s timer; reuse its described mechanism, scratch-only); record both. A file green
  under both is left unchanged with that reason (applies to the two re-probed truncation files).
- Secondary: HEL-1599's `arm` sweep on each converted file afterwards; any `findBy*` still firing is listed with reason.

**D5 — Clean and guard.** Each converted file: 10 cold-cache `CI=true` runs green. One scratch mutation per converted file
(rename a synchronous query target, or drop a settle call) turns it red — proves the sync query still asserts the real
target; recorded, never committed.

**D6 — Evidence.** `measurements.md` in this change: literal commands, cwd (this worktree's `frontend/`), env
(`CI=true`, `nice -n 19`, `--maxWorkers=1` single file, `--maxWorkers=3` folders/suite), cold `--cacheDirectory` per
probe, N, stall point, pass/fail, fired; one failure excerpt per file; inventory table of every `findBy*` in the touched
files (converted / left + reason); full-suite result on the final head.

## Risks / Trade-offs

- A wait gated on a promise no mock captures (an RTK thunk chain, `fetchOutputHistory`'s stub rejection) needs that
  promise passed explicitly; a rejected promise must not reject `Promise.all` — use the settled form for rejecting stubs
  (`allSettled` semantics) or pass only resolving sources. Executor decides per site; recorded.
- Converting more `findBy*` than strictly listed widens the diff; justified only where a probe shows the site red under
  the same stall (else the "green after" claim for the file would be false).

## Planner Notes

- Self-approved: test-only, `skip_specs: true`; helper sibling in the existing module.
- Concurrent lanes HEL-1610 (backend) and HEL-1598 (specs) and parked UI lanes touch none of these files (checked with
  `git diff --name-only` per branch at Setup).
