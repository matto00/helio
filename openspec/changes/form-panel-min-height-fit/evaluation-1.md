## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `cc57565319fee4d8b521966143296c10f086804e`, base `cba523c030821c709ba227ab8c06a59f9ab913fc` (resolved live by
`resolve-review-base.sh`). Spawn guard: `READY ambient=/home/matt/Development/helio branch=bug/form-panel-min-height-clip/HEL-1618`.
Lane constraints (`.concertino/scratch/HEL-1618/lane-constraints.md`) followed: no `.env` read, servers only via
`start-servers.sh` (lane DB `helio_hel1618`, `DB_USER=$USER`, empty `ANTHROPIC_API_KEY`) and stopped via `stop-servers.sh`
(`STOPPED ports=7050,9957`), jest 3 workers, Playwright 2 workers, scratch output in `.concertino/scratch/HEL-1618/eval1/`.

### Phase 1: Spec Review — FAIL

| check | result |
| --- | --- |
| AC1 (2-field form shows Submit at minimum, or grid stops it) | PASS. The grid stops a multi-field form at 5 rows; at 5 rows a 2-field form hides 0 px (re-measured, below) |
| AC2 (measured live at 1280, both themes, before and after) | PASS (`measurements.md` §3 and §4.6; my own re-measure matches to the pixel) |
| AC3 (split, no behaviour change, equal counts) | PASS (verified independently, below) |
| AC4 (non-owner stale error cleared, test fails first) | PASS (`d2-red.txt` committed in 228e04ca8 before the implementation in c19eecd9a; I reproduced the mutation) |
| ACs not reinterpreted | PASS. Owner rulings min-height-5-rows (counter 4, no bump or save on load) and lift-when-free are implemented as ruled |
| Tasks all done and match | PASS |
| Scope creep | none. Frontend `ui/form/**` and `ui/grid/**`, one new e2e spec, change artifacts |
| Regressions | none found: full jest suite green, 7 form e2e specs green |
| API/schema | not affected (no API change) |
| Planning artifacts reflect the implemented behaviour | **FAIL**, see CR1 |
| CONSTRAINTS C1-C5 honoured | C2-C5 yes. C1 mostly: see the C12 evidence chain below (e2e red committed with the implementation) |

**Issue (CR1): the spec delta claims a guarantee the system does not hold.**
`specs/form-panel-rendering/spec.md:8` says "On the desktop grid, at every breakpoint, a `form` panel SHALL NOT be
placed or resized to fewer than 5 rows". The executor's own enumeration (`measurements.md` §4.4) found two placement
paths that do place a form below 5 rows, and I confirmed both:
- Proposal/assistant apply: `ProposalLayoutSupport.scala:38` copies the proposal's `l.h` verbatim. `LayoutValidator`
  only requires `h >= 1`, and `dashboard-proposal.schema.json:34` allows `"form"` panels. So an applied proposal can
  place a form at h=1 to h=4.
- Dashboard import: copies each item's h verbatim.

When the change is archived, the spec text becomes a canonical claim that is false.

**Scope ruling (asked by the orchestrator):** both backend paths are **follow-ups, not in scope here.**
- The ticket and proposal are frontend-only.
- Design D4 says explicitly that "a backend path that does so is reported, not silently changed".
- Import is arguably consistent with the owner's "a saved form stays as saved" ruling, because the file carries a saved
  layout.
- Proposal apply is a genuine new placement below 5, so it should get its own follow-up ticket (clamp `form` h to
  `max(h, 5)` unless it is a compact counter, mirroring `PanelPacker`). Whether import should also clamp is an owner
  call for that follow-up.

The only change needed in this ticket is to make the spec say what is true.

#### C12 evidence chain

- **Before-counts:** committed first, in 2aefa940d (`measurements.md` only), before the split in 3ddb446c0. OK.
- **Split behaviour-preserving:** 3ddb446c0 touches no test or e2e file (`git diff --stat cba523c03 3ddb446c0 -- '*.test.*' e2e`
  is empty). I re-ran the 9 D1 jest files myself in a throwaway detached worktree: **149/149 at cba523c03 and 149/149 at
  3ddb446c0** (equal). A line-set comparison of the old `FormPanelView.tsx` against the four post-split files leaves
  only 7 non-identical lines: reshaped imports, `handleImmediateStep` renamed to `step`, and `busy` and
  `aria-disabled` passed as props (`submitPending`). No logic changed. I did not re-run the before/after e2e counts.
  The final e2e run below matches the recorded per-file counts for the 6 proof-set specs I ran.
- **D2 red:** `evidence/d2-red.txt` (1 failed / 14 passed, the red-first test) was committed in 228e04ca8, BEFORE the
  implementation in c19eecd9a. The test file itself landed with the implementation, because the hook refuses a red
  jest commit, as C12 allows.
- **Group 4 jest red:** `evidence/g4-red.txt` was committed in 49d48b5e8, BEFORE the implementation in cc5756531. OK.
- **Group 4 e2e red:** `evidence/g4-e2e-red.txt` was committed IN the implementation commit cc5756531, not before it,
  so commit order does not prove it predates the implementation. Its content is self-consistent with the unchanged
  grid: 2 failed (min stop, lift) with "Expected: 308, Received: 244", and the 2 guards passed. This is a procedural
  deviation from C12's letter (non-blocking note N1). The jest layer's red-first order is intact.
- **Mutations:** I read every `g4-mutation-*.txt` / `d2-mutation-*.txt`; each shows the named test(s) red. I
  **reproduced 5 of them myself** in a throwaway worktree. The baseline was 35/35 green first.
  1. Skeptic fold-in 1 on-load bump (`createLayouts` emits `Math.max(item.h, FORM_MIN_ROWS)` for non-counter forms):
     the GUARD "a saved 4-row form renders at 4 and loading it saves nothing" goes red (1 failed / 9).
  2. `clearCommitFlag` no longer clears `resizedIdRef` (fold-in 2): "a resize that ends where it started, then a drag
     of another panel, does not lift the form" goes red (1 failed / 9).
  3. Lift without the free check: blocked-neighbour, kept-item and helper cases go red (3 failed / 20).
  4. The free check over loaded items only, kept appended after (fold-in 4): the kept-item case goes red (1 failed / 9).
  5. D2: the non-owner clear callback replaced with a no-op: "clears an earlier burst's rejection error when a later
     step gets no response" goes red (1 failed / 15).

  Outputs: `/home/matt/Development/helio/.concertino/scratch/HEL-1618/eval1/m{0..5}-*.txt`.

#### Skeptic-design-5 binding fold-ins (each checked)

1. **Replace the inert GUARD mutation. Honoured.** `measurements.md` §4.5 uses `Math.max(item.h, FORM_MIN_ROWS)`,
   records the red result (`g4-mutation-max.txt`), and records the pending flag result
   (`g4-mutation-max-pending-probe.txt`: rendered h 5, pending undefined, with the stated reason). I reproduced the red.
2. **Bound the resized-id ref lifetime. Honoured.**
   - `useCommitFlag.ts:22` clears `resizedIdRef` in `clearCommitFlag`. That function runs from the committed branch,
     `handleDragStart`, `handleResizeStart`, `armCommitFlag` and the zero-delay timer.
   - `handleResizeStop` sets the id after arming (`useGridLayoutInteraction.ts:98`).
   - The jest case named by the skeptic exists (`DesktopPanelGrid.formMinRows.test.tsx:243`), and removing the clear
     turns it red (reproduced).
3. **Lift before `markLayoutChanged`, gated on the flag and a held id. Honoured.** At
   `useGridLayoutInteraction.ts:120-128` the lifted `next` is computed before `markLayoutChanged(next)` and gated on
   `commitOnNextLayoutChangeRef.current ? resizedIdRef.current : null`. The same object reaches `markLayoutChanged`,
   `commitInteractionLayout` and the store dispatch. The non-committing-tick test asserts that no lift happens. The
   separate-write mutation is recorded red (`g4-mutation-separate.txt`).
4. **`isSpaceBelowFree` over the full stored breakpoint. Honoured.** The lift runs on `changed[bp]` (`[...items, ...kept]`).
   The kept (unloaded) item case exists (`DesktopPanelGrid.formMinRows.test.tsx:219`). My loaded-only mutation turns it
   red.

Skeptic non-blocking notes:
- **The RGL echo after a lifted commit:** settled by the e2e lift test, which I ran green. It checks one PATCH with
  h=5, the card still 5 rows after 1.2 s, no "Save now", no second PATCH, and 5 rows after a reload.
- **One shared compact-counter predicate:** done (`ui/form/compactCounter.ts`, used by `FormPanelView` and
  `panelGridConfig`). A zero-field form is 5, matching `PanelPacker`.

### Phase 2: Code Review — PASS

Gates, run by me in WORKTREE_PATH at the reviewed HEAD:
- `npm run lint`: exit 0 (zero warnings).
- `npm run format:check`: "All matched files use Prettier code style!"
- `npm run typecheck`: exit 0.
- `npm test`: root 73 suites / 645 tests passed; frontend 922 suites / 10628 tests passed.
- `npm --prefix frontend run build`: exit 0.

No backend files changed, so `sbt testFull` was not required.

Review:
- **CONTRIBUTING [mechanical] rules:** every touched file is under 400 lines (`FormPanelView.tsx` 278,
  `useCompactCounterSubmit.ts` 206, `panelGridConfig.ts` 212, `useGridLayoutInteraction.ts` 161,
  `DesktopPanelGrid.tsx` 274). No inline FQNs. The `import("react").ReactNode` inside a `jest.mock` factory follows the
  existing pattern in 5 sibling grid tests. No TODO/FIXME, and no dead imports (lint is clean).
- **DESIGN [mechanical] rules:** no CSS or token change. The short-card rhythm is unchanged (`DesktopPanelGrid.tsx`).
- **Type safety:** typed `ResizeStopHandler`, with no `any`.
- **Modularity:** pure helpers (`panelMinRows`, `isSpaceBelowFree`, `liftResizedForm`) with direct unit tests.
  `createLayouts` takes an injectable lookup with a default, so `DesktopPanelGridSkeleton` is untouched.
- **Tests are meaningful:** each new branch has a failable test (mutations above).
- **Behaviour-preserving split:** verified (Phase 1).

### Phase 3: UI Review — PASS

Dev servers came up via `start-servers.sh` on 7050/9957 (`PASS servers`). The shared MCP browser was checked: no open
dialog, page on port 7050. Viewport was 1280 x 1100, the grid container 928 px (`sm`, 6 cols), Comfortable density. I
used a throwaway user with 4 form panels seeded at lg+sm. The user was deleted afterwards via `buildUserDeleteSql` by
exact id (count 0 after).

Measured in **both themes**; the results are identical:

| panel | panel h | clientHeight / scrollHeight | hidden | Submit fully visible |
| --- | --- | --- | --- | --- |
| 2 fields at 5 rows | 308 | 205 / 205 | 0 | yes |
| saved 4-row 2-field form (not bumped) | 244 | 165 / 186 | 21 | no (by owner ruling) |
| compact counter at 4 rows | 244 | 165 / 165 | 0 | n/a (+/- visible) |
| 3 fields at 5 rows | 308 | 205 / 253 | 48 | no (outside AC, documented) |

- After load, no "Save now" appeared (no bump, nothing pending).
- The console had 0 errors and 0 warnings.
- These numbers match `measurements.md` §4.6 exactly.
- Screenshots:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1618/evidence/eval1-1280-dark.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1618/evidence/eval1-1280-light.png`

  Both were written directly into the durable runs evidence dir, not the worktree.

I ran these e2e specs myself (`--project=dev --workers=2`, DEV_PORT=7050): `hel1618-form-min-rows`, `hel1087`,
`hel1784`, `hel1791`, `hel1818`, `hel1819`, `hel1088`. Result: **30 passed**, 0 failed. Per-file counts match the
recorded baseline: 4/4/7/6/4/4/1.
- The new spec drives real resize handles: the min stop at 5, the counter at 4, the no-bump guard, lift-when-free
  persisted once, and a blocked neighbour that stays at 4.
- `hel1791`/`hel1819` cover the 390/768/1100 stack and grid widths, which together with the unit coverage of all four
  breakpoints in `createLayouts` covers the breakpoint check. I did not resize the MCP page to 1440/768/0 by hand.
- No new interactive elements, so accessible names and keyboard support are unchanged.

### Overall: FAIL

### Change Requests

1. **`openspec/changes/form-panel-min-height-fit/specs/form-panel-rendering/spec.md:8-12`: make the placement sentence
   true.** Replace "On the desktop grid, at every breakpoint, a `form` panel SHALL NOT be placed or resized to fewer
   than 5 rows" with wording that limits the guarantee to the paths this change enforces. For example:

   > On the desktop grid, at every breakpoint, a `form` panel SHALL NOT be resized to fewer than 5 rows, and the
   > web client's own placement paths (create, duplicate, the unplaced-panel fallback, auto-layout) SHALL place it at
   > 5 rows or more ... A layout supplied by a dashboard import or an applied proposal keeps the heights it carries.

   Keep the existing scenarios. Then, in the PR body, ask the orchestrator to file a Follow-up for the backend
   proposal-apply path. Optionally add import to it, as an owner call. The follow-up would clamp a non-counter `form`
   to h >= 5 in `ProposalLayoutSupport` (`ProposalLayoutSupport.scala:38`), mirroring `PanelPacker`'s `Form minH = 5`.
   This is a documentation-only fix: no code or test change, and no re-measurement.

### Non-blocking Suggestions

- **N1 (C12 procedure):** `evidence/g4-e2e-red.txt` was committed in the implementation commit cc5756531 rather than
  before it. Its content is consistent with a real red (Expected 308 / Received 244 on the two non-guard tests), and
  the jest red-first order is intact. Record e2e red runs in their own commit next time.
- **N2 (DRY):** `useCompactCounterSubmit.ts` now passes two byte-identical closures
  (`() => { if (!burstRejectedRef.current) values.setExternalErrors({}); }`) as the owner's `onReconciled` and the
  non-owner's `onQuiescedWithoutReconcile`. Hoist one named `clearStaleErrorUnlessRejected` and pass it twice. The
  callbacks stay separate, as D2 intends.
- **N3:** `measurements.md` §4.6 already records that D4's "~24 px" prediction for a 3-field form was wrong (48 px
  measured, because the short-card rhythm drops at 5 rows). Consider updating design.md D4's sentence in the same pass
  as CR1, so the archived design does not keep the false number.
