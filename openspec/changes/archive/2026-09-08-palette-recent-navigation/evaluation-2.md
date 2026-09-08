## Evaluation Report — Cycle 2 (evaluation-2.md)

Scope: delta `26b520ec..d5007858` (CR1 fix) plus anything it plausibly broke. Cycle-1 findings on
`22338656` are unchanged and not re-litigated except where the delta touches them.

Delta contents: `frontend/src/features/commandPalette/ui/CommandPalette.test.tsx` (the only code
file), plus `evaluation-1.md` and `files-modified.md`. **No product code changed** — so cycle-1's
Phase 3 UI review, e2e evidence, and design/token findings carry forward by construction, not by
assumption. I re-ran the e2e anyway (below).

### Content self-authentication

`curl http://localhost:5951/src/…/recentHistoryStore.ts | grep -c RECENT_HISTORY_STORAGE_KEY` → 3.
Port 5951 still serves THIS branch. (No new visual observation was required this cycle; the check
is recorded because the e2e run below drives that server.)

### Phase 1: Spec Review — PASS

No spec, task, or scope change in the delta. tasks.md still 28/28; `files-modified.md` gained an
accurate Cycle-2 section.

### Phase 2: Code Review — PASS

Gates re-run by me, from `frontend/`:

| Gate | Result |
|---|---|
| `npm run lint` | PASS, 0 warnings |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 285 suites / 2892 tests, incl. `motionTokenGuard.css.test.ts` (green) |
| `DEV_PORT=5951 BACKEND_PORT=8858 npx playwright test e2e/hel519-recent-navigation.spec.ts` | **7/7 passed (22.1s)** |

Test count is unchanged at 2892 — consistent with a fixed test rather than an added one.

#### CR1 — VERIFIED FIXED, by my own mutation run (not by accepting the report)

Mutation: `CommandPalette.tsx:112`, `if (query.trim() === "" && recentActions.length > 0)` →
`if (recentActions.length > 0)`.

- Mutated → **1 failed, 12 passed**; the failure is the CR1 test itself.
- Restored → **13 passed**.

Both observed directly. The executor's claim is true. The fix is the right one: it addresses the
real cause (`sources.items` now contains `{ id: "s1", name: "My Source" }`, so `resolveTitle`
resolves and a recent row genuinely renders) and adds a **sanity precondition**
(`getByRole("option", { name: "My Source" })` present BEFORE typing) — which is what converts the
post-typing assertion from "an empty list stayed empty" into a real exclusion claim. The added
`expect(getDialog()).toHaveAttribute("open")` and `queryByText("My Source")` negative are both
load-bearing.

WHAT IT PROVES: a recent entry that resolves to a real, rendered, on-screen row is excluded once
the query is non-empty. WHAT IT CANNOT: anything about scoring/ordering when a query textually
matches a recent's title (no registered action shares a name with "My Source") — the executor's own
comment says this, correctly.

#### THE SIBLING-DEFECT QUESTION — answered: **exactly ONE test, and it is NOT file-wide**

The orchestrator's inference from the executor's phrasing was the right one to chase, but the scope
is one test, because **the shared `renderPalette()` helper already mounts `GlobalCommandShortcuts`**
(`CommandPalette.test.tsx:52`). Counting the file's 13 `it(` blocks:

- **11** call `renderPalette(...)` → palette genuinely opens.
- **1** is the CR1 test just fixed → now mounts `GlobalCommandShortcuts` inline and asserts `open`.
- **1** hand-rolls its own render tree WITHOUT `GlobalCommandShortcuts`:
  **`"prepends Recent AND still renders the pre-existing sections on an empty query"`
  (line 256)** — the sibling the executor's phrasing implied.

**Direct probe, not inference.** I inserted `expect(getDialog()).toHaveAttribute("open")` into that
test: **RED** (`Received: null` at line 299). Its `await screen.findByLabelText("Search commands")`
is therefore a vacuous precondition — it resolves because `Modal` renders its children into the DOM
unconditionally (`<dialog>`'s `open` is an attribute, not a mount condition), exactly as described.

*(Methodological note, and an instance of the very hazard under review: my FIRST attempt at this
probe used a `perl` substitution whose pattern did not match, so the file was unchanged and the run
came back "13 passed" — a green result that proved nothing. I only caught it because I re-ran with
an assertion on the patch itself. The same class of silent no-op is what produced CR1.)*

**Is it genuinely vacuous, or incidentally fine? — Incidentally fine. It does NOT block.** I
mutated the code it claims to cover, twice:

1. `CommandPalette.tsx:113` prepend → replace (`return [...recentActions, ...ranked]` →
   `return [...recentActions]`) → **RED, and the failing test is precisely this one**
   (`● CommandPalette — Recent section (HEL-519) › prepends Recent AND still renders the
   pre-existing sections on an empty query`).
2. `builtInActions.ts` — removed `RECENT_SECTION` from `SECTION_DISPLAY_ORDER` (recents would sort
   last instead of leading) → **RED, 1 failed**.

So it discriminates on both halves of what it claims — prepend-not-replace, and Recent-leads. It
survives never opening only because the palette's result computation does not depend on `isOpen`,
and `query` is `""` by default anyway.

**Residual risk, non-blocking:** the test is one line away from becoming vacuous again. Its
"on an empty query" framing is true by default rather than by the open-reset effect actually
running, and anyone who later adds a `getByRole` assertion to it gets a confusing "found nothing"
rather than a meaningful failure. Fix is one line (mount `GlobalCommandShortcuts`, or just switch to
the `renderPalette()` helper). Recorded as a suggestion, not a change request — it asserts truthfully
today and I confirmed that by mutation.

**Not a file-wide problem, so nothing to escalate as separate work.** The one structural weakness in
this file is that `getByText`/`querySelector` assertions cannot tell an open palette from a closed
one — but only one test is exposed to it, and that test is correct. If you want a hardening ticket
anyway, the useful shape is "make `getDialog()`'s `open` attribute an explicit precondition in every
palette test that asserts on rendered content", which is small and mechanical. I would not hold
HEL-519 for it.

Nothing else in the delta regressed: no product code, no new `any`, no dead code, comment accurately
describes what the test now proves and cannot prove.

### Phase 3: UI Review — PASS (carried forward, delta is test-only)

`git diff 26b520ec..d5007858 --name-only` touches one `.test.tsx` and two markdown files. No
component, style, token, or route change exists in the delta, so cycle-1's browser observations
(Recent leading Navigation/General/Create in light and dark, hover + keyboard-focus parity, 0
console errors, no overflow at 1440/1100/768/360) remain the current state of the running app. The
7/7 e2e re-run above re-confirms the live behavior against that same dev server.

Cohesion remains **escalated to the skeptic, not ruled here** — unchanged from cycle 1.

### Two-axes question (cycle-2 delta)

- **What no source text carries**: whether a jsdom test's palette is actually *open*. `Modal`'s
  unconditional child rendering makes "open" invisible to grep, types, lint, and to any
  text/selector-based assertion. Only an explicit `open`-attribute probe distinguishes them — which
  is how both CR1 and its sibling were found, and neither would ever have surfaced from reading.
- **What path the gates did not exercise**: still the cycle-1 answer — the palette on `/` with a
  sibling kind's list not yet fetched (storage retains the entry; the row is omitted until the list
  loads). Unchanged by this delta and still worth a follow-up ticket rather than an inline fix.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

(Carried from evaluation-1.md, still open and still non-blocking: the `recentVisitsListeners.ts:57-59`
comment that misdescribes its own test; `page: any`/`request: any` in
`e2e/hel519-screenshots.spec.ts:7,22`; and a follow-up ticket for the `/`-route
not-yet-loaded-list observation.)

- `CommandPalette.test.tsx:256` — mount `GlobalCommandShortcuts` (or use the `renderPalette()`
  helper) so this test's palette genuinely opens, and assert `expect(getDialog()).toHaveAttribute("open")`.
  It asserts truthfully today (proven by two mutations above), but its `findByLabelText`
  precondition currently passes vacuously and the next assertion added to it may not.
