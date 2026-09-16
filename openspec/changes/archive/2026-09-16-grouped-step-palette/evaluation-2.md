## Evaluation Report — Cycle 2 (evaluation-2.md)

Diff base: `abe2a8fae1c827976aedf696bfaa0416b210d92c` (resolved live via
`scripts/concertino/resolve-review-base.sh`). Reviewed commit (HEAD):
`3fea4951251d272f41601cd0ffc77c7d4a22d546` (previous cycle: `26618422460c2146589a8f6f9bd3650576d36d42`).
Tree clean. Scope: the 6 changed files since cycle 1 (StepPalette.tsx/test, PipelineRiverView.tsx/test,
BranchAffordance.tsx, PipelineStepRegistryCatalogSpec.scala) and anything they could have broken.
Phase 1 (spec) and Phase 3 (UI, broad) both passed cycle 1 and are not re-litigated wholesale; the
backend catalog/companion declarations are untouched this cycle.

### CR1 (cycle 1) — VERIFIED FIXED, with independent live + provable-test evidence

All four render sites now pass a real boolean instead of conditionally mounting: confirmed by
reading the diff — `open={insertDropdownAt === index}` (gap, inside `renderGap`), `open={dropdownOpen}`
(both empty-state and bottom-row append sites), `open={isOpen}` (`BranchAffordance.tsx`). `StepPalette`
and `Modal` are now permanently mounted at each site; only their `open` prop toggles.

**Live verification, both critical sites, both themes** (gap-insert control and the bottom-row "+ Add
transformation step" control — the two the driver asked me to press on):
- Light theme, gap-insert: opened via a real click on the gap button, pressed Escape,
  `document.activeElement === document.querySelector('.pipeline-detail-page__gap-insert-btn')` →
  `true`, dialog closed. Evidence:
  `.concertino/runs/HEL-1136/evidence/.playwright-mcp/cycle2-gap-light.png` (palette open,
  pre-Escape).
- Light theme, bottom-row: same pattern, `document.activeElement.textContent === "+ Add transformation step"`
  after Escape → confirmed.
- Dark theme: both sites re-verified identically after `localStorage.setItem('helio-theme','dark')`
  + reload — both restore focus correctly.
- No console errors in any of the four checks (`browser_console_messages` level=error → 0).

**Regression test provably red, verified by mutation (not accepted on the report's claim alone):**
`PipelineRiverView.test.tsx`'s new test `"pressing Escape closes the gap palette and restores focus
to the gap button that opened it"` — I reverted `renderGap`'s call site back to the cycle-1
conditional-mount form (`{insertDropdownAt === index && <StepPalette open ... />}`) in a scratch
edit, re-ran `npx jest --testPathPatterns=PipelineRiverView`, and it failed exactly as expected
(`expect(triggerButton).toHaveFocus()` — received `<body>` focused instead), 1 failed / 35 passed.
Restored the file byte-identical afterward (`git diff --stat` empty). This is a real, provably
failable regression test for the CR1 fix — not the CR2 problem relocated.

**(a) Per-mount cost of N always-mounted closed Modals — confirmed cheap, matches the report's own
claim.** Re-read `StepPalette.tsx`'s data-fetch effect: `useEffect(() => { if (!open) return; ...},
[open, fetchNonce])` — a closed instance issues no catalog request, confirmed by direct inspection
(unchanged from cycle 1). `Modal.tsx`'s `[open]` effect's `else` branch (`dialog.close()` — already
closed, no-op; `previouslyFocusedRef.current?.focus()` — `null` on a never-opened instance, no-op)
is the only other per-render work; both are trivially cheap. Live: on `proj-2026-flat` (1 step, 1
gap, 1 branch affordance, 2 append sites) the page carried 8 `<dialog>` elements total, only 1 ever
`[open]` at a time.

**(b) Always-mounted closed Modal inertness — confirmed via direct DOM inspection.** All 8
`<dialog>` elements without the `open` attribute report `getComputedStyle(d).display === 'none'`
(native `dialog:not([open]) { display: none; }` UA rule) and none expose a focusable descendant —
confirmed programmatically, not merely asserted: `closedDisplayNone: true`, `anyFocusableVisibleClosed:
false`. Only one dialog is ever open at a time (unchanged pre-existing XOR state management via
`closeDropdown()`/`openGapDropdown()`), so no stray closed dialog can capture Escape from behind an
open one.

CR1: **RESOLVED.**

### CR2 (cycle 1) — VERIFIED FIXED, with independent mutation-proof

`findUngroupedEntriesInGroups` is exported as a pure function over `ResultGroup[]` (the seam), and
`ungroupedEntriesInACategory` is now a two-line wrapper (`buildGroups` → `findUngroupedEntriesInGroups`)
with no other change — confirmed via the cycle-to-cycle diff of `StepPalette.tsx`: the only edits are
the export of `ResultRow`/`ResultGroup`, the extraction, and the wrapper; `buildGroups` itself and
`missingFromAllView` are byte-identical to cycle 1. This is genuinely behavior-neutral.

Both rewritten task-6.2 tests were independently red-proofed by me (not accepted on the executor's
"stubbed and confirmed" claim):
- `missingFromAllView`'s test now keeps `"select"` present in `catalog.steps` with a `group` id
  (`"no-such-group"`) that matches nothing in `catalog.groups` — a real dangling-reference case,
  unlike cycle 1's vacuous "delete the entry from the input" version. I stubbed
  `missingFromAllView` to `return []` in a scratch edit and re-ran the suite: the test failed exactly
  as expected (`Expected ["select"], Received []`). Restored byte-identical afterward.
- `findUngroupedEntriesInGroups`'s test constructs a hand-built `ResultGroup[]` placing the `assert`
  fixture entry (genuinely `group === undefined`) inside a `label: "Filter & shape"` section — this
  bypasses `buildGroups` entirely, which is what makes it able to observe a regression in the
  bucketing logic itself. I stubbed `findUngroupedEntriesInGroups` to `return []` and re-ran: failed
  exactly as expected (`Expected ["assert"], Received []`). Restored byte-identical afterward.

CR2: **RESOLVED**, and its evidence now meets the bar the ticket asked for.

### CR2's open finding — ruling: not required, ACCEPT as non-blocking

The dangling-group-id gap (`buildGroups`'s grouped branch silently drops an authorable entry whose
`group` id matches nothing in `catalog.groups`, in the no-filter view only) is real, and I agree
with the driver's position: it does **not** need a fix in this cycle.

Reasoning:
1. Owner ruling 2 governs the **absent**-group case (`entry.group === undefined`), and that path is
   correct — verified in cycle 1 and unchanged: the wire type is `group?: string`, the fixture
   omits the key rather than nulling it, and `entry.group === undefined` is the sole predicate
   `buildGroups`/`findUngroupedEntriesInGroups` both key off. The dangling-id case is a *different*,
   narrower condition (a **defined-but-unrecognized** id) that the owner ruling never speaks to.
2. It is unreachable through the real API today: `PipelineStepCatalogService.catalog()` derives
   both `catalog.groups` (`StepGroup.All`) and each entry's `group` (`companion.group.map(_.id)`)
   from the same `StepGroup` sealed ADT — I re-confirmed this by re-reading
   `PipelineStepCatalogService.scala` this cycle (unchanged) — so a mismatch would require the two
   to drift apart, which the current code gives no path to.
3. The AC this whole check exists to satisfy — *"A test goes red if a registered op is missing from
   All"* — is satisfied: `missingFromAllView`'s new test demonstrates exactly that, for exactly this
   failure mode (an entry present in the catalog but unreachable from "All").
4. The executor's own code comment documents the gap explicitly, with the exact mechanism and the
   exact scope (no-filter view only; still visible while filtering) — this is disclosed
   defense-in-depth, not a silently-accepted risk.

Ruling: **acceptable as shipped; the one-line robustness fix (treat an unrecognized group id like
absent) is a non-blocking suggestion, not a change request.** Given this is cycle 2 of 3, spending
the last cycle on this would not be a good trade against a real finding.

### Backend trim — CONFIRMED, no real coverage lost

`PipelineStepRegistryCatalogSpec`'s retitled block removes exactly the two tautological assertions
I flagged non-blocking in cycle 1 (`classified.keySet shouldBe kinds`, which can never fail since
`classified` is derived from the same `Registry` the assertion compares against; and the fake-kind
test, which only asserted default values with no guard logic exercised) and keeps one real assertion
(`Companion`'s defaults are safe for an undeclared kind). Net: 2 `it` blocks removed, 1 added = -1,
exactly matching the reported 4562 → 4561 (confirmed by my own fresh full `sbt test` run this
cycle, not accepted from the report — see Gates below). `PipelineStepCatalogServiceSpec` — the file
holding the actual, genuinely-failable `catalog.steps.map(_.kind).toSet shouldBe
PipelineStep.Registry.keySet` guard — is byte-identical to cycle 1 (empty diff), so the real
coverage-equals-registry guard for task 6.1 remains present and failable.

### Gates (fresh, this cycle — not the executor's reported numbers)

- `npm run lint` — clean.
- `npm run format:check` — clean.
- `npm run typecheck` — clean.
- `npm test` (full suite) — **3456/3456 passed**, 321 suites — matches the executor's report.
- `npm --prefix frontend run build` — clean production build.
- `cd backend && sbt test` (full suite) — **4561/4561 passed**, 308 suites — matches the executor's
  report and the arithmetic above.
- Targeted backend re-run (`PipelineStepRegistryCatalogSpec`, `PipelineStepCatalogServiceSpec`,
  `PipelineStepCatalogProtocolSpec`, `PipelineStepCatalogRoutesSpec`, `ApiRoutesSpec`,
  `StepGroupSpec`) — 190/190, isolated confirmation the trim didn't disturb sibling specs.
- e2e: ran the 5 non-quarantined pipeline-editor specs (`hel908-trunk-reorder-order`,
  `hel908-trunk-reorder-drag`, `hel908-step-card-split`, `hel910-pipeline-to-dashboard-flow` ×2) —
  **5/5 passed**. `hel908-tail-attach`, `hel908-full-flow`, `hel968-multi-root-editor-flow`, and
  `hel912-lanes-rejoin` are all in `playwright.config.ts`'s quarantine list for pre-existing,
  unrelated reasons (HEL-951/964/991/992) — confirmed by reading the quarantine comments directly,
  not assumed; `hel912-lanes-rejoin.spec.ts` is explicitly named (line 120, "one file only") under
  its HEL-992 quarantine, so its known flake never had a chance to fire this cycle.

### Overall: PASS

Both cycle-1 change requests are resolved with independently-verified, provably-failable evidence
(not merely accepted on the executor's word). CR2's open finding is ruled acceptable as
defense-in-debt, disclosed and non-blocking. The backend test-count trim is arithmetically and
substantively confirmed to have removed no real coverage. All gates re-run fresh and green,
matching the executor's reported numbers exactly.

### Change Requests

None.

### Non-blocking Suggestions

- (Carried from cycle 1, still open, not required) Consider the one-line robustness fix in
  `buildGroups`'s grouped branch — treat an authorable entry whose declared `group` id matches
  nothing in `catalog.groups` the same as an absent group (route it to the header-less bucket)
  rather than silently dropping it from the no-filter view. Currently unreachable through the real
  API and already caught by `missingFromAllView`'s failable check if it ever did occur, so this is
  pure defense-in-depth, not required for this ticket.
- `ShapePickerModal` (flagged cycle 1) still appears to share the pre-CR1 conditional-mount pattern
  and likely has the same latent Escape/focus-restore gap — worth a follow-up ticket, out of scope
  for HEL-1136.
