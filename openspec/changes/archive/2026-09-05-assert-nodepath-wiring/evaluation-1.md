## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `6516f389` (parent `431d86de`).

Note on review surface: `git diff main...HEAD` is misleading here — the local
`main` ref is stale (`56875fdc`) while `origin/main` is `431d86de`, so that
range folds in ~10 unrelated already-merged upstream commits (HEL-984,
mcp-ordered-query-params, a Concertino sync). The actual ticket surface is
`git diff HEAD~1 HEAD`: **one test file plus change artifacts, 967 insertions,
zero deletions.**

### Phase 1: Spec Review — PASS

Issues: none.

- **AC1** — PASS. `describe("nodePath wiring (HEL-985)")` renders
  `PipelineRiverView` with a two-root, 8-step fixture and asserts exact `title`
  strings. Root-level base case covered (`titleFor("Trunk one")` →
  `"root:root-1 > r1a"`); multi-level chain covered (`titleFor("Trunk three")` →
  `"root:root-1 > r1a > r1b > r1c"`, three hops).
- **AC2** — PASS. All four prop-threading edges get their own assertion, and
  each is separately droppable: E1 (`PipelineRiverView.tsx:381`), E2 compact
  (`LaneColumn.tsx:171`, via the single-step child lane — the only shape that
  reaches it, since `RootColumn.tsx:112` hardcodes `isCompact={false}`), E2
  non-compact (`LaneColumn.tsx:216`), E4 (`LaneColumn.tsx:146`, lane nested
  under a lane), E3 (`RootColumn.tsx:114`, root 2's own lane).
- **AC3 / AC4** — PASS, independently re-verified (see Phase 2).
- **AC5** — PASS. `git status --porcelain` is empty; full gate set green on the
  unmutated tree.
- **AC6** — PASS. `git diff --name-only HEAD~1 HEAD` over `frontend/src`,
  `helio-mcp`, `backend` filtered for non-test files returns nothing. No
  testability seam was needed at all — no test id, no export, no product edit.
  The guard works purely against existing rendered `title` attributes.
- Tasks 1.1–4.3 all marked `[x]` and each matches what was implemented; the
  fixture honors every trap the task list called out (explicit `rootId` on root
  heads, explicit `parentStepId` everywhere, explicit `position` at branch
  points, `baseProps`/`linkChain` bypassed).
- No scope creep; no spec deltas required (test-only, no contract change).

### Phase 2: Code Review — PASS

**Gates re-run by me from scratch in `WORKTREE_PATH`, not taken from the
executor's report** (`CLEAN_WORKTREE` unset, so gates ran in the delivery
worktree):

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (`--max-warnings=0`) |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 256 suites, 2646 tests |
| `npm --prefix frontend run build` | PASS |

**Independent mutation verification (the load-bearing AC).** I did not credit
`mutation-evidence.md`; I re-ran both mutations myself and reverted each.

1. *Baseline (unmutated):* `npx jest --testPathPatterns=PipelineRiverView.test.tsx
   -t "nodePath wiring"` → `7 passed, 23 skipped`. Matches the recorded claim.
2. *Mutation A — call site.* `PipelineRiverView.tsx:294` changed to
   `entries[step.id] = step.id;` (still compiles, so redness proves the guard,
   not the type-checker). Result: **6 failed, 1 passed** — every title-bearing
   assertion red, e.g. `Expected: "root:root-1 > r1a" / Received: "r1a"`. The
   single green test is the shape probe, which correctly asserts DOM structure
   only. Reverted; tree clean.
3. *Mutation B — function logic.* `nodePath.ts:92` changed to
   `["root", ...trail].join(" > ")`. Result: **6 failed** on the new
   HEL-985 assertions specifically (the command is scoped by `-t`, so
   `state/nodePath.test.ts` was never run — this is a genuinely new assertion
   going red, not the pre-existing unit test satisfying AC4's letter).
   Reverted; tree clean.

Critically, the three states are **mutually distinguishable** for the same
step: unmutated `"root:root-1 > r1a"`, mutation A `"r1a"`, mutation B
`"root > r1a"`. That is what makes the red attributable to the wiring rather
than to a malformed fixture — mutation A's replacement is byte-identical to
`nodePath()`'s unresolvable-data fallback (`if (!bestRootId) return stepId;`),
so a fixture that failed to resolve roots would produce mutation A's output
even unmutated. The baseline green rules that out. The discrimination risk the
design flagged is genuinely closed, not hand-waved.

Code-quality review of the new block:

- **DRY / modular** — PASS. `wiringStep()` and `wiringProps()` are local
  factories; `titleFor()` is a small focused helper.
- **Readable** — PASS overall. Fixture ids and labels are distinct (required,
  since `getByText` throws on duplicates), and each constant carries a comment
  naming the edge it exercises.
- **Type safety** — PASS. `ComponentProps<typeof PipelineRiverView>` types the
  props object; no `any`, no `as` escape hatches, no `@ts-expect-error`.
- **Tests meaningful** — PASS, and this is the strongest part of the change.
  `titleFor` deliberately avoids `getByTitle`, so a failure surfaces as a value
  mismatch rather than an "unable to find element" throw that would be
  indistinguishable from an unrelated fixture break. Exact `toBe` on the full
  string pins hop order and the ` > ` separator rather than substring-matching
  a `root:` prefix.
- **No dead code / no over-engineering / no drive-by behavior change** — PASS.

### Phase 3: UI Review — N/A

The `frontend/**` trigger matches by path, but the only changed frontend file
is `PipelineRiverView.test.tsx`. No product file, style, token, or rendered
output changed anywhere in the commit (verified by the filtered diff above), so
there is no runtime surface to exercise and no design-standard `[mechanical]`
rule with anything to bind to. Starting dev servers would exercise `main`'s
behavior, not this change's.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `PipelineRiverView.test.tsx:527` — the constant is named
  `UNION_OP_FOR_WIRING` but is assigned `FILTER_OP`. The trailing comment
  ("op type is irrelevant to nodePath") explains why *any* op works, but the
  `UNION_` prefix actively misdescribes the value and will mislead the next
  reader. Suggest renaming to `WIRING_OP` (or `OP_FOR_WIRING`). Cosmetic; does
  not affect correctness or any AC.
