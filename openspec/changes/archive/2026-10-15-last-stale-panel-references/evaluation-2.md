## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD 93f0255adc24aa8a4db8cf2de8e1370275446606. The review base was resolved live as 453c57f1e71b5a5a06214cde68cbfd0cd9f992e0, and I also read the cycle-2 delta `13087b3b0..HEAD`. That delta changes only Markdown files:
- `openspec/specs/write-path-audit/spec.md` (2 lines)
- `evidence.md` (new section C2)
- `evaluation-1.md`, the cycle-1 report, which is now committed

### Phase 1: Spec Review — PASS

- **Cycle-1 CR1 is resolved.** In the Session Call-Volume Estimate (`openspec/specs/write-path-audit/spec.md:152-153`), the drag and resize rows now read "staged, folded into the flushes (no per-drag call)" and "(no per-resize call)". That matches:
  - row 1 ("at most 1 per flush (no debounce)")
  - the Key observation
  - the Auto-save flushes row (line 156)
  - The only remaining "3 × PATCH dashboard layout" text is the flush row's "up to 3 × ...", which is correct.
- **Moderate Total (line 160):** 3 layout + 3 batch + 2 swaps + 1 dashboard appearance + 1 rename + 1 add = 11, which matches "up to ~11". Every row in the table now agrees with the Total.
- **Heavy-session line, checked at the orchestrator's request (line 164):**
  - Arithmetic: 20 + 10 + 3 + 6 = 39, which matches "up to ~39".
  - Wording against the flush model:
    - Layout PATCHes are capped at one per flush that has pending layout, consistent with row 1. ~20 such flushes means at least about 10 minutes of editing at the 30 s tick, which is plausible for a "heavy session".
    - updateBatch POSTs are also capped by the flush count ("up to ~10" ≤ 20 flushes), consistent with row 7.
    - Dashboard PATCHes and add/duplicate are direct calls, not batched, so they are correctly counted per action.
  - Nothing in the line still describes the per-drag or per-edit model.
- The evidence.md C2 section records the grep and the two sums, which satisfies constraint C3.
- AC1, AC2, AC4, AC5 and constraints C1–C7 are unchanged since cycle 1, so the cycle-1 findings stand. No code or spec outside this table changed.

### Phase 2: Code Review — PASS

Fresh runs at HEAD:
- `openspec validate last-stale-panel-references --type change --strict`: exit 0.
- `npm run format:check`: exit 0. This covers the changed Markdown.
- `npm run lint`: exit 0.

No `frontend/**` or `backend/**` file changed since 13087b3b0, so the code tree is byte-identical to what cycle 1 gated. In cycle 1 I ran these myself in this worktree:
- typecheck and build: both exit 0
- jest: root 51 suites / 469 tests and frontend 612 suites / 7265 tests, all passing, with at most 3 workers under nice 19

I did not re-run jest or the build. A Markdown-only delta cannot change their result.

### Phase 3: UI Review — N/A this cycle

The cycle-2 delta is a Markdown-only spec edit, with no `frontend/**`, route or schema change. The cycle-1 UI review covers the unchanged code: chart Output rendered, 768px detail modal, 0 console errors. Per the orchestrator's instruction, I did not use the Playwright tool this cycle.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- In the heavy-session line (`openspec/specs/write-path-audit/spec.md:164`), "6 calls from add/duplicate" counts the refetch GETs (3 POST + 3 GET) as "write calls". The moderate Total counts "1 add" as one write. This phrase predates this change and is not a flush-model staleness, so it is optional. If it is ever touched, "3 POSTs (+3 refetch GETs) from add/duplicate" would make the two counts consistent, and the heavy total would become ~36.
- From cycle 1: row 7's payload shape leaves out the `type?` that `buildBatchRequest` can also carry.
