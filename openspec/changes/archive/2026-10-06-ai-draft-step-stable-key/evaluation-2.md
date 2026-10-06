## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `3e74e04c9fdda9c9c03eb4909106981ff1d18d23`. Base, resolved live: `90f8a949c4ad25cf7789d90de22d20aa78e850a8`. The incremental diff reviewed is `2a86a6cbb..3e74e04c9`.

### Phase 1: Spec Review — PASS

Issues: none.

Both cycle-1 change requests are resolved:
- **CR1, carry `renderKey` through the server reconciles.** `renderKey` is now carried through `handleToggleStepEnabled` (`usePipelineDetailPage.ts:1373-1377`) and `handleReorderSteps` (`:1291`).
- **CR2, restore `childLanesOf`'s JSDoc.** The JSDoc is back directly on `childLanesOf` (`stepTree.ts:246-248`), and `laneRenderKey` keeps its own JSDoc.

Everything else from cycle 1 still holds:
- **ACs and HEL-1294.** All ACs remain met. HEL-1294 is untouched: `PipelineDetailPage.creatingStep.test.tsx` is unmodified against base and passes at HEAD and with the production code reverted.
- **Constraints.** C1 and C2 are unchanged and honoured. C3 holds: probe-evidence.md "Cycle 2" records the new test red-first, and I reproduced that independently (below).

### Phase 2: Code Review — PASS

**Gates, run fresh against HEAD 3e74e04c9:**
- `npm run lint`: exit 0
- `npm run format:check`: "All matched files use Prettier code style!"
- `tsc --noEmit -p frontend/tsconfig.json`: exit 0
- root `npx jest --maxWorkers=2`: 371/371 passed
- frontend `npx jest --maxWorkers=2`: 436 suites / 4536 tests passed, exit 0
- `npm --prefix frontend run build`: exit 0 (run in a throwaway detached worktree at the same SHA)
- No backend files changed.

**Red-first and mutation checks.** These ran in a throwaway detached worktree at 3e74e04c9, which I have since removed:

| Mutation | Result |
|---|---|
| T: revert only the enable-toggle carry (`:1373`) | Exactly 1 red: "an enable toggle on a created draft keeps its card open". The executor's red-first claim is confirmed. |
| R: revert only the reorder carry (`:1291`) | The committed suite stays green, so no committed test pins this line. My new evaluator probe (non-head reorder, below) goes red. With the carry in place it is green, so the reorder fix is now confirmed by a probe, not just by code reading. |
| Production code reverted to base | 7 red in `draftCreate.test.tsx` (the 6 from cycle 1 plus the toggle test). `PipelineDetailPage.test.tsx` has 1 red, the HEL-1109 workaround removal, as in cycle 1. `creatingStep.test.tsx` passes. |

**The new test is meaningful.** The toggle test waits for `updatePipelineStepEnabled("ai-1", false)` and for the "Enable step" name before asserting. It is red without the carry, as mutation T shows.

Issues: none.

### Phase 3: UI Review — PASS (objective checks)

I reused the servers on 6753/9660; `assert-phase.sh servers` returned PASS. The check used a standalone headless Chromium context, logged in, isolated on `about:blank`, then navigated. No Playwright MCP was used this cycle.
- **Toggle on a draft-created card (live).** A lane-add AI draft was still expanded after its create (`true`). After clicking "Disable step" it stayed `aria-expanded: true`; in cycle 1 it was `false`.
- **Errors.** The only failed responses were the expected ones that predate this change: `401 /api/auth/me` before login, and `404 /api/pipelines/<id>/schedule` because the pipeline has no schedule.
- **Unchanged from cycle 1.** The cycle-1 checks still hold, since this commit does not touch their render paths:
  - the card survives its create without remounting
  - the in-flight edit is flushed to the persisted id
  - no overflow at 1100 / 768 / 375

**Shared dev DB rows created this cycle:** step `e5489963-4d12-4b5e-967c-2d39745c6dcc` (generatetext, disabled by the probe), on the evaluator's existing probe pipeline `c286faa5-8ecb-4b36-8526-d01d1dad3dd4`. This adds to cycle 1's pipeline, root and 3 steps listed in evaluation-1.md. Nothing was deleted.

### Overall: PASS

### Non-blocking Suggestions
- No committed test covers the reorder carry at `usePipelineDetailPage.ts:1291`: mutation R survives the suite. Consider committing the evaluator's probe below. It is green at HEAD and red with the carry reverted. Drop the two `console.log` lines first.

```tsx
it("a non-head reorder keeps a created draft's card open", async () => {
  getPipelineStepsMock.mockResolvedValue([persisted("anchor-1", "rename", 0), persisted("f-1", "filter", 1)]);
  const create = deferredCreate();
  renderPage();
  await screen.findByRole("button", { name: /Filter rows/i, expanded: false });
  const gaps = screen.getAllByRole("button", { name: "Insert step here" });
  fireEvent.click(gaps[gaps.length - 1]);
  fireEvent.click(await screen.findByRole("option", { name: /Generate text/i }));
  await completeDraft();
  await create.resolve(aiPersisted("ai-1", 2));
  await waitFor(() => expect(screen.queryByText(/draft.*not yet saved/i)).not.toBeInTheDocument());
  jest.mocked(reorderPipelineSteps).mockResolvedValue([
    persisted("anchor-1", "rename", 0), aiPersisted("ai-1", 1), persisted("f-1", "filter", 2),
  ]);
  const card = generateToggle().closest(".pipeline-detail-page__step-card") as HTMLElement;
  fireEvent.click(within(card).getByRole("button", { name: /Move step up/i }));
  await waitFor(() => expect(reorderPipelineSteps).toHaveBeenCalled());
  await act(async () => {});
  expect(generateToggle()).toHaveAttribute("aria-expanded", "true");
});
```

For this test, mock `reorderPipelineSteps` in the file's `jest.mock` factory. The probe I ran found the button with `querySelectorAll` plus `aria-label`; `within` is the idiomatic form.

- Carried from cycle 1: `usePipelineDetailPage.ts` is now about 1598 lines. Propose a split in the PR body, as CONTRIBUTING.md asks for files over about 400 lines.
