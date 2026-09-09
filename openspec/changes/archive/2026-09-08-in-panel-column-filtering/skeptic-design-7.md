## Skeptic Report — design gate (round 3, skeptic-design-7.md)

### What I verified (with evidence)

Note on the premise I was handed: "no implementation exists" is **false**.
`git diff --stat origin/main...HEAD` shows `DataGrid.tsx +296`, `DataGrid.css +258`,
`DataGrid.test.tsx +466` at `61cba49a`. Base `origin/main` is `95b6c619` as stated.
D10's line references are against this branch HEAD, which is the right frame of
reference; I checked them there.

**Line references in D10, all against HEAD (bare `:NNN` refs mix `DataGrid.tsx`
and `DataGrid.css`; I resolved each by content):**

| ref | claim | actual | ✓ |
| --- | --- | --- | --- |
| `DataGrid.tsx:402` | root is scroll container | `<div className={rootClasses} role="region" ... ref={scrollRef}>` | ✓ |
| `:267-297` | `stickyCellMaxWidth` state + effect | 267 `useState`, 297 dep array close | ✓ |
| `:376-388` / `:382` | un-filtered empty early-return | 376 `if (rows.length === 0 && !filtering)`, returns at 381 and 382 | ✓ |
| `:383` | `.ui-data-grid__empty-wrap` | tsx:383 | ✓ |
| `:554-559` | `.ui-data-grid__filter-row--columns` | tsx:554 | ✓ |
| CSS `:1-4` | `.ui-data-grid { overflow: auto }` | exact | ✓ |
| CSS `:36` | `--preview { max-height: 320px }` | exact | ✓ |
| CSS `:40-42` | `--full { width/height: 100% }` | exact | ✓ |
| CSS `:185-190` | `.ui-data-grid__filter-row th` | exact | ✓ |
| CSS `:274-279` | `.ui-data-grid__filter-toggle-row th` | exact | ✓ |
| CSS `:402-405` | `.ui-data-grid__empty-row` | exact | ✓ |
| CSS `:260-262` | `73a2dd0c` reset selector list | exact; the three removed cells only | ✓ |
| CSS `:16-30` | scroll-shadow modifiers | actually 16-28 (29-30 blank/comment) | ~ |
| `PanelContent.css:50-52` | `overflow-y: auto` | 49-52 selector+decl | ~ |
| `TableRenderer.tsx:444` | `.panel-content__disclosure` | 444 gate, 445 div | ~ |
| `StepCard.tsx:382`, `SourceDetailPanel.tsx:288`, `SqlTab.tsx:223` | 3 preview call sites | `grep -rn "<DataGrid"` returns exactly these + `TableRenderer.tsx:431` | ✓ |
| D10-9 test refs `:405 :421 :730 :749 :805 :840 :880 :915 :936 :948` | 9 invalidated + 1 surviving | every line is the `it(...)` the design describes; `:730` is indeed the full-shell guard, `:840` is indeed the mutation-failable offset guard | ✓ |

No line reference is wrong in a way that misleads. The three `~` rows are
off-by-one/off-by-two into adjacent blank lines.

**D10-7 (the priority question) — checked independently.**
- `.ui-data-grid { overflow: auto }` (`:1-4`) — confirmed.
- `--preview { max-height: 320px }` (`:36`) — confirmed; preview genuinely scrolls
  vertically.
- `--full { height: 100% }` (`:40-42`) — confirmed. `.panel-content` is
  `flex: 1; min-height: 0` (`PanelContent.css:1-8`) inside a column-flex panel body,
  so it has a resolved definite height; `.panel-content--table` adds
  `overflow-y: auto`. `.panel-content` is a **row** flex with `align-items: center`,
  so its child is not stretched — the child's height comes solely from
  `--full { height: 100% }`, which resolves against that definite height. Content
  taller than it overflows into `.ui-data-grid`'s own `overflow: auto`.

So on HEAD, for the `full` variant, `.ui-data-grid` **is** the sticky scrollport and
**does** scroll vertically. **D10-7's conclusion is correct on HEAD and round 2's
CR4 premise is refuted.** The draft-2 sentence it retracts ("no height cap, never
scrolls vertically") was indeed wrong.

**Correction to D10-7's reasoning:** its `--preview` bullet does no work for the
claim it is cited for. `stickyOffsets.columns` is only consumed when
`filterable && filterExpanded` (`DataGrid.tsx:530-568`), and filtering is
`full`-only by the design's own Non-goals. The preview variant's 320px cap is
therefore irrelevant to whether `stickyOffsets.columns` is consumed; the whole
liveness argument rests on the `--full { height: 100% }` bullet alone.

**The other five round-2 CRs — real fixes, not wording.**
- CR1 → D10-2: all three chrome elements now precede the scroll container; the
  "table is short" reasoning is explicitly withdrawn; the invariant is restated
  against `.panel-content--table`. Real, and D10-9(c) gives it a failable form.
- CR2 → D10-4: the three orphaned groups are named with correct line refs and
  token-expressed replacements required. Real.
- CR3 → D10-3: frame contract, four call sites, `className` routing,
  no-frame early return. Real — with one gap (CR1 below).
- CR5 → D10-9: nine tests enumerated, every line ref verified; `:840` correctly
  singled out as guarding retained machinery; three mutation-failable replacements.
  Real.
- CR6 → D10-6: names the two concrete unknowns (min-height, dangling header
  border) and adds the state to the light/dark list. Real.

### Verdict: REFUTE

One finding. It is the eighth assumption, and it is the reverse side of the very
claim I was asked to check hardest: D10-7 is right **about HEAD**, and D10 nowhere
carries that conclusion across the box-tree change D10 itself makes.

### Change Requests

1. **D10-7's liveness proof is evaluated against a box tree D10-2/D10-3 replaces,
   and `.ui-data-grid--full { width: 100%; height: 100% }` (`DataGrid.css:40-42`)
   — the single declaration the whole proof rests on — is addressed nowhere in
   D10.** It is not in D10-3's "stays on the scroll container" list
   (`border-radius`, `--scroll-left`/`--scroll-right`, `--full .ui-data-grid__table`),
   and it is not an "ancestor flex/height rule" that D10-3's general clause moves
   to the frame — it is the grid's own modifier.

   The consequence is mechanical: after the reframe the flex item of
   `.panel-content--table` is `.ui-data-grid__frame`, not `.ui-data-grid`. Unless
   the frame is itself given a definite height, `height: 100%` on the grid resolves
   against an auto-height frame and computes to `auto`. The grid then never
   overflows vertically, `.panel-content--table` becomes the vertical scroller for
   the entire table, `position: sticky` on the header row and the retained
   per-column filter row stops engaging, and `stickyOffsets.columns` becomes exactly
   the inert number round 2's CR4 hypothesised — reached by a different route, and
   with D10-7 now asserting it cannot happen.

   Required in the design, not deferred to implementation:
   (a) state what happens to `.ui-data-grid--full`'s `height: 100%` / `width: 100%`
       — the natural shape is `.ui-data-grid__frame` becoming the `full`-variant flex
       item (`height: 100%`, `display: flex; flex-direction: column`,
       `min-height: 0`, `min-width: 0`) with `.ui-data-grid` becoming
       `flex: 1; min-height: 0` instead of `height: 100%`, but pick one and say it;
   (b) note that `.panel-content`'s `align-items: center` means the frame is **not**
       stretched, so an omitted frame height also vertically centres a short table —
       a visible regression distinct from the sticky one;
   (c) restate D10-7's conclusion against the **post-reframe** tree, and make its
       required live measurement (panel and modal) explicitly a measurement of the
       reframed DOM, not of HEAD;
   (d) reflect the same in `tasks.md` in this pass, per D4c.

### Non-blocking notes

- D10-7's `--preview` bullet should be struck or relabelled: preview is never
  `filterable`, so it cannot support the claim about `stickyOffsets.columns`. The
  `--full` bullet is the whole argument and reads stronger alone.
- D10-5 deletes `stickyOffsets.toggle`, `.quick` and `toggleRowRef` but omits
  `quickRowRef` (`DataGrid.tsx:265`), which is equally dead once the quick-filter
  row leaves the table. Also worth naming `scrollRef`'s removal from the
  `useLayoutEffect` dep list (`:297`) — it is there only for `viewportWidth`.
- D10-4's "state explicitly whether the chrome responds to density" and D10-6's
  "specify its rendered appearance" both defer a decision to implementation. Both
  are bounded and low-risk, so not blocking, but they are the last two open
  decisions in D10.
- D10-2's ordering places the filtered-empty message **above** the column headers
  and the per-column filter inputs it refers to. That is a deliberate consequence of
  the invariant, not a defect, but it is a visual arrangement no reviewer has seen
  yet — worth an explicit screenshot in the light/dark verification list alongside
  D10-6's empty `<tbody>`.
