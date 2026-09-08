## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

- Read all four artifacts from file (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/data-grid/spec.md`, `specs/table-panel-column-sort/spec.md`). Prior skeptic reports read
  only as claims.
- Ground truth on the shared system, `frontend/src/shared/ui/useSortedRows.ts` @ 6b081b86:
  - `compareNonNull` numeric branch requires BOTH `typeof number` (l.38) — design D3's premise is
    correct.
  - `compareValues` treats blank as `a === null || a === undefined` ONLY (l.58-60); an empty string
    is a non-null value and goes to `compareNonNull`.
  - No-match passthrough (`if (!column) return rows`) is real — D2's sentinel works.
  - ISO_DATE_PATTERN is anchored/strict; `Number("2026-…Z")` is NaN, so D3's claim that ISO dates
    survive the coercion holds.
  - `.slice().sort()` — V8 sort is stable, so the spec's stability scenario is met by reuse.
- `DataGrid.formatCell` (`DataGrid.tsx:108-112`): only `null`/`undefined` render `—`. An empty
  string renders as an empty cell — it is still a "blank cell" in the ticket's AC sense.
- `TableRenderer.tsx:104-107`: the `rawRows` branch builds records from `string[][]` positional
  indices, so EVERY value is a string there. Confirms D3's/2.5a's framing.
- Reproduced the ordering claim myself in node:
  `"".localeCompare("-5", undefined, {numeric:true, sensitivity:"base"})` → `-1`.
- `Output.ownerId` exists (`frontend/src/features/pipelines/types/output.ts:25`) and `useOutputMeta`
  returns the whole `Output`, so D7's pre-check is buildable.
- `PanelContent.tsx:102-110` does withhold `TableRenderer` behind a skeleton until `useOutputMeta`
  resolves — D6a's load-bearing seeding note is accurate.
- Cross-artifact consistency check (proposal vs design vs tasks vs specs): I found no contradiction
  other than the one below. D5 storage shape, the two-state cycle, minimal-patch/activation-only,
  D9/D9a scope and the HEL-1027 deferral are stated the same way in all four documents, and D9a is
  consistently marked non-owner-approved in proposal, design, tasks 3b.4 and 6.3(e).
- D10 + tasks 5.1/5.2/5.3 + 3b.6 do commit to a path-referenced baseline/post-change comparison in
  both themes against BOTH neighbouring surfaces, with an escalation route rather than an agent
  judgment call. That is a real gate, not a narrative claim.

### Verdict: REFUTE

One finding, and it is the same runtime-ordering rule this round was asked to audit. Everything else
I checked is sound enough to build from; the rest of my remarks are non-blocking.

### Change Requests

1. **The specified `getValue` coercion fails "blanks last" on exactly the branch the design says is
   all-strings, and it contradicts two spec scenarios this ticket wrote in round 3.**
   D3 (and task 2.1) say: a `string` is coerced to a number when
   `v.trim() !== "" && Number.isFinite(Number(v.trim()))`, "otherwise pass the string through". So a
   blank cell on the `rawRows` branch (`""`, or whitespace) is passed through **as a string**. The
   shared hook's blanks-last logic keys on `null`/`undefined` only (`useSortedRows.ts:58-60`), so
   `""` is treated as an ordinary value and, ascending, sorts FIRST:
   `"".localeCompare("-5", …, {numeric:true})` is `-1` (I ran it).
   That directly refutes:
   - ticket AC "blank cells sort last";
   - `specs/table-panel-column-sort/spec.md` scenario "Blank cells sort last in both directions";
   - the same file's scenario "A blank cell is not treated as zero" — under this rule a blank orders
     *before* the negatives, which is the scenario's explicit failure condition ("rather than
     between them" is not the only wrong answer; "before them" is also wrong);
   - task 2.5b, which is therefore unsatisfiable as written against D3's rule.
   The design half-sees this: the `v.trim() !== ""` guard exists precisely because `""` is a blank
   that must not become `0`. It stops the blank being zero but leaves it as `""`, which is wrong in
   a different direction. This is not a wording nit — it is the executor hitting a red test at task
   2.5b with no artifact answer, and improvising the blank semantics themselves.
   **Required revision:** in D3, and in tasks 2.1 and 2.5b, coerce a blank string to `null` rather
   than passing it through — i.e. `string` → `null` when `v.trim() === ""`; → `Number(v.trim())`
   when `Number.isFinite(Number(v.trim()))`; else the string unchanged. State explicitly that this
   is a *sort-value* adapter only and does not change `DataGrid.formatCell` rendering (an empty
   cell keeps rendering empty, not `—`). Also tighten the spec requirement's parenthetical
   "Blank values (`null`/`undefined`)" to include empty/whitespace-only strings, since on the
   `rawRows` branch that is the only form a blank can take.

### Non-blocking notes

- Task 3.5 requires an ownership PRE-CHECK inside the persist path, but no task plumbs `ownerId`
  (or the current user id) into `TableRenderer`; task 3.2 only passes `columnSort`. It is obvious
  what to do — pass a `canPersist`/`ownerId` prop from `PanelContent`, which already holds the whole
  `Output` — but naming it in 3.2 would remove the last bit of guesswork. Deciding it in
  `PanelContent` (rather than reading auth state inside the renderer) also keeps `TableRenderer`
  presentational per CLAUDE.md.
- `Number("0x10")` is `16` and `Number("1e5")` is `100000`, so a column of such strings coerces to
  numbers. Both are correct-ish and harmless; not worth specifying.
- D9a: I examined it independently and agree with rounds 2 and 3 — it is one conditional line of
  text reusing existing tokens next to an existing affordance, with an objective, screenshot-backed
  escalation trigger (3b.3) and an explicit removability requirement. It does not need its own
  design cycle.
- Very large numeric strings lose precision through `Number(…)` and can tie; the stable sort then
  preserves loaded order, which is a defensible outcome. No action.
