## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/data-grid/spec.md` in full
  from the current worktree (not from the orchestrator's summary).
- `grep -rn "HEL-520\|unwindowed" openspec/changes/virtualize-table-rows/`. Every surviving
  hit outside the historical `skeptic-design-1.md`/`-2.md` reports is now either an explicit
  *negation* of the false citation or a legitimate windowed-vs-unwindowed equivalence
  statement:
  - `ticket.md:40` — "found NOT to touch `DataGrid.tsx` at all … do not cite it".
  - `design.md:6-11` — "**HEL-520 (`7a14601f`) does NOT touch this surface**".
  - `tasks.md:35` — "no HEL-520 guard exists on this surface".
  - `tasks.md:17,28`, `design.md:64,97,98` — "windowed vs. unwindowed" equivalence language,
    which is the spec's own requirement, not the refuted D3 fallback.
  CR1 (round 1/2) is fully closed: `proposal.md`'s bullet now reads "no existing guard on this
  surface — see design.md" with no HEL-520 mention anywhere in the file.
- CR2 closed: `tasks.md` 1.2 now ends "see task 1.5 for the pre-measurement bounded-window
  behavior (NOT unwindowed rendering — D3)", consistent with D3 and task 1.5. No text anywhere
  now directs the implementer to render all rows before measurement.
- CR3/CR4 re-checked as still present and unchanged: D5 (`aria-rowcount` header-inclusive,
  true-position `aria-rowindex`, `aria-hidden` spacers) + tasks 1.6/2.5/3.1 + a matching spec
  requirement with scenario; D6 (spacer-cell class zeroing padding/border/max-width, omit
  zero-height trailing spacer, explicit `border-bottom: none` on the true last data row) +
  task 1.4.
- Spot-checked the design's code citations against the real tree rather than trusting them:
  - `DataGrid.css:333-344` — `tbody td { border-bottom: 1px solid …; max-width: 240px }` and
    `tbody tr:last-child td { border-bottom: none }` both exist exactly as D6 describes.
  - Density padding/font-size blocks at `DataGrid.css:345-361` confirm D3's "seeded from each
    density's own `--space-*`/`--text-*` values" is a real, available source.
  - `DataGrid.tsx:789` — `role="region" … ref={scrollRef}`; `useScrollEdges.ts:40,43,66` —
    returns a plain `RefObject<T | null>` with a `{ passive: true }` scroll listener, exactly
    as D7 asserts.
  - `DataGrid.tsx:475-490` — the `headerRowRef` `useLayoutEffect` D3 mirrors exists.
  - Only `TableRenderer.tsx` renders `variant="full"`; `StepCard.tsx:382`,
    `SqlTab.tsx:223`, `SourceDetailPanel.tsx:288` are all `variant="preview"`, so the
    non-goal "no `preview` virtualization" leaves no consumer stranded.
- `npx openspec validate virtualize-table-rows --strict` → "Change 'virtualize-table-rows' is valid".
- Scope/AC coverage traced: AC1→3.3, AC2→2.1-2.4 + spec "preserves existing full-variant
  behaviors", AC3→1.3/3.2, AC4→3.3, AC5→3.1/2.5 + the a11y spec requirement. No task exceeds
  the ticket's scope; HEL-1065 and HEL-353 are correctly held out.

### Verdict: CONFIRM

All four prior change requests are closed against the actual files, no placeholders or
deferred decisions remain that block implementation, and no internal contradiction between
proposal/design/tasks/spec survives.

### Non-blocking notes

- D3 says "the same `useLayoutEffect` that measures `headerRowRef` today also measures the
  first mounted body row". Read literally that is a trap: that effect early-returns
  `if (!filterable) return;` (`DataGrid.tsx:478-479`), so a non-filterable `full` grid would
  never measure and would stay on the estimate forever. The binding requirement — measure
  before paint in a layout effect — is unaffected; the implementer should use a *separate*
  (or ungated) layout effect rather than literally extending the filter-gated one. Today's
  only `full` consumer is `TableRenderer`, so no live surface is currently exposed.
- `design.md` lists D4 after D7. Harmless, but renumbering or reordering would help review.
