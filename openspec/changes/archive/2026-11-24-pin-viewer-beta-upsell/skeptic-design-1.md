## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD fe07492b6a83dce675c124026700dbd002594628 (== origin/main; the change dir is the only untracked content).

### What I verified (with evidence)

- **The relevant link is HistoryPayloadsField's upsell, and it has no role gate.** `HistoryPayloadsField.tsx` renders the
  `<Link to="/settings#beta-access" target="_blank">Request Beta access<span class="sr-only"> (opens in a new tab)</span>`
  only on `!available`. Its props are `checked/onChange/available/limits`, with no role input. `OutputEditorSheet.tsx:417-428`
  mounts it only when `!isCreate && kind !== "insight"`, with `available={output?.historyPayloadsAvailable === true}`.
  A missing flag therefore shows the upsell (fail-closed), as design.md says. Claim holds.
- **The `<fieldset disabled>` fence does not disable the anchor.** In `OutputEditorSheet.tsx:292-299`, `readOnlyFence`
  wraps the History card in `<fieldset disabled>`. A disabled fieldset disables form controls only, not `<a>`.
  `OutputEditorSheet.css:369-387` adds no `pointer-events` rule and no other rule that would make the link dead. Claim holds.
- **The HEL-1839 default does not hide the link.** `OutputEditorSheet.tsx:99` has `readOnly = true`, and `readOnly` is used
  only by the fence, the title, the footer and the preview card. None of them touches the History card's render
  condition. The only caller is `PipelineDetailDialogs.tsx:75-96`, which passes `readOnly={!page.canEdit}` and
  `isPipelineOwner={page.isOwner}`. Claim holds.
- **Insight-kind upsell is owner-only.** `OutputEditorSheet.tsx:409` has `showUpsell: isPipelineOwner && tier === "free"`,
  and `InsightKindFields.tsx:124` renders on `showUpsell`. Claim holds.
- **Ask upsell is keyed on the user's own tier.** `AskPanel.tsx:23,36` checks `currentUser.tier === "free"` or a
  tierForbidden error, then renders `AskUpsell`. It has the same accessible name and sits inside a collapsed `<details>`
  (`OutputEditorSheet.tsx:443-448`). Claim holds. This also justifies D1/D2's insistence on locators scoped to the
  History card.
- **hel1794 allow-list comment.** `e2e/hel1794-viewer-read-only.spec.ts:70` attributes the name only to the Ask panel
  upsell. D5's comment-only correction is accurate and in scope.
- **The e2e fixture supports D2.** `e2e/support/hel1661Fixture.ts` seeds a saved `kind: "table"` Output (non-insight,
  so the History card renders) and real editor/viewer grants. `openPipeline` takes a `theme` argument. The owner is a
  fresh `registerUser` (free by default), and the plan asserts this from the real Output response instead of assuming it.
- **AC coverage.** AC1: no-op behaviour plus a spec delta. AC2: D1 jest viewer/editor/default plus D3 mutations
  (a) read-only gate and (b) ownership gate. AC3: D4 / task 1.1, live first in both themes with named conditions,
  ESCALATION if absent. AC4: the default-`readOnly` jest case plus static proof above. Every AC maps to a task.
- **Spec delta.** The MODIFIED requirement reproduces the current `openspec/specs/output-history-payloads-toggle/spec.md:42-64`
  text verbatim, appends the role sentence, and adds viewer and editor scenarios. It does not contradict the ruling.
- **No product decision outstanding.** The ruling ("viewers see it, keep today's behaviour, pin with tests") fully
  settles the History card link. The two other links are different surfaces with their own existing rules, and the
  plan correctly leaves them unchanged. There is nothing to escalate.

### Verdict: CONFIRM

### Non-blocking notes

1. **"Enabled" on an anchor is vacuous.** jest-dom `toBeEnabled` and Playwright `toBeEnabled` treat `<a>` as always
   enabled unless it has `aria-disabled`. The assertion cannot fail under a fieldset-disable, so do not present it as
   proof the link is live. To pin "live link in a read-only sheet", the e2e viewer test should click the link in at
   least one theme. It should assert a popup opens at `/settings#beta-access` while the original tab keeps the sheet
   open. The jest test is fine with presence + exact `href` + `target="_blank"` + no `aria-disabled`.
2. **Name the History-card scoping mechanism.** The card has no region or accessible name: it is a
   `.output-editor-sheet__group--card` with an `h3` "History". The executor should scope via the heading's closest card,
   or `within()` that container. A page-wide `getByRole('link', {name})` must not be used, even though the Ask
   `<details>` is collapsed by default.
3. **Record the Ask panel's state in live verification (1.1).** Note whether the Ask disclosure was expanded, so the
   screenshot unambiguously shows the History card link and not the Ask upsell.
4. **Make mutation (a)'s red evidence show both sides.** It should show the viewer and default cases red and the editor
   case green in the same run, so it reads as a gate on role rather than a broken harness.
