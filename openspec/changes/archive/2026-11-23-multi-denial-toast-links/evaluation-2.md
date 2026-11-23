## Evaluation Report — Cycle 2 (evaluation-2.md)

**Scope**
- Reviewed HEAD: `c417a2ad04b71ad40eb74dafde40f0c8aa700661`.
- Base: `1b3c309e01080bbca65e246036694dc24b19328d`, resolved live.
- New in this cycle: commit c417a2ad0, which addresses evaluation-1's CR1 (touch floor) and CR2 (file split).

### Phase 1: Spec Review — PASS
Issues: none.
- The cycle-1 Phase 1 findings still hold: AC1, AC2, owner Q1/Q2 and constraints C1–C4 are all met.
- `tasks.md` §4 records the two change requests and the mutation re-record. All three are done and match the diff.
- No scope creep. The touch-floor rule also covers the single-pipeline toast action (`.toast__action`). Evaluation-1 asked for exactly that or a follow-up.

### Phase 2: Code Review — PASS
I ran every gate myself in WORKTREE_PATH, after `npm ci`:

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` (3 workers) | exit 0: root 73 suites / 645 tests, frontend 923 suites / 10665 tests |
| `npm --prefix frontend run build` | exit 0 |

I also ran three Playwright specs, 35/35 passed. They used the lane DB `helio_hel1172`, an empty `ANTHROPIC_API_KEY` and 2 workers:
- `e2e/hel1172-multi-denial-toast.spec.ts` — includes the two new 390px hit-extent tests.
- `e2e/hel1096-run-to-update-affordance.spec.ts` — regression check.
- `e2e/hel813-mobile-touch-target-floor.spec.ts` — the existing touch-floor guard, including its "toast dismiss control" surface.

**CR1 is resolved.** `toast.css` adds a block under `@media (max-width: 768px), (pointer: coarse)`, as DESIGN.md §3 requires:
- `.toast__link` and `.toast__action` get `position: relative` and a full-width-strip `::after` that is explicitly 44px high. There is no `min-height` on the button.
- The list gap is `calc(var(--space-6) + var(--space-1))` = 28px. That is at least the 27.2px the expanders need, so they tile without overlapping.
- `padding-block: var(--space-4)` keeps the scroll list from clipping the first and last expander.
- Only tokens are used.

Tests for CR1:
- Unit guard: `toast.css.test.ts` uses `expectTapExpander` and pins the gap and padding.
- e2e: `bisectHitExtent` at 390px checks the multi-row toast and the single-pipeline toast.
- Mutations g and h (tiling broken, expander removed) fail those tests, as recorded in `evidence/mutations.txt`.

**CR2 is resolved.**
- `Toast.tsx` drops from 416 to 323 lines, which is under the ~400 split trigger.
- The row list moves verbatim into `ToastRowList.tsx` (63 lines).
- The D8 focus hand-off moves into `useToastFocusHandOff` in `toastFocusHandOff.ts` (60 lines).
- It is a pure move. The only change is that `elementRef` is now a dependency of the hook's effect, which is a stable ref. All existing focus tests are unchanged and green.

**Mutation e2** was re-recorded against the shipped code (the call inside `useToastFocusHandOff` removed), and 3 focus tests fail as they should.

### Phase 3: UI Review — PASS
I re-checked the UI live on dev port 6604, using the same 4-pipeline denial dashboard as cycle 1.

- **Hit regions at 390px.** I walked outward from the centre of each control with `elementFromPoint`:
  - every row link and every row "Run to update" covers 44px vertically;
  - the 50px-tall wrapped link covers 51px;
  - the dismiss button is still 44x44.
- **Visuals.**
  - At 390px the touch-gated spacing gives looser rows. The focus ring is not clipped in either theme.
  - At 1440px the layout is unchanged from cycle 1. The touch rules do not apply to a fine pointer.
- **Console.** No errors during the flow.

Persisted screenshots:
- /home/matt/Development/helio/.concertino/runs/HEL-1172/evidence/.concertino/scratch/HEL-1172/eval2/dark-390.png
- /home/matt/Development/helio/.concertino/runs/HEL-1172/evidence/.concertino/scratch/HEL-1172/eval2/light-390.png
- /home/matt/Development/helio/.concertino/runs/HEL-1172/evidence/.concertino/scratch/HEL-1172/eval2/light-1440.png

In the light shots I switched the theme by setting `data-theme` directly, so the form panel card does not re-theme. The toast does use the light tokens.

### Overall: PASS

### Non-blocking Suggestions
- `Toast.tsx:161`: `toast.items !== undefined && hasItems` repeats a check `hasItems` already makes. It is only there to narrow the type for TypeScript; a type-guard helper would remove the duplication.
- On touch devices the link's 44px strip also covers part of the reason text under it, so tapping near the top of the reason opens the pipeline page. This is how the shared expander works by design, and the tiling between controls is correct. It is a UX judgment for the skeptic.
- Carried over from cycle 1: rows are ordered by pipeline id rather than by name.
